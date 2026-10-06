// Typlet original: not ported from Typst.
//
// Unicode predicates on code points, matching the Rust functions typst-syntax
// uses: `char::is_whitespace`, `char::is_numeric`, `char::is_alphabetic`,
// unicode-ident's XID properties, unicode-script and unicode-segmentation.
// They rely on the JavaScript engine's Unicode data, which may be a slightly
// different Unicode version than the Rust crates; only characters added in
// recent versions can differ.

const WHITE_SPACE = /\p{White_Space}/u;
const NUMERIC = /\p{N}/u;
const ALPHABETIC = /\p{Alphabetic}/u;
const XID_START = /\p{XID_Start}/u;
const XID_CONTINUE = /\p{XID_Continue}/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;
const MARK = /\p{M}/u;

const ch = String.fromCodePoint;

// Each predicate answers for ASCII, and other common characters, without its
// regular expression: compiling one takes a tenth of a millisecond or more,
// which the first formula would otherwise pay for each.

// The ranges of Default_Ignorable_Code_Point, as start and end pairs, which
// DerivedCoreProperties.txt lists in Unicode 16 and 17.
const IGNORABLE_RANGES = [
  0xad, 0xad, 0x34f, 0x34f, 0x61c, 0x61c, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180b, 0x180f, 0x200b, 0x200f, 0x202a, 0x202e,
  0x2060, 0x206f, 0x3164, 0x3164, 0xfe00, 0xfe0f, 0xfeff, 0xfeff, 0xffa0, 0xffa0, 0xfff0, 0xfff8, 0x1bca0, 0x1bca3,
  0x1d173, 0x1d17a, 0xe0000, 0xe0fff,
];

/** The Default_Ignorable_Code_Point property. Only characters in its ranges are tested. */
export function isDefaultIgnorable(c: number): boolean {
  for (let i = 0; i < IGNORABLE_RANGES.length; i += 2) {
    if (c < IGNORABLE_RANGES[i]!) return false;
    if (c <= IGNORABLE_RANGES[i + 1]!) return DEFAULT_IGNORABLE.test(ch(c));
  }
  return false;
}

/**
 * General category M, the marks. They start at U+0300, and none are among
 * the arrows, operators and symbols from U+2100 to U+2BFF or the math
 * alphanumerics.
 */
export function isMark(c: number): boolean {
  if (c < 0x300 || (c >= 0x2100 && c <= 0x2bff) || (c >= 0x1d400 && c <= 0x1d7ff)) return false;
  return MARK.test(ch(c));
}

/** Rust's `char::is_whitespace`: the White_Space property. */
export function isWhitespace(c: number): boolean {
  if (c < 0x80) return c === 0x20 || (c >= 0x09 && c <= 0x0d);
  return WHITE_SPACE.test(ch(c));
}

/** Rust's `char::is_numeric`: general categories Nd, Nl and No. */
export function isNumeric(c: number): boolean {
  if (c < 0x80) return c >= 0x30 && c <= 0x39;
  return NUMERIC.test(ch(c));
}

/** Rust's `char::is_alphabetic`: the Alphabetic property. */
export function isAlphabetic(c: number): boolean {
  if (c < 0x80) return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
  return ALPHABETIC.test(ch(c));
}

/** Rust's `char::is_alphanumeric`. */
export function isAlphanumeric(c: number): boolean {
  return isAlphabetic(c) || isNumeric(c);
}

export function isAsciiDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

export function isAsciiHexDigit(c: number): boolean {
  return isAsciiDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}

export function isAsciiAlphanumeric(c: number): boolean {
  return isAsciiDigit(c) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

/** unicode-ident's `is_xid_start`. */
export function isXidStart(c: number): boolean {
  if (c < 0x80) return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
  return XID_START.test(ch(c));
}

/** unicode-ident's `is_xid_continue`. */
export function isXidContinue(c: number): boolean {
  if (c < 0x80) return isAsciiAlphanumeric(c) || c === 0x5f;
  return XID_CONTINUE.test(ch(c));
}

/** Whether the character's script is Han, Hiragana, Katakana or Hangul. */
export function isCjk(c: number): boolean {
  return c >= 0x80 && CJK.test(ch(c));
}

type Segmenter = { segment(input: string): Iterable<{ segment: string }> };
let segmenter: Segmenter | null | undefined;

function getSegmenter(): Segmenter | null {
  if (segmenter === undefined) {
    const Intl_ = (globalThis as { Intl?: { Segmenter?: new (locale: undefined, options: object) => Segmenter } }).Intl;
    segmenter = Intl_?.Segmenter ? new Intl_.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  }
  return segmenter;
}

const EXTEND = /[\p{Grapheme_Extend}‍︎️]/u;

// Characters that join the character before them into one cluster (UAX #29):
// extenders, zero-width joiners, spacing marks and emoji modifiers.
const ATTACHES = /[\p{Grapheme_Extend}\p{Mc}‍ำຳ\u{1f3fb}-\u{1f3ff}]/u;

// Characters that can join the character after them: CR (before LF), Hangul
// jamo and syllables, regional indicators, and prepended concatenation marks.
const JOINS_NEXT =
  /[\r\p{Script=Hangul}\u{1f1e6}-\u{1f1ff}؀-؅۝܏࢐࢑࣢ൎ\u{110bd}\u{110cd}\u{111c2}\u{111c3}\u{1193f}\u{11941}\u{11a3a}\u{11a84}-\u{11a89}\u{11d46}\u{11f02}]/u;

/** The UTF-16 length of the extended grapheme cluster starting at `index`. */
export function graphemeLength(text: string, index: number): number {
  if (index >= text.length) return 0;
  const first = text.codePointAt(index)!;
  const firstLen = first > 0xffff ? 2 : 1;
  if (index + firstLen >= text.length) return firstLen;
  const next = text.codePointAt(index + firstLen)!;
  // Fast paths: most clusters are one code point, which the next code point
  // doesn't attach to. Only the rest needs full segmentation.
  if (first !== 0x0d && first < 0x600 && next < 0x300) return firstLen;
  if (!JOINS_NEXT.test(ch(first)) && !ATTACHES.test(ch(next))) return firstLen;
  const segments = getSegmenter();
  if (segments) {
    for (const { segment } of segments.segment(text.slice(index, index + 64))) return segment.length;
  }
  // Without Intl.Segmenter, extend over combining marks and joiners.
  let end = index + firstLen;
  while (end < text.length) {
    const c = text.codePointAt(end)!;
    if (c === 0x200d) {
      end += 1;
      if (end < text.length) end += text.codePointAt(end)! > 0xffff ? 2 : 1;
    } else if (EXTEND.test(ch(c))) {
      end += c > 0xffff ? 2 : 1;
    } else {
      break;
    }
  }
  return end - index;
}

/** Splits `text` into extended grapheme clusters. */
export function graphemes(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; ) {
    const len = graphemeLength(text, i);
    out.push(text.slice(i, i + len));
    i += len;
  }
  return out;
}

/** Whether `text` consists of exactly one extended grapheme cluster. */
export function isSingleGrapheme(text: string): boolean {
  return text.length > 0 && graphemeLength(text, 0) === text.length;
}
