// Ported from Typst 0.15.1: crates/typst-library/src/layout/abs.rs, crates/typst-library/src/layout/em.rs, crates/typst-library/src/layout/length.rs, crates/typst-library/src/layout/ratio.rs, crates/typst-library/src/layout/rel.rs, crates/typst-library/src/layout/angle.rs, crates/typst-library/src/layout/fr.rs, crates/typst-library/src/layout/align.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { bail } from './diag.js';
import { formatFloatWithUnit } from './repr.js';

// Typst stores every quantity as a `Scalar`, a float that turns NaN into zero.
// The helpers here do the same after each operation, so results match Typst's
// bit for bit.

/** Converts NaN to zero, as `Scalar::new` does. */
export function sc(x: number): number {
  return Number.isNaN(x) ? 0 : x;
}

// ---------------------------------------------------------------------------
// Abs: an absolute length, stored in raw units with 127 units per point, so
// that whole numbers of points, millimeters, centimeters and inches are exact.

/** An absolute length in raw units. */
export type Abs = number;

const RAW_PER_PT = 127;
const RAW_PER_MM = 360;
const RAW_PER_CM = 3600;
const RAW_PER_IN = 9144;

export const absPt = (pt: number): Abs => sc(pt * RAW_PER_PT);
export const absMm = (mm: number): Abs => sc(mm * RAW_PER_MM);
export const absCm = (cm: number): Abs => sc(cm * RAW_PER_CM);
export const absIn = (inches: number): Abs => sc(inches * RAW_PER_IN);
export const absToPt = (abs: Abs): number => abs / RAW_PER_PT;

/** The epsilon for approximate comparisons of absolute lengths, in raw units. */
export const ABS_EPS = 1e-4;

export function reprAbs(abs: Abs): string {
  return formatFloatWithUnit(absToPt(abs), 'pt');
}

// ---------------------------------------------------------------------------
// Em: a length relative to the font size.

/** A length in em. */
export type Em = number;

/** Resolves an em length at a font size; infinite results become zero. */
export function emAt(em: Em, fontSize: Abs): Abs {
  const resolved = sc(fontSize * em);
  return Number.isFinite(resolved) ? resolved : 0;
}

export function reprEm(em: Em): string {
  return formatFloatWithUnit(em, 'em');
}

// ---------------------------------------------------------------------------
// Length: an absolute part plus an em part.

export interface Length {
  readonly abs: Abs;
  readonly em: Em;
}

export const ZERO_LENGTH: Length = { abs: 0, em: 0 };

export const length = (abs: Abs, em: Em): Length => ({ abs: sc(abs), em: sc(em) });
export const lengthIsZero = (l: Length): boolean => l.abs === 0 && l.em === 0;
export const lengthNeg = (l: Length): Length => length(-l.abs, -l.em);
export const lengthAdd = (a: Length, b: Length): Length => length(a.abs + b.abs, a.em + b.em);
export const lengthSub = (a: Length, b: Length): Length => lengthAdd(a, lengthNeg(b));
export const lengthMul = (l: Length, f: number): Length => length(l.abs * f, l.em * f);
export const lengthDiv = (l: Length, f: number): Length => length(l.abs / f, l.em / f);
export const lengthEq = (a: Length, b: Length): boolean => a.abs === b.abs && a.em === b.em;

/** Divides two lengths, if they are both absolute or both relative to the font. */
export function lengthTryDiv(a: Length, b: Length): number | null {
  if (a.abs === 0 && b.abs === 0) return sc(a.em / b.em);
  if (a.em === 0 && b.em === 0) return sc(a.abs / b.abs);
  return null;
}

/** Compares two lengths, if their units allow it. */
export function lengthCmp(a: Length, b: Length): number | null {
  if (a.em === 0 && b.em === 0) return Math.sign(a.abs - b.abs);
  if (a.abs === 0 && b.abs === 0) return Math.sign(a.em - b.em);
  return null;
}

/** Resolves a length at a font size. */
export function lengthAt(l: Length, fontSize: Abs): Abs {
  return sc(l.abs + emAt(l.em, fontSize));
}

export function reprLength(l: Length): string {
  if (l.abs !== 0 && l.em !== 0) return `${reprAbs(l.abs)} + ${reprEm(l.em)}`;
  if (l.abs === 0 && l.em !== 0) return reprEm(l.em);
  return reprAbs(l.abs);
}

// ---------------------------------------------------------------------------
// Ratio: a part of a whole, such as 50%.

/** A ratio, where 1 is 100%. */
export type Ratio = number;

export function reprRatio(r: Ratio): string {
  return formatFloatWithUnit(r * 100, '%');
}

// ---------------------------------------------------------------------------
// Rel: a ratio plus an absolute part.

export interface Rel<T> {
  readonly rel: Ratio;
  readonly abs: T;
}

/** A relative length: `Rel<Length>`. */
export type RelLength = Rel<Length>;

