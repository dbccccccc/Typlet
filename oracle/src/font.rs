//! Dumps Typst's math font as Typst reads it, so that Typlet's font metrics
//! can be generated from it and checked against it (docs/DESIGN.md §4).
//!
//! The output is JSON Lines:
//! - one `font` record: the font metrics and math constants Typst computes,
//!   in ems, plus the MATH table's minimum connector overlap and the GSUB
//!   features, in font units;
//! - one `glyph` record per glyph: its advance, bounding box and MATH table
//!   data, in font units, read with the same ttf-parser calls as Typst's math
//!   layout;
//! - a `cmap` record: the glyph of every character the font maps, and of
//!   every variation sequence it maps, such as `ℒ` with VS1, which Typst's
//!   `cal` produces;
//! - a `shape` record per feature set: the characters and variation sequences
//!   whose shaping, done as Typst's math shaping does, gives anything but
//!   their mapped glyph at its advance, with the glyphs it gives.

use std::collections::BTreeSet;
use std::io::{self, BufWriter, Write};
use std::str::FromStr;

use rustybuzz::{
    BufferFlags, Direction, Feature, Language, Script, ShapePlan, UnicodeBuffer, shape_with_plan,
};
use serde_json::{Map, Value, json};
use ttf_parser::math::{GlyphConstruction, Kern};
use ttf_parser::{GlyphId, Tag};
use typst::foundations::Bytes;
use typst::layout::{Abs, Em};
use typst::text::{Font, FontInstance, FontVariant, FontVariations, LineMetrics, ScriptMetrics};

/// Typst's default math font, which `font` dumps unless given another.
const MATH_FONT: &str = "NewCMMath-Book";

/// The feature sets Typst's math shaping uses: `ssty` at script sizes, and
/// `dtls` for the bases of accents. `flac` is left out, as the font has none.
const FEATURE_SETS: &[&[(&[u8; 4], u32)]] = &[
    &[],
    &[(b"ssty", 1)],
    &[(b"ssty", 2)],
    &[(b"dtls", 1)],
    &[(b"ssty", 1), (b"dtls", 1)],
    &[(b"ssty", 2), (b"dtls", 1)],
];

/// Dumps the font with the given PostScript name, by default the math font.
pub fn font(name: Option<&str>) -> i32 {
    let name = name.unwrap_or(MATH_FONT);
    let Some(font) = typst_assets::fonts()
        .flat_map(|data| Font::iter(Bytes::new(data)))
        .find(|font| font.post_script_name().as_deref() == Some(name))
    else {
        eprintln!("font {name} not found");
        return 1;
    };
    let font = font.instantiate(FontVariant::default(), Abs::pt(11.0), &FontVariations::default());
    let ttf = font.ttf();

    let mut stdout = BufWriter::new(io::stdout().lock());
    let mut emit = |value: Value| {
        serde_json::to_writer(&mut stdout, &value).expect("failed to write stdout");
        stdout.write_all(b"\n").expect("failed to write stdout");
    };

    emit(header(&font));
    for id in 0..ttf.number_of_glyphs() {
        emit(glyph(ttf, GlyphId(id)));
    }

    // Every mapped character, then every mapped variation sequence, with its
    // text and glyph.
    let mut texts: Vec<(String, u16)> = (0..=0x10FFFF_u32)
        .filter_map(char::from_u32)
        .filter_map(|c| ttf.glyph_index(c).map(|id| (c.to_string(), id.0)))
        .collect();
    // Math uses the variation selectors VS1 to VS16 on mapped characters.
    let chars = texts.len();
    for selector in (0xFE00..=0xFE0F_u32).filter_map(char::from_u32) {
        for i in 0..chars {
            let c = texts[i].0.chars().next().unwrap();
            if let Some(id) = ttf.glyph_variation_index(c, selector) {
                texts.push((format!("{c}{selector}"), id.0));
            }
        }
    }
    let entries = |range: std::ops::Range<usize>| -> Vec<Value> {
        texts[range].iter().map(|(text, id)| json!([text, id])).collect()
    };
    emit(json!({ "kind": "cmap", "chars": entries(0..chars), "sequences": entries(chars..texts.len()) }));

    let face = font.rusty();
    let language = Language::from_str("en").unwrap();
    let script = Script::from_iso15924_tag(Tag::from_bytes(b"math")).unwrap();
    for set in FEATURE_SETS {
        let features: Vec<Feature> =
            set.iter().map(|(tag, value)| Feature::new(Tag::from_bytes(tag), *value, ..)).collect();
        let plan = ShapePlan::new(face, Direction::LeftToRight, Some(script), Some(&language), &features);
        let mut results = vec![];
        for (text, id) in &texts {
            let mut buffer = UnicodeBuffer::new();
            buffer.push_str(text);
            buffer.set_language(language.clone());
            buffer.set_script(script);
            buffer.set_direction(Direction::LeftToRight);
            buffer.set_flags(BufferFlags::REMOVE_DEFAULT_IGNORABLES);
            let shaped = shape_with_plan(face, &plan, buffer);
            let glyphs: Vec<[i32; 5]> = shaped
                .glyph_infos()
                .iter()
                .zip(shaped.glyph_positions())
                .map(|(info, pos)| {
                    [info.glyph_id as i32, pos.x_advance, pos.x_offset, pos.y_offset, pos.y_advance]
                })
                .collect();
            let advance = ttf.glyph_hor_advance(GlyphId(*id)).map_or(0, i32::from);
            if glyphs != [[i32::from(*id), advance, 0, 0, 0]] {
                results.push(json!([text, glyphs]));
            }
        }
        let features: Vec<String> =
            set.iter().map(|(tag, value)| format!("{}={value}", Tag::from_bytes(tag))).collect();
        emit(json!({ "kind": "shape", "features": features, "results": results }));
    }

    drop(emit);
    stdout.flush().expect("failed to write stdout");
    0
}

