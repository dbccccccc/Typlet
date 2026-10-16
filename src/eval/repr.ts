// Ported from Typst 0.15.1: crates/typst-library/src/foundations/repr.rs, crates/typst-utils/src/round.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { ReprBuilder, getValueBudget } from './value-budget.js';

// Typst formats numbers with Rust's `Display` and `Debug` implementations for
// `f64`. Both print the shortest digits that round-trip, which is also what
// JavaScript's `toExponential()` produces, but they lay the digits out
// differently. The helpers below rebuild Rust's layouts from those digits.

/** The minus sign Typst uses when displaying negative numbers as text. */
export const MINUS_SIGN = '−';

/** Splits a finite, non-zero magnitude into its shortest digits and decimal exponent. */
function shortestDigits(abs: number): [digits: string, exp: number] {
  const [mantissa, exp] = abs.toExponential().split('e') as [string, string];
  return [mantissa.replace('.', ''), Number(exp)];
}

/** Positional notation of `digits × 10^exp`, without a fractional part if it is zero. */
function positional(digits: string, exp: number): string {
  if (exp < 0) return `0.${'0'.repeat(-exp - 1)}${digits}`;
  if (digits.length <= exp + 1) return digits + '0'.repeat(exp + 1 - digits.length);
  return `${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`;
}

/** Rust's `format!("{}", x)` for a finite `f64`. */
export function rustDisplayFloat(x: number): string {
  // In this range, JavaScript prints the same digits without an exponent.
  const abs = Math.abs(x);
  if (abs >= 1e-6 && abs < 1e21) return String(x);
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x < 0 ? '-inf' : 'inf';
  const sign = x < 0 || Object.is(x, -0) ? '-' : '';
  if (x === 0) return `${sign}0`;
  const [digits, exp] = shortestDigits(Math.abs(x));
  return sign + positional(digits, exp);
}

/** Rust's `format!("{:?}", x)` for an `f64`: decimal with a separator, or exponential for extreme magnitudes. */
export function rustDebugFloat(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x < 0 ? '-inf' : 'inf';
  const sign = x < 0 || Object.is(x, -0) ? '-' : '';
  const abs = Math.abs(x);
  if (abs === 0) return `${sign}0.0`;
  const [digits, exp] = shortestDigits(abs);
  if (abs < 1e16 && abs >= 1e-4) {
    const text = positional(digits, exp);
    return sign + (text.includes('.') ? text : `${text}.0`);
  }
  const mantissa = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  return `${sign}${mantissa}e${exp}`;
}

