// Ported from codex 0.3.0: src/styling.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// Math alphanumeric styling: which style a character gets in math, and the
// styled character. codex lists a code point delta per character range; the
// Unicode blocks share one layout, so Typlet stores each style's first code
// point for Latin, Greek and digits, plus the exceptions where Unicode reuses
// older characters (such as ℎ for italic h). Only the styles that
// `MathStyle::select` can choose are included; the Arabic ones are not.

/** The math variants a `math.bb`-like function sets. */
export type MathVariant = 'plain' | 'fraktur' | 'sans-serif' | 'monospace' | 'double-struck' | 'chancery' | 'roundhand';

export type MathStyle =
  | 'plain'
  | 'bold'
  | 'italic'
  | 'bold-italic'
  | 'fraktur'
  | 'bold-fraktur'
  | 'sans-serif'
  | 'sans-serif-bold'
  | 'sans-serif-italic'
  | 'sans-serif-bold-italic'
  | 'monospace'
  | 'double-struck'
  | 'double-struck-italic'
  | 'chancery'
  | 'bold-chancery'
  | 'roundhand'
  | 'bold-roundhand'
  | 'hebrew';

const isDigit = (c: number) => c >= 0x30 && c <= 0x39;
const isLatin = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isUpperGreek = (c: number) => (c >= 0x391 && c <= 0x3a9) || c === 0x2207 || c === 0x3f4;
const isLowerGreek = (c: number) =>
  (c >= 0x3b1 && c <= 0x3c9) || [0x2202, 0x3f5, 0x3d1, 0x3f0, 0x3d5, 0x3f1, 0x3d6].includes(c);
const isGreek = (c: number) => isUpperGreek(c) || isLowerGreek(c);
const isHebrew = (c: number) => c >= 0x5d0 && c <= 0x5d3;

/** Chooses the style for a character, as `MathStyle::select` does. */
export function selectStyle(c: number, variant: MathVariant | null, bold: boolean, italic: boolean | null): MathStyle {
  switch (variant ?? 'plain') {
    case 'sans-serif':
      if (isLatin(c)) {
        if (!bold) return italic === false ? 'sans-serif' : 'sans-serif-italic';
        return italic === false ? 'sans-serif-bold' : 'sans-serif-bold-italic';
      }
      if (isDigit(c)) return bold ? 'sans-serif-bold' : 'sans-serif';
      if (italic === false && isGreek(c)) return 'sans-serif-bold';
      if (italic === true && isGreek(c)) return 'sans-serif-bold-italic';
      if (italic === null && isUpperGreek(c)) return 'sans-serif-bold';
      if (italic === null && isLowerGreek(c)) return 'sans-serif-bold-italic';
      break;
    case 'fraktur':
      if (isLatin(c)) return bold ? 'bold-fraktur' : 'fraktur';
      break;
    case 'monospace':
      if (isDigit(c) || isLatin(c)) return 'monospace';
      break;
    case 'double-struck':
      if (italic === true && [0x44, 0x64, 0x65, 0x69, 0x6a].includes(c)) return 'double-struck-italic';
      if (isDigit(c) || isLatin(c) || [0x2211, 0x393, 0x3a0, 0x3b3, 0x3c0].includes(c)) return 'double-struck';
      break;
    case 'chancery':
      if (isLatin(c)) return bold ? 'bold-chancery' : 'chancery';
      break;
    case 'roundhand':
      if (isLatin(c)) return bold ? 'bold-roundhand' : 'roundhand';
      break;
  }
  if (!bold && italic === true && (isLatin(c) || isGreek(c))) return 'italic';
  if (!bold && italic === null && (isLatin(c) || isLowerGreek(c))) return 'italic';
  if (bold && italic === false && (isLatin(c) || isGreek(c))) return 'bold';
  if (bold && italic === true && (isLatin(c) || isGreek(c))) return 'bold-italic';
  if (bold && italic === null && (isLatin(c) || isLowerGreek(c))) return 'bold-italic';
  if (bold && italic === null && isUpperGreek(c)) return 'bold';
  if (bold && (isDigit(c) || c === 0x3dc || c === 0x3dd)) return 'bold';
  if (italic !== false && (c === 0x131 || c === 0x237 || c === 0x127)) return 'italic';
  if (italic !== false && isHebrew(c)) return 'hebrew';
  return 'plain';
}

/** Where a style's alphabets start, and the characters that are elsewhere. */
interface Alphabets {
  /** The styled `A`; `a` follows 26 code points later. */
  readonly latin?: number;
  /** The styled `Α`, in the shared layout of the math Greek alphabets. */
  readonly greek?: number;
  /** The styled `0`. */
  readonly digits?: number;
  readonly exceptions?: Readonly<Record<number, number>>;
}

