//! typlet-oracle: reference outputs from the real Typst compiler.
//!
//! Every command reads JSON Lines on stdin and writes JSON Lines on stdout.
//!
//!   typlet-oracle run [--outputs LIST]   formulas and expressions → fixtures
//!   typlet-oracle split                  documents → formulas
//!   typlet-oracle frametree              formulas → raw frame trees (debugging)
//!   typlet-oracle font [NAME]            a font, by default the math font, as Typst reads it
//!   typlet-oracle version                prints the pinned Typst version
//!
//! Input records for `run` and `frametree`:
//!   {"id", "src", "display"?, "preamble"?}   a formula: math-mode source
//!   {"id", "expr", "preamble"?}              a code expression
//! Input records for `split`:
//!   {"id", "doc"}                            a Typst document in markup mode
//!
//! See README.md in this directory for the output format.

mod cst;
mod font;
mod frame;
mod mathml;
mod offsets;
mod split;
mod world;

use std::io::{self, BufRead, BufWriter, Write};
use std::ops::Range;
use std::panic::{self, AssertUnwindSafe};

use serde::Deserialize;
use serde_json::{Map, Value, json};
use typst::WorldExt;
use typst::diag::{Severity, SourceDiagnostic};
use typst::foundations::{Label, Repr, Value as TypstValue};
use typst::introspection::{Introspector, MetadataElem};
use typst::layout::Transform;
use typst::utils::PicoStr;
use typst_html::{HtmlDocument, HtmlOptions};
use typst_layout::PagedDocument;
use typst_svg::SvgOptions;

use crate::world::{OracleWorld, Target};

/// The Typst version the oracle is built against. Must match Cargo.toml.
const TYPST_VERSION: &str = "0.15.1";

/// The base font size of every formula, in points: Typst's default.
const FONT_SIZE: f64 = 11.0;

const LABEL: &str = "typlet-oracle";
const PAGE: &str = "#set page(width: auto, height: auto, margin: 0pt)\n";
const ALL_OUTPUTS: &[&str] = &["cst", "content", "mathml", "frame", "svg", "diagnostics"];
const DEFAULT_OUTPUTS: &[&str] = &["cst", "content", "mathml", "frame", "diagnostics"];

const USAGE: &str = "usage: typlet-oracle <run [--outputs cst,content,mathml,frame,svg,diagnostics] | parse | split | frametree | symbols | names | font | version>";

/// An input record. Fields the corpus carries for other tools, such as `tex`
/// or `cat`, are ignored.
#[derive(Deserialize)]
struct Input {
    id: String,
    src: Option<String>,
    #[serde(default)]
    display: bool,
    preamble: Option<String>,
    expr: Option<String>,
    doc: Option<String>,
    /// For `parse`: `math` (default), `code` or `markup`.
    mode: Option<String>,
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let code = match args.first().map(String::as_str) {
        Some("run") => match parse_outputs(&args[1..]) {
            Ok(outputs) => each_record(|input| run(&input, &outputs)),
            Err(message) => {
                eprintln!("{message}\n{USAGE}");
                2
            }
        },
        Some("split") => each_record_many(split_record),
        Some("frametree") => each_record(|input| frametree(&input)),
        Some("symbols") => symbols(),
        Some("names") => names(),
        Some("font") => font::font(args.get(1).map(String::as_str)),
        Some("parse") => each_record(|input| parse(&input)),
        Some("version") => {
            println!("{TYPST_VERSION}");
            0
        }
        _ => {
            eprintln!("{USAGE}");
            2
        }
    };
    std::process::exit(code);
}

fn parse_outputs(args: &[String]) -> Result<Vec<String>, String> {
    match args {
        [] => Ok(DEFAULT_OUTPUTS.iter().map(|s| s.to_string()).collect()),
        [flag, list] if flag == "--outputs" => {
            let outputs: Vec<String> = list.split(',').map(|s| s.trim().to_string()).collect();
            match outputs.iter().find(|o| !ALL_OUTPUTS.contains(&o.as_str())) {
                Some(unknown) => Err(format!("unknown output: {unknown}")),
                None => Ok(outputs),
            }
        }
        _ => Err("unexpected arguments".into()),
    }
}

/// Runs `f` on every input record and writes one output line per record.
fn each_record(f: impl Fn(Input) -> Map<String, Value>) -> i32 {
    each_record_many(|input| vec![f(input)])
}

