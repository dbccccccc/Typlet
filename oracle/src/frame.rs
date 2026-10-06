//! Dumps laid-out frames.
//!
//! `flatten` turns a page frame into a flat list of positioned glyphs and
//! shapes, in points, with y pointing down. `tree` dumps the raw frame tree
//! for debugging.

use serde_json::{Map, Value, json};
use typst::introspection::Tag;
use typst::layout::{Abs, Frame, FrameItem, Point, Transform};
use typst::visualize::{CurveItem, Geometry, Paint, Shape};

use crate::offsets::round;

/// The default text fill. Glyphs and shapes with this fill omit it.
const BLACK: &str = "#000000";

fn pt(abs: Abs) -> f64 {
    round(abs.to_pt())
}

fn apply(ts: Transform, p: Point) -> (f64, f64) {
    let x = ts.sx.get() * p.x.to_pt() + ts.kx.get() * p.y.to_pt() + ts.tx.to_pt();
    let y = ts.ky.get() * p.x.to_pt() + ts.sy.get() * p.y.to_pt() + ts.ty.to_pt();
    (round(x), round(y))
}

fn is_translation(ts: Transform) -> bool {
    ts.sx.get() == 1.0 && ts.sy.get() == 1.0 && ts.kx.get() == 0.0 && ts.ky.get() == 0.0
}

fn paint(paint: &Paint) -> String {
    match paint {
        Paint::Solid(color) => color.to_hex().to_string(),
        Paint::Gradient(_) => "gradient".into(),
        Paint::Tiling(_) => "tiling".into(),
    }
}

/// A flat dump of everything drawn in a frame.
#[derive(Default)]
pub struct Flat {
    /// PostScript names of the fonts used; glyphs refer to them by index.
    fonts: Vec<String>,
    /// `[font, glyph id, x, y, size, text]`, plus the fill when it isn't
    /// black, plus the linear part of the transform when it isn't identity.
    glyphs: Vec<Value>,
    shapes: Vec<Value>,
}

impl Flat {
    fn font_index(&mut self, name: String) -> usize {
        match self.fonts.iter().position(|f| *f == name) {
            Some(i) => i,
            None => {
                self.fonts.push(name);
                self.fonts.len() - 1
            }
        }
    }

    /// Adds everything in `frame`, positioned by `ts`.
    pub fn add(&mut self, frame: &Frame, ts: Transform) {
        for (pos, item) in frame.items() {
            let ts = ts.pre_concat(Transform::translate(pos.x, pos.y));
            match item {
                FrameItem::Group(group) => self.add(&group.frame, ts.pre_concat(group.transform)),
                FrameItem::Text(text) => {
                    let font = text.font.font();
                    let name = font.post_script_name().unwrap_or_else(|| font.info().family.clone());
                    let index = self.font_index(name);
                    let fill = paint(&text.fill);
                    // Glyph advances and offsets are Y-up (typst-svg flips the
                    // axis for text); frames are Y-down.
                    let (mut x, mut y) = (Abs::zero(), Abs::zero());
                    for glyph in &text.glyphs {
                        let at = Point::new(x + glyph.x_offset.at(text.size), -(y + glyph.y_offset.at(text.size)));
                        let (gx, gy) = apply(ts, at);
                        let mut entry = vec![
                            json!(index),
                            json!(glyph.id),
                            json!(gx),
                            json!(gy),
                            json!(pt(text.size)),
                            json!(text.text.get(glyph.range()).unwrap_or("")),
                        ];
                        if fill != BLACK || !is_translation(ts) {
                            entry.push(json!(fill));
                        }
                        if !is_translation(ts) {
                            entry.push(json!([ts.sx.get(), ts.ky.get(), ts.kx.get(), ts.sy.get()]));
                        }
                        self.glyphs.push(Value::Array(entry));
                        x += glyph.x_advance.at(text.size);
                        y += glyph.y_advance.at(text.size);
                    }
                }
                FrameItem::Shape(shape, _) => self.shapes.push(shape_json(shape, ts)),
                FrameItem::Image(..) | FrameItem::Link(..) | FrameItem::Tag(..) => {}
            }
        }
    }

    pub fn into_json(self) -> Map<String, Value> {
        let mut map = Map::new();
        map.insert("fonts".into(), json!(self.fonts));
        map.insert("glyphs".into(), Value::Array(self.glyphs));
        map.insert("shapes".into(), Value::Array(self.shapes));
        map
    }
}

