// Ported from Typst 0.15.1: crates/typst-library/src/math/attach.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { boolCast, contentCast, optionCast, relCast, usizeCast } from '../eval/cast.js';
import { REL_ONE } from '../eval/layout.js';
import type { StyleChain } from '../eval/styles.js';
import { NONE, TRUE } from '../eval/value.js';
import { MathClass, defaultMathClass } from '../utils/math-class.js';
import { elemFunc } from './elem.js';
import { MathSize, equationSize } from './style.js';

const optContent = optionCast(contentCast);

/** A base with optional attachments: `attach(x, t: 2)`. */
export const attach = elemFunc('attach', [
  { name: 'base', cast: contentCast, kind: 'required' },
  ...['t', 'b', 'tl', 'bl', 'tr', 'br'].map((name) => ({
    name,
    cast: optContent,
    kind: 'named' as const,
    default: () => NONE,
  })),
]);

/** Grouped primes: `primes(2)`. */
export const primes = elemFunc('primes', [{ name: 'count', cast: usizeCast, kind: 'required' }]);

/** Forces scripts to the corner of a base. */
export const scripts = elemFunc('scripts', [{ name: 'body', cast: contentCast, kind: 'required' }]);

/** Forces limits above and below a base. */
export const limits = elemFunc('limits', [
  { name: 'body', cast: contentCast, kind: 'required' },
  { name: 'inline', cast: boolCast, kind: 'named', default: () => TRUE },
]);

/** Stretches a glyph. */
export const stretch = elemFunc('stretch', [
  { name: 'body', cast: contentCast, kind: 'required' },
  { name: 'size', cast: relCast, kind: 'named', default: () => ({ type: 'relative', v: REL_ONE }) },
]);

/** Where attachments go: in the corners (`never` limits) or above and below. */
export enum Limits {
  /** Never set limits; always use scripts. */
  Never,
  /** Set limits only in display size. */
  Display,
  /** Always set limits. */
  Always,
}

/** The default limits of a character with a class. */
export function limitsForCharWithClass(c: number, cls: MathClass | undefined): Limits {
  if (cls === MathClass.Large) return isIntegralChar(c) ? Limits.Never : Limits.Display;
  if (cls === MathClass.Relation) return Limits.Always;
  return Limits.Never;
}

/** The default limits of a character. */
export function limitsForChar(c: number): Limits {
  return limitsForCharWithClass(c, defaultMathClass(c));
}

/** The default limits of a math class. */
export function limitsForClass(cls: MathClass): Limits {
  if (cls === MathClass.Large) return Limits.Display;
  if (cls === MathClass.Relation) return Limits.Always;
  return Limits.Never;
}

/** Whether limits apply in the current style. */
export function limitsActive(limits: Limits, styles: StyleChain): boolean {
  if (limits === Limits.Always) return true;
  if (limits === Limits.Display) return equationSize(styles) === MathSize.Display;
  return false;
}

/** Whether a character is an integral sign: ∫ to ∳, or ⨋ to ⨜. */
function isIntegralChar(c: number): boolean {
  return (c >= 0x222b && c <= 0x2233) || (c >= 0x2a0b && c <= 0x2a1c);
}