/** Rust's `f64::round`: halfway cases round away from zero. */
export function roundHalfAway(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** Rounds `value` to `precision` decimal digits, as `typst_utils::round_with_precision` does. */
export function roundWithPrecision(value: number, precision: number): number {
  if (
    !Number.isFinite(value) ||
    (precision >= 0 && Math.abs(value) >= 2 ** 53) ||
    precision >= 15
  ) {
    return value;
  }
  if (precision < -308) return value * 0;
  if (precision > 0) {
    const offset = 10 ** precision;
    return roundHalfAway(value * offset) / offset;
  }
  const offset = 10 ** -precision;
  return roundHalfAway(value / offset) * offset;
}

/** Formats an integer in the given base, with the Unicode minus sign. */
export function formatIntWithBase(n: bigint, base: number): string {
  if (n === 0n) return '0';
  const text = (n < 0n ? -n : n).toString(base);
  return n < 0n ? MINUS_SIGN + text : text;
}

/** Converts a float to a string, rounding it to `precision` digits first. */
export function formatFloat(
  value: number,
  precision: number | null,
  forceSeparator: boolean,
  unit: string,
): string {
  if (precision !== null) value = roundWithPrecision(value, precision);
  const unitMultiplication = unit === '' ? '' : ' * 1';
  if (Number.isNaN(value)) return `float.nan${unitMultiplication}${unit}`;
  if (!Number.isFinite(value)) {
    return `${value < 0 ? '-' : ''}float.inf${unitMultiplication}${unit}`;
  }
  return (forceSeparator ? rustDebugFloat(value) : rustDisplayFloat(value)) + unit;
}

/** Formats a component of a compound value, such as a color channel. */
export function formatFloatComponent(value: number): string {
  return formatFloat(value, 3, false, '');
}

/** Formats a float with a unit, such as `1.5pt`. */
export function formatFloatWithUnit(value: number, unit: string): string {
  return formatFloat(value, 2, false, unit);
}

/** Converts a float to the text that displays it, with the Unicode minus sign. */
export function displayFloat(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return `${value < 0 ? MINUS_SIGN : ''}∞`;
  const text = rustDisplayFloat(Math.abs(value));
  return value < 0 ? MINUS_SIGN + text : text;
}

/** Joins pieces as in "a, b, or c". */
export function separatedList(pieces: readonly string[], last: string): string {
  let buf = '';
  pieces.forEach((part, i) => {
    if (i === 0) {
      // Nothing before the first piece.
    } else if (i === 1 && pieces.length === 2) {
      buf += ` ${last} `;
    } else if (i + 1 === pieces.length) {
      buf += `, ${last} `;
    } else {
      buf += ', ';
    }
    buf += part;
  });
  return buf;
}

/** Concatenates representation pieces without first building an oversized result. */
export function joinRepr(parts: Iterable<string>, separator = ''): string {
  const out = new ReprBuilder();
  let between = '';
  for (const part of parts) {
    out.push(between);
    out.push(part);
    between = separator;
  }
  return out.finish();
}

/** Joins pieces with commas, breaking them onto lines when they get long. */
export function prettyCommaList(pieces: Iterable<string>, trailingComma: boolean): string {
  const parts: string[] = [];
  const budget = getValueBudget();
  let length = 0;
  let width = 0;
  for (const piece of pieces) {
    length += piece.length + (parts.length ? 2 : 0);
    budget.checkString(length);
    // Only the 50-byte boundary matters. A wide child can be a large nested
    // representation, so do not rescan it at every enclosing collection.
    if (width <= 50) width += (parts.length ? 2 : 0) + (piece.length > 50 ? 51 : utf8Length(piece));
    parts.push(piece);
  }
  if (width <= 50) {
    budget.checkString(length + (trailingComma ? 1 : 0));
    return parts.join(', ') + (trailingComma ? ',' : '');
  }
  const trimmed = parts.map((part) => part.trim());
  budget.checkString(trimmed.reduce((total, part) => total + part.length + 2, 0));
  return trimmed.join(',\n') + ',\n';
}

/** Formats an array-like value: the pieces in parentheses, indented when they span lines. */
export function prettyArrayLike(parts: Iterable<string>, trailingComma: boolean): string {
  const list = prettyCommaList(parts, trailingComma);
  const budget = getValueBudget();
  if (!list.includes('\n')) {
    budget.checkString(list.length + 2);
    return '(' + list + ')';
  }
  const body = list.endsWith('\n') ? list.slice(0, -1) : list;
  let length = body.length + 6;
  for (let i = body.indexOf('\n'); i >= 0; i = body.indexOf('\n', i + 1)) length += 2;
  budget.checkString(length);
  return '(\n  ' + body.replace(/\n/g, '\n  ') + '\n)';
}

function utf8Length(text: string): number {
  let len = 0;
  for (const c of text) {
    const cp = c.codePointAt(0)!;
    len += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return len;
}

// Rust's `char::escape_debug` escapes these, besides a few ASCII controls:
// grapheme extenders, and characters that are not printable (control, format,
// surrogate, private-use and unassigned characters, and separators other than
// the ASCII space).
const ESCAPED = /[\p{Grapheme_Extend}\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

/** Typst's `repr` of a string: quoted, with Rust's debug escapes. */
export function reprStr(text: string): string {
  const out = new ReprBuilder();
  out.push('"');
  for (const c of text) {
    let piece: string;
    switch (c) {
      case '\0': piece = '\\u{0}'; break;
      case '"': piece = '\\"'; break;
      case '\\': piece = '\\\\'; break;
      case '\t': piece = '\\t'; break;
      case '\r': piece = '\\r'; break;
      case '\n': piece = '\\n'; break;
      default: piece = c !== ' ' && ESCAPED.test(c) ? `\\u{${c.codePointAt(0)!.toString(16)}}` : c;
    }
    out.push(piece);
  }
  out.push('"');
  return out.finish();
}