/// Runs `f` on every input record and writes its output lines. A record that
/// fails to parse, or makes Typst panic, produces an `error` line instead of
/// stopping the run.
fn each_record_many(f: impl Fn(Input) -> Vec<Map<String, Value>>) -> i32 {
    // Typst panics are reported per record; keep the default hook quiet.
    panic::set_hook(Box::new(|_| {}));

    let stdin = io::stdin();
    let mut stdout = BufWriter::new(io::stdout().lock());
    let mut count = 0usize;
    for line in stdin.lock().lines() {
        let line = line.expect("failed to read stdin");
        if line.trim().is_empty() {
            continue;
        }
        let rows = match serde_json::from_str::<Input>(&line) {
            Ok(input) => {
                let id = input.id.clone();
                panic::catch_unwind(AssertUnwindSafe(|| f(input))).unwrap_or_else(|payload| {
                    let message = payload
                        .downcast_ref::<String>()
                        .cloned()
                        .or_else(|| payload.downcast_ref::<&str>().map(|s| s.to_string()))
                        .unwrap_or_default();
                    let mut row = Map::new();
                    row.insert("id".into(), json!(id));
                    row.insert("panic".into(), json!(message));
                    vec![row]
                })
            }
            Err(error) => {
                let mut row = Map::new();
                row.insert("error".into(), json!(format!("invalid input record: {error}")));
                vec![row]
            }
        };
        for row in rows {
            serde_json::to_writer(&mut stdout, &Value::Object(row)).expect("failed to write stdout");
            stdout.write_all(b"\n").expect("failed to write stdout");
        }
        count += 1;
        // Typst memoizes aggressively; bound memory on long runs.
        if count % 100 == 0 {
            comemo::evict(10);
        }
    }
    stdout.flush().expect("failed to write stdout");
    0
}

/// A generated Typst document and where the user's text sits inside it.
struct Doc {
    text: String,
    preamble: Option<(Range<usize>, String)>,
    body: (Range<usize>, String),
}

impl Doc {
    /// Builds `prefix`, then the preamble on its own line, then `open`, the
    /// body and `close`.
    fn new(prefix: &str, preamble: Option<&str>, open: &str, body: &str, close: &str) -> Self {
        let mut text = String::from(prefix);
        let preamble = preamble.map(|p| {
            let start = text.len();
            text.push_str(p);
            let range = start..text.len();
            text.push('\n');
            (range, p.to_string())
        });
        text.push_str(open);
        let start = text.len();
        text.push_str(body);
        let body = (start..text.len(), body.to_string());
        text.push_str(close);
        Doc { text, preamble, body }
    }

    /// Locates a byte range of the document in the user's text: which part it
    /// falls in, and its UTF-16 range relative to that part.
    fn locate(&self, range: Range<usize>, body_name: &str) -> Option<(String, u32, u32)> {
        let parts = [Some((body_name, &self.body)), self.preamble.as_ref().map(|p| ("preamble", p))];
        parts.into_iter().flatten().find_map(|(name, (part, text))| {
            (range.start >= part.start && range.end <= part.end).then(|| {
                let map = offsets::utf16_map(text);
                (name.to_string(), map[range.start - part.start], map[range.end - part.start])
            })
        })
    }
}

fn diagnostics_json(world: &OracleWorld, doc: &Doc, body_name: &str, diags: &[SourceDiagnostic]) -> Value {
    let list: Vec<Value> = diags
        .iter()
        .map(|diag| {
            let mut out = Map::new();
            let severity = match diag.severity {
                Severity::Error => "error",
                Severity::Warning => "warning",
            };
            out.insert("severity".into(), json!(severity));
            out.insert("message".into(), json!(diag.message.as_str()));
            if !diag.hints.is_empty() {
                let hints: Vec<&str> = diag.hints.iter().map(|hint| hint.v.as_str()).collect();
                out.insert("hints".into(), json!(hints));
            }
            let at = world.range(diag.span).and_then(|range| doc.locate(range, body_name));
            match at {
                Some((part, start, end)) => {
                    out.insert("at".into(), json!(part));
                    out.insert("span".into(), json!([start, end]));
                }
                None => {
                    out.insert("at".into(), Value::Null);
                }
            }
            Value::Object(out)
        })
        .collect();
    Value::Array(list)
}

/// The value of the `<typlet-oracle>` metadata element, if the document has one.
fn metadata_value(doc: &PagedDocument) -> Option<TypstValue> {
    let label = Label::new(PicoStr::intern(LABEL))?;
    let content = doc.introspector().query_label(label).ok()?;
    content.to_packed::<MetadataElem>().map(|meta| meta.value.clone())
}