export const relLength = (rel: Ratio, abs: Length): RelLength => ({ rel: sc(rel), abs });
export const REL_ONE: RelLength = { rel: 1, abs: ZERO_LENGTH };
export const REL_ZERO: RelLength = { rel: 0, abs: ZERO_LENGTH };
export const relFromLength = (abs: Length): RelLength => ({ rel: 0, abs });
export const relFromRatio = (rel: Ratio): RelLength => ({ rel, abs: ZERO_LENGTH });
export const relIsZero = (r: RelLength): boolean => r.rel === 0 && lengthIsZero(r.abs);
export const relIsOne = (r: RelLength): boolean => r.rel === 1 && lengthIsZero(r.abs);
export const relNeg = (r: RelLength): RelLength => relLength(-r.rel, lengthNeg(r.abs));
export const relAdd = (a: RelLength, b: RelLength): RelLength =>
  relLength(a.rel + b.rel, lengthAdd(a.abs, b.abs));
export const relSub = (a: RelLength, b: RelLength): RelLength => relAdd(a, relNeg(b));
export const relMul = (r: RelLength, f: number): RelLength => relLength(r.rel * f, lengthMul(r.abs, f));
export const relDiv = (r: RelLength, f: number): RelLength => relLength(r.rel / f, lengthDiv(r.abs, f));
export const relEq = (a: RelLength, b: RelLength): boolean => a.rel === b.rel && lengthEq(a.abs, b.abs);

/** Divides two relative lengths, if they have the same kind of parts. */
export function relTryDiv(a: RelLength, b: RelLength): number | null {
  if (a.rel === 0 && b.rel === 0) return lengthTryDiv(a.abs, b.abs);
  if (lengthIsZero(a.abs) && lengthIsZero(b.abs)) return sc(a.rel / b.rel);
  return null;
}

/** Compares two relative lengths, if they have the same kind of parts. */
export function relCmp(a: RelLength, b: RelLength): number | null {
  if (a.rel === 0 && b.rel === 0) return lengthCmp(a.abs, b.abs);
  if (lengthIsZero(a.abs) && lengthIsZero(b.abs)) return Math.sign(a.rel - b.rel);
  return null;
}

/** Resolves the absolute part of a relative length at a font size. */
export function relAt(r: RelLength, fontSize: Abs): Rel<Abs> {
  return { rel: r.rel, abs: lengthAt(r.abs, fontSize) };
}

/** The length a relative length amounts to, relative to `whole`. */
export function relRelativeTo(r: Rel<Abs>, whole: Abs): Abs {
  return sc(sc(r.rel * whole) + r.abs);
}

export function reprRel(r: RelLength): string {
  return `${reprRatio(r.rel)} + ${reprLength(r.abs)}`;
}

// ---------------------------------------------------------------------------
// Angle: stored in radians.

export type Angle = number;

const RAD_PER_DEG = Math.PI / 180;

export const angleDeg = (deg: number): Angle => sc(deg * RAD_PER_DEG);
export const angleToDeg = (a: Angle): number => a / RAD_PER_DEG;

export function reprAngle(a: Angle): string {
  return formatFloatWithUnit(angleToDeg(a), 'deg');
}

// ---------------------------------------------------------------------------
// Fr: a fraction of the remaining space.

export type Fr = number;

export function reprFr(fr: Fr): string {
  return formatFloatWithUnit(fr, 'fr');
}

// ---------------------------------------------------------------------------
// Alignments.

export type HAlignment = 'start' | 'left' | 'center' | 'right' | 'end';
export type VAlignment = 'top' | 'horizon' | 'bottom';

/** A horizontal alignment, a vertical one, or both. */
export interface Alignment {
  readonly x?: HAlignment;
  readonly y?: VAlignment;
}

/** An alignment resolved against the text direction. */
export type FixedAlignment = 'start' | 'center' | 'end';

/** Adds two alignments, which must be along different axes. */
export function alignmentAdd(a: Alignment, b: Alignment): Alignment {
  const kind = (x: Alignment) => (x.x && x.y ? 'both' : x.x ? 'h' : 'v');
  const [ka, kb] = [kind(a), kind(b)];
  if (ka === 'h' && kb === 'v') return { x: a.x!, y: b.y! };
  if (ka === 'v' && kb === 'h') return { x: b.x!, y: a.y! };
  if (ka === 'h' && kb === 'h') bail('cannot add two horizontal alignments');
  if (ka === 'v' && kb === 'v') bail('cannot add two vertical alignments');
  if (ka === 'both' && kb === 'both') bail('cannot add two 2D alignments');
  return bail(`cannot add a ${ka === 'h' || kb === 'h' ? 'horizontal' : 'vertical'} and a 2D alignment`);
}

export function alignmentEq(a: Alignment, b: Alignment): boolean {
  return a.x === b.x && a.y === b.y;
}

export function reprAlignment(a: Alignment): string {
  if (a.x && a.y) return `${a.x} + ${a.y}`;
  return a.x ?? a.y!;
}

/** Resolves a horizontal alignment for left-to-right text. */
export function fixHAlignment(h: HAlignment): FixedAlignment {
  switch (h) {
    case 'start':
    case 'left':
      return 'start';
    case 'center':
      return 'center';
    case 'right':
    case 'end':
      return 'end';
  }
}
