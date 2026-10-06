//! Extracts MathML from Typst's HTML export.

/// Returns every top-level `<math>…</math>` element in `html`, in order.
/// Nested `<math>` elements (Typst emits them for boxed content) stay inside
/// their parent.
pub fn extract(html: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut depth = 0usize;
    let mut start = 0usize;
    let mut i = 0usize;
    let bytes = html.as_bytes();

    // Match on bytes: stepping through a `&str` one byte at a time would
    // slice inside multi-byte characters such as `𝑥`. Every slice below
    // starts and ends at a `<` or `>`, which are always character boundaries.
    while i < bytes.len() {
        if bytes[i..].starts_with(b"</math>") {
            depth = depth.saturating_sub(1);
            i += "</math>".len();
            if depth == 0 {
                found.push(html[start..i].to_string());
            }
        } else if bytes[i..].starts_with(b"<math")
            && matches!(bytes.get(i + 5), Some(b'>' | b' ' | b'/'))
        {
            if depth == 0 {
                start = i;
            }
            depth += 1;
            i += 5;
        } else {
            i += 1;
        }
    }

    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_multibyte_characters() {
        let html = "<p><math><mi>𝑥</mi></math>∑</p>";
        assert_eq!(extract(html), vec!["<math><mi>𝑥</mi></math>".to_string()]);
    }

    #[test]
    fn keeps_nested_math_inside_its_parent() {
        let html = "<p><math><mi>x</mi><math><mi>z</mi></math></math> and <math display=\"block\"><mn>1</mn></math></p>";
        assert_eq!(
            extract(html),
            vec![
                "<math><mi>x</mi><math><mi>z</mi></math></math>".to_string(),
                "<math display=\"block\"><mn>1</mn></math>".to_string(),
            ]
        );
    }
}
