//! Typst works with UTF-8 byte offsets, JavaScript with UTF-16 code units.
//! Fixtures use UTF-16 so Typlet's tests can compare offsets directly.

/// Maps every UTF-8 byte offset of `text` (including `text.len()`) to the
/// UTF-16 offset of the character it falls in.
pub fn utf16_map(text: &str) -> Vec<u32> {
    let mut map = Vec::with_capacity(text.len() + 1);
    let mut units = 0u32;
    for c in text.chars() {
        for _ in 0..c.len_utf8() {
            map.push(units);
        }
        units += c.len_utf16() as u32;
    }
    map.push(units);
    map
}

/// Rounds a length in points to 1/1000 pt and turns `-0` into `0`, so
/// fixtures stay stable across platforms.
pub fn round(value: f64) -> f64 {
    let rounded = (value * 1000.0).round() / 1000.0;
    if rounded == 0.0 { 0.0 } else { rounded }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_multibyte_characters() {
        // "a" is 1 byte, "α" 2 bytes, "𝑥" 4 bytes and 2 UTF-16 units.
        let map = utf16_map("aα𝑥");
        assert_eq!(map, vec![0, 1, 1, 2, 2, 2, 2, 4]);
    }

    #[test]
    fn rounds_and_normalizes_zero() {
        assert_eq!(round(1.23456), 1.235);
        assert_eq!(round(-0.0001).to_string(), "0");
    }
}