const SCRIPT: Alphabets = {
  latin: 0x1d49c,
  exceptions: {
    0x67: 0x210a, 0x48: 0x210b, 0x49: 0x2110, 0x4c: 0x2112, 0x52: 0x211b, 0x42: 0x212c,
    0x65: 0x212f, 0x45: 0x2130, 0x46: 0x2131, 0x4d: 0x2133, 0x6f: 0x2134,
  },
};
const BOLD_SCRIPT: Alphabets = { latin: 0x1d4d0 };

const ALPHABETS: Partial<Record<MathStyle, Alphabets>> = {
  bold: { latin: 0x1d400, greek: 0x1d6a8, digits: 0x1d7ce, exceptions: { 0x3dc: 0x1d7ca, 0x3dd: 0x1d7cb } },
  italic: { latin: 0x1d434, greek: 0x1d6e2, exceptions: { 0x68: 0x210e, 0x127: 0x210f, 0x131: 0x1d6a4, 0x237: 0x1d6a5 } },
  'bold-italic': { latin: 0x1d468, greek: 0x1d71c },
  fraktur: {
    latin: 0x1d504,
    exceptions: { 0x48: 0x210c, 0x49: 0x2111, 0x52: 0x211c, 0x5a: 0x2128, 0x43: 0x212d },
  },
  'bold-fraktur': { latin: 0x1d56c },
  'sans-serif': { latin: 0x1d5a0, digits: 0x1d7e2 },
  'sans-serif-bold': { latin: 0x1d5d4, greek: 0x1d756, digits: 0x1d7ec },
  'sans-serif-italic': { latin: 0x1d608 },
  'sans-serif-bold-italic': { latin: 0x1d63c, greek: 0x1d790 },
  monospace: { latin: 0x1d670, digits: 0x1d7f6 },
  'double-struck': {
    latin: 0x1d538,
    digits: 0x1d7d8,
    exceptions: {
      0x43: 0x2102, 0x48: 0x210d, 0x4e: 0x2115, 0x50: 0x2119, 0x51: 0x211a, 0x52: 0x211d, 0x5a: 0x2124,
      0x3c0: 0x213c, 0x3b3: 0x213d, 0x393: 0x213e, 0x3a0: 0x213f, 0x2211: 0x2140,
    },
  },
  'double-struck-italic': { exceptions: { 0x44: 0x2145, 0x64: 0x2146, 0x65: 0x2147, 0x69: 0x2148, 0x6a: 0x2149 } },
  hebrew: { exceptions: { 0x5d0: 0x2135, 0x5d1: 0x2136, 0x5d2: 0x2137, 0x5d3: 0x2138 } },
};

// The position of each Greek character in the math Greek alphabets.
const GREEK_EXTRAS: Readonly<Record<number, number>> = {
  0x3f4: 17, // ϴ, in the gap after Ρ
  0x2207: 25, // ∇
  0x2202: 51, // ∂
  0x3f5: 52, // ϵ
  0x3d1: 53, // ϑ
  0x3f0: 54, // ϰ
  0x3d5: 55, // ϕ
  0x3f1: 56, // ϱ
  0x3d6: 57, // ϖ
};

function styleWith(c: number, a: Alphabets): number {
  const exception = a.exceptions?.[c];
  if (exception !== undefined) return exception;
  if (a.latin !== undefined) {
    if (c >= 0x41 && c <= 0x5a) return a.latin + (c - 0x41);
    if (c >= 0x61 && c <= 0x7a) return a.latin + 26 + (c - 0x61);
  }
  if (a.digits !== undefined && isDigit(c)) return a.digits + (c - 0x30);
  if (a.greek !== undefined) {
    if ((c >= 0x391 && c <= 0x3a1) || (c >= 0x3a3 && c <= 0x3a9)) return a.greek + (c - 0x391);
    if (c >= 0x3b1 && c <= 0x3c9) return a.greek + 26 + (c - 0x3b1);
    const extra = GREEK_EXTRAS[c];
    if (extra !== undefined) return a.greek + extra;
  }
  return c;
}

/** The styled form of a character, as `to_style` gives it. Scripts may add a variation selector. */
export function toStyle(c: number, style: MathStyle): string {
  switch (style) {
    case 'plain':
      return String.fromCodePoint(c);
    case 'chancery':
    case 'roundhand':
    case 'bold-chancery':
    case 'bold-roundhand': {
      const base = style.startsWith('bold') ? BOLD_SCRIPT : SCRIPT;
      const selector = isLatin(c) ? (style.endsWith('chancery') ? '︀' : '︁') : '';
      return String.fromCodePoint(styleWith(c, base)) + selector;
    }
    default:
      return String.fromCodePoint(styleWith(c, ALPHABETS[style]!));
  }
}

/** Styles every character of a string. */
export function styleText(text: string, variant: MathVariant | null, bold: boolean, italic: boolean | null): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    out += toStyle(c, selectStyle(c, variant, bold, italic));
  }
  return out;
}