/// The font's metrics and math constants, as Typst computes them.
fn header(font: &FontInstance) -> Value {
    let ttf = font.ttf();
    let m = font.metrics();
    let em = |v: Em| json!(v.get());
    let line = |l: &LineMetrics| json!({ "position": em(l.position), "thickness": em(l.thickness) });
    let script = |s: &Option<ScriptMetrics>| match s {
        Some(s) => json!({
            "width": em(s.width),
            "height": em(s.height),
            "horizontalOffset": em(s.horizontal_offset),
            "verticalOffset": em(s.vertical_offset),
        }),
        None => Value::Null,
    };

    let c = font.math();
    let mut math = Map::new();
    macro_rules! ems {
        ($($field:ident),* $(,)?) => {
            $( math.insert(camel(stringify!($field)), em(c.$field)); )*
        };
    }
    math.insert("spaceWidth".into(), em(c.space_width));
    math.insert("scriptPercentScaleDown".into(), json!(c.script_percent_scale_down));
    math.insert("scriptScriptPercentScaleDown".into(), json!(c.script_script_percent_scale_down));
    ems!(
        display_operator_min_height,
        axis_height,
        accent_base_height,
        flattened_accent_base_height,
        subscript_shift_down,
        subscript_top_max,
        subscript_baseline_drop_min,
        superscript_shift_up,
        superscript_shift_up_cramped,
        superscript_bottom_min,
        superscript_baseline_drop_max,
        sub_superscript_gap_min,
        superscript_bottom_max_with_subscript,
        space_after_script,
        upper_limit_gap_min,
        upper_limit_baseline_rise_min,
        lower_limit_gap_min,
        lower_limit_baseline_drop_min,
        stack_top_shift_up,
        stack_top_display_style_shift_up,
        stack_bottom_shift_down,
        stack_bottom_display_style_shift_down,
        stack_gap_min,
        stack_display_style_gap_min,
        fraction_numerator_shift_up,
        fraction_numerator_display_style_shift_up,
        fraction_denominator_shift_down,
        fraction_denominator_display_style_shift_down,
        fraction_numerator_gap_min,
        fraction_num_display_style_gap_min,
        fraction_rule_thickness,
        fraction_denominator_gap_min,
        fraction_denom_display_style_gap_min,
        skewed_fraction_vertical_gap,
        skewed_fraction_horizontal_gap,
        overbar_vertical_gap,
        overbar_rule_thickness,
        overbar_extra_ascender,
        underbar_vertical_gap,
        underbar_rule_thickness,
        underbar_extra_descender,
        radical_vertical_gap,
        radical_display_style_vertical_gap,
        radical_rule_thickness,
        radical_extra_ascender,
        radical_kern_before_degree,
        radical_kern_after_degree,
    );
    math.insert("radicalDegreeBottomRaisePercent".into(), json!(c.radical_degree_bottom_raise_percent));

    let gsub: BTreeSet<String> = ttf
        .tables()
        .gsub
        .map(|gsub| gsub.features.into_iter().map(|f| f.tag.to_string()).collect())
        .unwrap_or_default();

    json!({
        "kind": "font",
        "postScriptName": font.font().post_script_name(),
        "unitsPerEm": m.units_per_em,
        "glyphCount": ttf.number_of_glyphs(),
        "metrics": {
            "ascender": em(m.ascender),
            "capHeight": em(m.cap_height),
            "xHeight": em(m.x_height),
            "descender": em(m.descender),
            "strikethrough": line(&m.strikethrough),
            "underline": line(&m.underline),
            "overline": line(&m.overline),
            "subscript": script(&m.subscript),
            "superscript": script(&m.superscript),
        },
        "math": math,
        "minConnectorOverlap": ttf.tables().math.and_then(|t| t.variants).map(|v| v.min_connector_overlap),
        "gsubFeatures": gsub,
    })
}