fn run(input: &Input, outputs: &[String]) -> Map<String, Value> {
    let mut out = Map::new();
    out.insert("id".into(), json!(input.id));
    match (&input.src, &input.expr) {
        (Some(src), None) => formula(input, src, outputs, &mut out),
        (None, Some(expr)) => expression(input, expr, &mut out),
        _ => {
            out.insert("error".into(), json!("a record needs exactly one of `src` and `expr`"));
        }
    }
    out
}

fn delimiters(display: bool) -> (&'static str, &'static str) {
    // A display equation needs whitespace inside both delimiters. The newline
    // before the closing `$` also keeps a trailing line comment from
    // swallowing it.
    if display { ("$ ", "\n$") } else { ("$", "$") }
}

fn formula(input: &Input, src: &str, outputs: &[String], out: &mut Map<String, Value>) {
    let wants = |name: &str| outputs.iter().any(|o| o == name);
    let preamble = input.preamble.as_deref().filter(|p| !p.trim().is_empty());
    let (open, close) = delimiters(input.display);

    if wants("cst") {
        out.insert("cst".into(), cst::math(src));
    }

    if wants("content") {
        let doc = Doc::new("", preamble, &format!("#metadata({open}"), src, &format!("{close}) <{LABEL}>\n"));
        let world = OracleWorld::new(doc.text.clone(), Target::Paged);
        let content = typst::compile::<PagedDocument>(&world)
            .output
            .ok()
            .and_then(|document| metadata_value(&document))
            .and_then(|value| serde_json::to_value(&value).ok())
            .unwrap_or(Value::Null);
        out.insert("content".into(), content);
    }

    if wants("frame") || wants("svg") || wants("diagnostics") {
        let doc = Doc::new(PAGE, preamble, open, src, &format!("{close}\n"));
        let world = OracleWorld::new(doc.text.clone(), Target::Paged);
        let warned = typst::compile::<PagedDocument>(&world);
        let mut diags: Vec<SourceDiagnostic> = warned.warnings.to_vec();
        match warned.output {
            Ok(document) => {
                let page = &document.pages()[0];
                if wants("frame") {
                    out.insert("frame".into(), frame_json(&page.frame, input.display));
                }
                if wants("svg") {
                    out.insert("svg".into(), json!(typst_svg::svg(page, &SvgOptions::default())));
                }
            }
            Err(errors) => {
                diags.extend(errors.iter().cloned());
                if wants("frame") {
                    out.insert("frame".into(), Value::Null);
                }
                if wants("svg") {
                    out.insert("svg".into(), Value::Null);
                }
            }
        }
        if wants("diagnostics") {
            out.insert("diagnostics".into(), diagnostics_json(&world, &doc, "src", &diags));
        }
    }

    if wants("mathml") {
        let doc = Doc::new("", preamble, open, src, &format!("{close}\n"));
        let world = OracleWorld::new(doc.text.clone(), Target::Html);
        let warned = typst::compile::<HtmlDocument>(&world);
        // Every HTML export warns that HTML export is experimental. The
        // warning says nothing about the formula, so fixtures leave it out.
        let mut diags: Vec<SourceDiagnostic> = warned
            .warnings
            .iter()
            .filter(|diag| diag.message != "html export is under active development and incomplete")
            .cloned()
            .collect();
        let html = warned
            .output
            .and_then(|document| typst_html::html(&document, &HtmlOptions::default()));
        match html {
            Ok(html) => {
                out.insert("mathml".into(), json!(mathml::extract(&html)));
            }
            Err(errors) => {
                diags.extend(errors.iter().cloned());
                out.insert("mathml".into(), Value::Null);
            }
        }
        out.insert("mathmlDiagnostics".into(), diagnostics_json(&world, &doc, "src", &diags));
    }
}

/// The laid-out formula: its box, and every glyph and shape relative to the
/// box's anchor (see `frame::locate_equation`). If the equation can't be
/// located, positions stay relative to the page and `box` is null.
fn frame_json(page: &typst::layout::Frame, display: bool) -> Value {
    let located = frame::locate_equation(page, display);
    let (ox, oy) = located.as_ref().map_or((0.0, 0.0), |b| b.origin);
    let mut flat = frame::Flat::default();
    flat.add(page, Transform::translate(typst::layout::Abs::pt(-ox), typst::layout::Abs::pt(-oy)));

    let mut out = Map::new();
    out.insert("fontSize".into(), json!(FONT_SIZE));
    out.insert("box".into(), located.map_or(Value::Null, |b| b.json));
    out.insert(
        "page".into(),
        json!([offsets::round(page.width().to_pt()), offsets::round(page.height().to_pt())]),
    );
    out.extend(flat.into_json());
    Value::Object(out)
}

