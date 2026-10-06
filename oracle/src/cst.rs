//! Dumps typst-syntax trees in a compact JSON form.
//!
//! Each node is an array:
//! - inner node: `[kind, start, end, [children...]]`
//! - leaf: `[kind, start, end]`
//! - error: `["Error", start, end, message, [hints...]]`
//!
//! `kind` is the `SyntaxKind` variant name, such as `MathIdent`. Offsets are
//! UTF-16 code units into the parsed text. Leaf text can be recovered by
//! slicing the source, so it is not repeated.

use serde_json::{Value, json};
use typst::syntax::{SyntaxKind, SyntaxNode};

use crate::offsets::utf16_map;

/// Parses `text` in math mode and dumps the tree.
pub fn math(text: &str) -> Value {
    let root = typst::syntax::parse_math(text);
    dump(&root, 0, &utf16_map(text))
}

/// Parses `text` in the given mode (`math`, `code` or `markup`) and dumps the tree.
pub fn parse(text: &str, mode: &str) -> Option<Value> {
    let root = match mode {
        "math" => typst::syntax::parse_math(text),
        "code" => typst::syntax::parse_code(text),
        "markup" => typst::syntax::parse(text),
        _ => return None,
    };
    Some(dump(&root, 0, &utf16_map(text)))
}

fn dump(node: &SyntaxNode, start: usize, map: &[u32]) -> Value {
    let end = start + node.len();
    let kind = format!("{:?}", node.kind());
    let (s, e) = (map[start], map[end]);

    if node.kind() == SyntaxKind::Error {
        let (errors, _) = node.errors_and_warnings();
        let (message, hints) = match errors.first() {
            Some(error) => (
                error.message.to_string(),
                error.hints.iter().map(|hint| hint.v.to_string()).collect::<Vec<_>>(),
            ),
            None => (String::new(), vec![]),
        };
        return json!([kind, s, e, message, hints]);
    }

    let mut children = Vec::new();
    let mut offset = start;
    for child in node.children() {
        children.push(dump(child, offset, map));
        offset += child.len();
    }

    if children.is_empty() { json!([kind, s, e]) } else { json!([kind, s, e, children]) }
}