/// A glyph's advance, bounding box and MATH table data, in font units.
fn glyph(ttf: &ttf_parser::Face, id: GlyphId) -> Value {
    let mut rec = Map::new();
    rec.insert("kind".into(), json!("glyph"));
    rec.insert("id".into(), json!(id.0));
    if let Some(advance) = ttf.glyph_hor_advance(id) {
        rec.insert("advance".into(), json!(advance));
    }
    if let Some(b) = ttf.glyph_bounding_box(id) {
        rec.insert("bbox".into(), json!([b.x_min, b.y_min, b.x_max, b.y_max]));
    }
    let math = ttf.tables().math;
    if let Some(info) = math.and_then(|t| t.glyph_info) {
        if let Some(v) = info.italic_corrections.and_then(|t| t.get(id)) {
            rec.insert("italic".into(), json!(v.value));
        }
        if let Some(v) = info.top_accent_attachments.and_then(|t| t.get(id)) {
            rec.insert("accent".into(), json!(v.value));
        }
        if info.extended_shapes.is_some_and(|c| c.get(id).is_some()) {
            rec.insert("extended".into(), json!(true));
        }
        if let Some(k) = info.kern_infos.and_then(|t| t.get(id)) {
            let mut kern = Map::new();
            for (name, corner) in [
                ("topRight", k.top_right),
                ("topLeft", k.top_left),
                ("bottomRight", k.bottom_right),
                ("bottomLeft", k.bottom_left),
            ] {
                if let Some(corner) = corner {
                    kern.insert(name.into(), kern_json(corner));
                }
            }
            rec.insert("kern".into(), Value::Object(kern));
        }
    }
    if let Some(variants) = math.and_then(|t| t.variants) {
        if let Some(c) = variants.vertical_constructions.get(id) {
            rec.insert("vertical".into(), construction(c));
        }
        if let Some(c) = variants.horizontal_constructions.get(id) {
            rec.insert("horizontal".into(), construction(c));
        }
    }
    Value::Object(rec)
}

/// The correction heights and their `count + 1` kerns of a MATH kern table.
fn kern_json(kern: Kern) -> Value {
    let heights: Vec<i16> = (0..kern.count()).filter_map(|i| kern.height(i)).map(|v| v.value).collect();
    let kerns: Vec<i16> = (0..=kern.count()).filter_map(|i| kern.kern(i)).map(|v| v.value).collect();
    json!({ "heights": heights, "kerns": kerns })
}

/// A glyph construction: its variants as `[glyph, advance]` and its assembly,
/// with parts as `[glyph, start connector, end connector, full advance,
/// extender]`.
fn construction(c: GlyphConstruction) -> Value {
    let variants: Vec<Value> =
        c.variants.into_iter().map(|v| json!([v.variant_glyph.0, v.advance_measurement])).collect();
    let assembly = c.assembly.map(|a| {
        let parts: Vec<Value> = a
            .parts
            .into_iter()
            .map(|p| {
                json!([
                    p.glyph_id.0,
                    p.start_connector_length,
                    p.end_connector_length,
                    p.full_advance,
                    p.part_flags.extender()
                ])
            })
            .collect();
        json!({ "italic": a.italics_correction.value, "parts": parts })
    });
    json!({ "variants": variants, "assembly": assembly })
}

/// Converts a snake_case field name to camelCase.
fn camel(name: &str) -> String {
    let mut out = String::new();
    let mut upper = false;
    for c in name.chars() {
        if c == '_' {
            upper = true;
        } else if upper {
            out.extend(c.to_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}
