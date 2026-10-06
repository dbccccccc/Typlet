// Ported from typst-assets 0.15.1: src/mathml.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { CATEGORIES, ENCODINGS, FENCE_TABLE, INLINE_AXIS, OPERATOR_TABLE, SEPARATORS, TWO_ASCII_CHARS } from '../generated/mathml.js';

export type Form = 'infix' | 'prefix' | 'postfix';

export const STRETCHY = 1;
export const SYMMETRIC = 2;
export const LARGEOP = 4;
export const MOVABLELIMITS = 8;

/** An operator's properties from the MathML Core operator dictionary. */
export interface OperatorInfo {
  readonly form: Form | null;
  readonly lspace: number;
  readonly rspace: number;
  readonly properties: number;
}

const infos = new Map<string, OperatorInfo>();

function categoryInfo(category: string): OperatorInfo {
  let info = infos.get(category);
  if (!info) {
    const [form, lspace, rspace, properties] = CATEGORIES[category]!;
    info = { form: form as Form | null, lspace, rspace, properties };
    infos.set(category, info);
  }
  return info;
}

/** The dictionary entry for an operator in a form. */
export function operatorInfo(content: string, form: Form, explicitForm: boolean): OperatorInfo {
  let category = operatorCategory(content, form);
  if (!explicitForm && category === 'DEFAULT') category = implicitCategory(content);
  return categoryInfo(category);
}

function implicitCategory(content: string): string {
  for (const form of ['infix', 'postfix', 'prefix'] as const) {
    const category = operatorCategory(content, form);
    if (category !== 'DEFAULT') return category;
  }
  return 'DEFAULT';
}

/** The operator's category, following the MathML Core algorithm. */
function operatorCategory(content: string, form: Form): string {
  let c: number;
  if (content.length === 1) {
    // Content must be a single code point in the BMP.
    c = content.charCodeAt(0);
    // Step 2.
    if (c >= 0x0320 && c <= 0x03ff) return 'DEFAULT';
  } else if (content.length === 2) {
    const cp = content.codePointAt(0)!;
    if (cp > 0xffff) {
      // A surrogate pair. Step 2.1.
      if ((cp === 0x1eef0 || cp === 0x1eef1) && form === 'postfix') return 'I';
      // Step 2.4.
      return 'DEFAULT';
    }
    // Two characters in the BMP.
    const second = content.charCodeAt(1);
    if (second === 0x0338 || second === 0x20d2) {
      // Step 2.2.
      c = cp;
    } else {
      // Step 2.3.
      const mapped = mapTwoAsciiChars(content);
      if (mapped === null) return 'DEFAULT'; // Step 2.4.
      c = mapped;
    }
  } else {
    // Step 1.
    return 'DEFAULT';
  }

  // Step 3.
  if (form === 'infix' && (c === 0x007c || c === 0x223c)) return 'FORCEDEFAULT';
  if (form === 'prefix' && (c === 0x2145 || c === 0x2146 || c === 0x2202 || (c >= 0x221a && c <= 0x221c))) return 'L';
  if (form === 'infix' && (c === 0x002c || c === 0x003a || c === 0x003b)) return 'M';

  // Step 3.1.
  let key: number;
  if (c <= 0x03ff) key = c;
  else if (c >= 0x2000 && c <= 0x2bff) key = c - 0x1c00;
  else return 'DEFAULT';

  // Step 3.2.
  key += form === 'infix' ? 0 : form === 'prefix' ? 0x1000 : 0x2000;

  // Step 3.4: binary search the ranges.
  let lo = 0;
  let hi = OPERATOR_TABLE.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const k = OPERATOR_TABLE[mid * 2]!;
    const data = OPERATOR_TABLE[mid * 2 + 1]!;
    if (key < k) hi = mid - 1;
    else if (key > k + (data & 0x0f)) lo = mid + 1;
    else return ENCODINGS[data >> 4]!;
  }
  return 'DEFAULT';
}

/** Whether the operator is a fence by default. */
export function isFence(content: string): boolean {
  const c = mapTwoAsciiChars(content) ?? singleChar(content);
  if (c === null) return false;
  for (let i = 0; i < FENCE_TABLE.length; i += 2) {
    const start = FENCE_TABLE[i]!;
    if (c >= start && c < start + FENCE_TABLE[i + 1]!) return true;
  }
  return false;
}

/** Whether the operator is a separator by default. */
export function isSeparator(content: string): boolean {
  const c = singleChar(content);
  return c !== null && SEPARATORS.includes(c);
}

/** Whether the character stretches along the inline axis. */
export function isStretchAxisInline(c: number): boolean {
  return INLINE_AXIS.includes(c);
}

/** Whether browsers style the character italic in `mi` by default. */
export function willAutoTransform(content: string): boolean {
  const c = singleChar(content);
  if (c === null) return false;
  return (
    (c >= 0x41 && c <= 0x5a) ||
    (c >= 0x61 && c <= 0x7a) ||
    c === 0x131 ||
    c === 0x237 ||
    (c >= 0x391 && c <= 0x3a1) ||
    c === 0x3f4 ||
    (c >= 0x3a3 && c <= 0x3a9) ||
    c === 0x2207 ||
    (c >= 0x3b1 && c <= 0x3c9) ||
    c === 0x2202 ||
    c === 0x3f5 ||
    c === 0x3d1 ||
    c === 0x3f0 ||
    c === 0x3d5 ||
    c === 0x3f1 ||
    c === 0x3d6
  );
}

function singleChar(content: string): number | null {
  const c = content.codePointAt(0);
  return c !== undefined && content.length === (c > 0xffff ? 2 : 1) ? c : null;
}

function mapTwoAsciiChars(content: string): number | null {
  const i = TWO_ASCII_CHARS.indexOf(content);
  return i < 0 ? null : 0x0320 + i;
}