fn expression(input: &Input, expr: &str, out: &mut Map<String, Value>) {
    let preamble = input.preamble.as_deref().filter(|p| !p.trim().is_empty());
    let doc = Doc::new("", preamble, "#metadata(", expr, &format!(") <{LABEL}>\n"));
    let world = OracleWorld::new(doc.text.clone(), Target::Paged);
    let warned = typst::compile::<PagedDocument>(&world);
    let mut diags: Vec<SourceDiagnostic> = warned.warnings.to_vec();
    match warned.output {
        Ok(document) => {
            let value = metadata_value(&document).map(|value| {
                let mut out = Map::new();
                out.insert("type".into(), json!(value.ty().short_name()));
                out.insert("repr".into(), json!(value.repr().as_str()));
                out.insert("json".into(), serde_json::to_value(&value).unwrap_or(Value::Null));
                if let Some(exact) = exact(&value) {
                    out.insert("exact".into(), exact);
                }
                Value::Object(out)
            });
            out.insert("value".into(), value.unwrap_or(Value::Null));
        }
        Err(errors) => {
            diags.extend(errors.iter().cloned());
            out.insert("value".into(), Value::Null);
        }
    }
    out.insert("diagnostics".into(), diagnostics_json(&world, &doc, "expr", &diags));
}

/// Full-precision numbers for numeric values. Their `repr` rounds, such as
/// `1em/6` → `0.17em`, so tests compare these instead.
fn exact(value: &TypstValue) -> Option<Value> {
    Some(match value {
        TypstValue::Float(v) => json!({ "float": v }),
        TypstValue::Length(v) => json!({ "abs": v.abs.to_pt(), "em": v.em.get() }),
        TypstValue::Angle(v) => json!({ "deg": v.to_deg() }),
        TypstValue::Ratio(v) => json!({ "ratio": v.get() }),
        TypstValue::Relative(v) => {
            json!({ "ratio": v.rel.get(), "abs": v.abs.abs.to_pt(), "em": v.abs.em.get() })
        }
        TypstValue::Fraction(v) => json!({ "fr": v.get() }),
        _ => return None,
    })
}

fn split_record(input: Input) -> Vec<Map<String, Value>> {
    let Some(doc) = &input.doc else {
        let mut row = Map::new();
        row.insert("id".into(), json!(input.id));
        row.insert("error".into(), json!("a split record needs `doc`"));
        return vec![row];
    };
    split::split(doc)
        .into_iter()
        .enumerate()
        .map(|(i, formula)| {
            let mut row = Map::new();
            row.insert("id".into(), json!(format!("{}-{}", input.id, i + 1)));
            row.insert("src".into(), json!(formula.src));
            row.insert("display".into(), json!(formula.display));
            row.insert("preamble".into(), json!(formula.preamble));
            row
        })
        .collect()
}

/// Writes every variant of every symbol in Typst's `sym` module, in codex's
/// order: `{"module", "name", "modifiers", "value", "deprecated"?,
/// "bindingDeprecated"?}`. `module` is the dot-separated path of the nested
/// module that defines the symbol, such as `gender`, and empty at the top
/// level. `modifiers` is dot-separated and empty for the base variant.
/// `deprecated` belongs to the variant and `bindingDeprecated` to the name.
fn symbols() -> i32 {
    let mut stdout = BufWriter::new(io::stdout().lock());
    write_symbols(&mut stdout, "", codex::SYM, None);
    stdout.flush().expect("failed to write stdout");
    0
}

/// Writes the symbols of a codex module and, recursively, its nested modules.
fn write_symbols(
    stdout: &mut impl Write,
    path: &str,
    module: codex::Module,
    module_deprecation: Option<&str>,
) {
    for (name, binding) in module.iter() {
        let deprecation = binding.deprecation.or(module_deprecation);
        match binding.def {
            codex::Def::Module(inner) => {
                let path = if path.is_empty() { name.to_string() } else { format!("{path}.{name}") };
                write_symbols(stdout, &path, inner, deprecation);
            }
            codex::Def::Symbol(symbol) => {
                for (modifiers, value, variant_deprecation) in symbol.variants() {
                    let mut row = Map::new();
                    row.insert("module".into(), json!(path));
                    row.insert("name".into(), json!(name));
                    row.insert(
                        "modifiers".into(),
                        json!(modifiers.into_iter().collect::<Vec<_>>().join(".")),
                    );
                    row.insert("value".into(), json!(value));
                    if let Some(message) = variant_deprecation {
                        row.insert("deprecated".into(), json!(message));
                    }
                    if let Some(message) = deprecation {
                        row.insert("bindingDeprecated".into(), json!(message));
                    }
                    serde_json::to_writer(&mut *stdout, &Value::Object(row))
                        .expect("failed to write stdout");
                    stdout.write_all(b"\n").expect("failed to write stdout");
                }
            }
        }
    }
}

