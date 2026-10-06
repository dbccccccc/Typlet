//! Splits Typst documents into standalone formulas.
//!
//! Each equation in the document's markup becomes a formula. Its preamble is
//! every `let`, `set`, `show` and `import` statement that precedes it, in
//! order. Equations inside code, such as `#box($x$)`, are not extracted.

use typst::syntax::ast;
use typst::syntax::{SyntaxKind, SyntaxNode};

pub struct Formula {
    pub src: String,
    pub display: bool,
    pub preamble: Vec<String>,
}

pub fn split(doc: &str) -> Vec<Formula> {
    let root = typst::syntax::parse(doc);
    let mut preamble = Vec::new();
    let mut formulas = Vec::new();
    walk(&root, &mut preamble, &mut formulas);
    formulas
}

fn walk(node: &SyntaxNode, preamble: &mut Vec<String>, formulas: &mut Vec<Formula>) {
    for child in node.children() {
        match child.kind() {
            SyntaxKind::Equation => {
                let Some(equation) = child.cast::<ast::Equation>() else { continue };
                let body = child
                    .children()
                    .find(|c| c.kind() == SyntaxKind::Math)
                    .map(|math| math.full_text().trim().to_string())
                    .unwrap_or_default();
                formulas.push(Formula { src: body, display: equation.block(), preamble: preamble.clone() });
            }
            SyntaxKind::LetBinding
            | SyntaxKind::SetRule
            | SyntaxKind::ShowRule
            | SyntaxKind::ModuleImport => {
                preamble.push(format!("#{}", child.full_text()));
            }
            SyntaxKind::Markup
            | SyntaxKind::Strong
            | SyntaxKind::Emph
            | SyntaxKind::Heading
            | SyntaxKind::ListItem
            | SyntaxKind::EnumItem
            | SyntaxKind::TermItem => walk(child, preamble, formulas),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_equations_with_preceding_statements() {
        let doc = "#set math.mat(delim: \"[\")\nSee $x^2$ and\n#let f = 1\n$ mat(1, 2) $\n*Bold $y$*";
        let formulas = split(doc);
        let summary: Vec<_> = formulas.iter().map(|f| (f.src.as_str(), f.display, f.preamble.len())).collect();
        assert_eq!(summary, vec![("x^2", false, 1), ("mat(1, 2)", true, 2), ("y", false, 2)]);
        assert_eq!(formulas[1].preamble, vec!["#set math.mat(delim: \"[\")", "#let f = 1"]);
    }

    #[test]
    fn skips_equations_inside_code() {
        assert!(split("#box($x$)").is_empty());
    }
}