fn shape_json(shape: &Shape, ts: Transform) -> Value {
    let mut out = Map::new();
    match &shape.geometry {
        Geometry::Line(to) => {
            let (x0, y0) = apply(ts, Point::zero());
            let (x1, y1) = apply(ts, *to);
            out.insert("line".into(), json!([x0, y0, x1, y1]));
        }
        Geometry::Rect(size) => {
            let (x, y) = apply(ts, Point::zero());
            out.insert("rect".into(), json!([x, y, pt(size.x), pt(size.y)]));
            if !is_translation(ts) {
                out.insert("transform".into(), json!([ts.sx.get(), ts.ky.get(), ts.kx.get(), ts.sy.get()]));
            }
        }
        Geometry::Curve(curve) => {
            let path: Vec<Value> = curve
                .0
                .iter()
                .map(|item| match item {
                    CurveItem::Move(p) => json!(["M", apply(ts, *p)]),
                    CurveItem::Line(p) => json!(["L", apply(ts, *p)]),
                    CurveItem::Cubic(a, b, c) => json!(["C", apply(ts, *a), apply(ts, *b), apply(ts, *c)]),
                    CurveItem::Close => json!(["Z"]),
                })
                .collect();
            out.insert("curve".into(), Value::Array(path));
        }
    }
    if let Some(fill) = &shape.fill {
        out.insert("fill".into(), json!(paint(fill)));
    }
    if let Some(stroke) = &shape.stroke {
        out.insert("stroke".into(), json!([paint(&stroke.paint), pt(stroke.thickness)]));
    }
    Value::Object(out)
}

/// Where an equation sits on a page that holds only that equation.
pub struct EquationBox {
    /// The point that glyph and shape positions are made relative to.
    pub origin: (f64, f64),
    /// The box's description for the fixture.
    pub json: Value,
}

/// Finds the equation on a page that holds a single equation, using the
/// introspection tags Typst places around it. Frames alone are not enough:
/// Typst merges soft frames into their parents, so an equation's own frame
/// often disappears from the tree.
///
/// - An inline equation's tags sit on the baseline, at its left and right
///   ends. The box is anchored at the left end of the baseline. Its ascent and
///   descent are the line's: Typst grows inline equations to at least the
///   font's cap height.
/// - A display equation's tags sit at the top-left and bottom-left corners of
///   its block, and the block spans the page width. The box is anchored at
///   the top-left corner. Display equations have no reliable baseline in the
///   frame, and none is needed to compare positions.
pub fn locate_equation(page: &Frame, display: bool) -> Option<EquationBox> {
    let mut finder = Finder::default();
    finder.visit(page, Transform::identity());
    let (start, end) = (finder.start?, finder.end?);
    let json = if display {
        json!({
            "anchor": "top",
            "width": pt(page.width()),
            "height": round(end.1 - start.1),
        })
    } else {
        json!({
            "anchor": "baseline",
            "width": round(end.0 - start.0),
            "ascent": start.1,
            "descent": round(page.height().to_pt() - start.1),
        })
    };
    Some(EquationBox { origin: start, json })
}

#[derive(Default)]
struct Finder {
    location: Option<typst::introspection::Location>,
    start: Option<(f64, f64)>,
    end: Option<(f64, f64)>,
}

impl Finder {
    fn visit(&mut self, frame: &Frame, ts: Transform) {
        for (pos, item) in frame.items() {
            let ts = ts.pre_concat(Transform::translate(pos.x, pos.y));
            match item {
                FrameItem::Tag(Tag::Start(content, _))
                    if self.start.is_none() && content.elem().name() == "equation" =>
                {
                    self.location = content.location();
                    self.start = Some(apply(ts, Point::zero()));
                }
                FrameItem::Tag(Tag::End(location, ..))
                    if self.end.is_none() && self.location == Some(*location) =>
                {
                    self.end = Some(apply(ts, Point::zero()));
                }
                FrameItem::Group(group) => self.visit(&group.frame, ts.pre_concat(group.transform)),
                _ => {}
            }
        }
    }
}

/// Dumps the raw frame tree, for inspecting how Typst nests frames.
pub fn tree(frame: &Frame) -> Value {
    let items: Vec<Value> = frame
        .items()
        .map(|(pos, item)| {
            let mut out = Map::new();
            out.insert("at".into(), json!([pt(pos.x), pt(pos.y)]));
            match item {
                FrameItem::Group(group) => {
                    if !group.transform.is_identity() {
                        let t = group.transform;
                        out.insert(
                            "transform".into(),
                            json!([t.sx.get(), t.ky.get(), t.kx.get(), t.sy.get(), pt(t.tx), pt(t.ty)]),
                        );
                    }
                    out.insert("group".into(), tree(&group.frame));
                }
                FrameItem::Text(text) => {
                    out.insert("text".into(), json!(text.text.as_str()));
                    out.insert("size".into(), json!(pt(text.size)));
                }
                FrameItem::Shape(shape, _) => {
                    out.insert("shape".into(), shape_json(shape, Transform::identity()));
                }
                FrameItem::Tag(Tag::Start(content, _)) => {
                    out.insert("tag".into(), json!(format!("start {}", content.elem().name())));
                }
                FrameItem::Tag(_) => {
                    out.insert("tag".into(), json!("end"));
                }
                FrameItem::Image(..) => {
                    out.insert("image".into(), json!(true));
                }
                FrameItem::Link(..) => {
                    out.insert("link".into(), json!(true));
                }
            }
            Value::Object(out)
        })
        .collect();

    let mut out = Map::new();
    out.insert("size".into(), json!([pt(frame.width()), pt(frame.height())]));
    if frame.has_baseline() {
        out.insert("baseline".into(), json!(pt(frame.baseline())));
    }
    out.insert("items".into(), Value::Array(items));
    Value::Object(out)
}