/// Writes every name in Typst's global scope and math scope:
/// `{"scope", "name", "type", "deprecated"?, "params"?}`. Functions list their
/// parameters as `{"name", "input", "positional", "named", "variadic",
/// "required", "settable", "default"?}`, where `input` describes the accepted
/// values and `default` is the repr of the default value.
fn names() -> i32 {
    let library = world::paged_library();
    let mut stdout = BufWriter::new(io::stdout().lock());
    for (scope_name, module) in [("global", &library.global), ("math", &library.math)] {
        for (name, binding) in module.scope().iter() {
            let value = binding.read();
            let mut row = Map::new();
            row.insert("scope".into(), json!(scope_name));
            row.insert("name".into(), json!(name.as_str()));
            row.insert("type".into(), json!(value.ty().short_name()));
            if let Some(deprecation) = binding.deprecation() {
                row.insert("deprecated".into(), json!(deprecation.message()));
            }
            if let TypstValue::Func(func) = value {
                let params: Vec<Value> = func
                    .params()
                    .filter_map(|param| param.to_native())
                    .map(|param| {
                        let mut p = Map::new();
                        p.insert("name".into(), json!(param.name));
                        p.insert("input".into(), cast_info(&param.input));
                        p.insert("positional".into(), json!(param.positional));
                        p.insert("named".into(), json!(param.named));
                        p.insert("variadic".into(), json!(param.variadic));
                        p.insert("required".into(), json!(param.required));
                        p.insert("settable".into(), json!(param.settable));
                        if let Some(default) = param.default {
                            p.insert("default".into(), json!(default().repr().as_str()));
                        }
                        Value::Object(p)
                    })
                    .collect();
                row.insert("params".into(), json!(params));
            }
            serde_json::to_writer(&mut stdout, &Value::Object(row)).expect("failed to write stdout");
            stdout.write_all(b"\n").expect("failed to write stdout");
        }
    }
    stdout.flush().expect("failed to write stdout");
    0
}

/// Describes what a parameter accepts: a list of type names and value reprs,
/// such as `["none", "\"(\"", "symbol"]`, or `["any"]`.
fn cast_info(info: &typst::foundations::CastInfo) -> Value {
    let mut parts = vec![];
    info.walk(|info| match info {
        typst::foundations::CastInfo::Any => parts.push("any".to_string()),
        typst::foundations::CastInfo::Value(value, _) => parts.push(value.repr().to_string()),
        typst::foundations::CastInfo::Type(ty) => parts.push(ty.short_name().to_string()),
        typst::foundations::CastInfo::Union(_) => {}
    });
    json!(parts)
}

/// Parses `src` without compiling it: the syntax tree only. Fast enough for fuzzing.
fn parse(input: &Input) -> Map<String, Value> {
    let mut out = Map::new();
    out.insert("id".into(), json!(input.id));
    let mode = input.mode.as_deref().unwrap_or("math");
    match (&input.src, cst::parse(input.src.as_deref().unwrap_or(""), mode)) {
        (Some(_), Some(tree)) => {
            out.insert("cst".into(), tree);
        }
        (None, _) => {
            out.insert("error".into(), json!("a parse record needs `src`"));
        }
        (_, None) => {
            out.insert("error".into(), json!(format!("unknown mode: {mode}")));
        }
    }
    out
}

fn frametree(input: &Input) -> Map<String, Value> {
    let mut out = Map::new();
    out.insert("id".into(), json!(input.id));
    let Some(src) = &input.src else { return out };
    let (open, close) = delimiters(input.display);
    let preamble = input.preamble.as_deref().filter(|p| !p.trim().is_empty());
    let doc = Doc::new(PAGE, preamble, open, src, &format!("{close}\n"));
    let world = OracleWorld::new(doc.text, Target::Paged);
    if let Ok(document) = typst::compile::<PagedDocument>(&world).output {
        out.insert("tree".into(), frame::tree(&document.pages()[0].frame));
    }
    out
}
