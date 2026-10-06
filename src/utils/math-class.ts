// Ported from Typst 0.15.1: crates/typst-utils/src/lib.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { MATH_CLASS_RUNS } from '../generated/math-class.js';

/**
 * The Unicode math class of a character (Unicode Technical Report #25). The
 * order matches `unicode_math_class::MathClass`.
 */
export enum MathClass {
  Normal,
  Alphabetic,
  Binary,
  Closing,
  Diacritic,
  Fence,
  GlyphPart,
  Large,
  Opening,
  Punctuation,
  Relation,
  Space,
  Unary,
  Vary,
  Special,
}

// Decode the generated runs into parallel arrays for binary search.
const starts: number[] = [];
const ends: number[] = [];
const classes: MathClass[] = [];
for (let i = 0, end = 0; i < MATH_CLASS_RUNS.length; i += 3) {
  const start = end + MATH_CLASS_RUNS[i]!;
  end = start + MATH_CLASS_RUNS[i + 1]!;
  starts.push(start);
  ends.push(end);
  classes.push(MATH_CLASS_RUNS[i + 2]! as MathClass);
}

/** `unicode_math_class::class`: the class from MathClass.txt, if any. */
export function unicodeMathClass(c: number): MathClass | undefined {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (c < starts[mid]!) hi = mid - 1;
    else if (c >= ends[mid]!) lo = mid + 1;
    else return classes[mid];
  }
  return undefined;
}

/** The math class Typst uses by default for a character: MathClass.txt with Typst's overrides. */
export function defaultMathClass(c: number): MathClass | undefined {
  switch (c) {
    // Better spacing.
    // https://github.com/typst/typst/commit/2e039cb052fcb768027053cbf02ce396f6d7a6be
    case 0x3a: // :
      return MathClass.Relation;

    // Better spacing when used alongside + PLUS SIGN.
    // https://github.com/typst/typst/pull/1726
    case 0x22ef: // ⋯
    case 0x22f1: // ⋱
    case 0x22f0: // ⋰
    case 0x22ee: // ⋮
      return MathClass.Normal;

    // Better spacing.
    // https://github.com/typst/typst/pull/1855
    case 0x2e: // .
    case 0x2f: // /
      return MathClass.Normal;

    // ⊥ UP TACK should not be a relation, contrary to ⟂ PERPENDICULAR.
    // https://github.com/typst/typst/pull/5714
    case 0x22a5:
      return MathClass.Normal;

    // Used as a binary connector in linear logic, where it is referred to as "par".
    // https://github.com/typst/typst/issues/5764
    case 0x214b: // ⅋
      return MathClass.Binary;

    // Those overrides should become the default in the next revision of MathClass.txt.
    // https://github.com/typst/typst/issues/5764#issuecomment-2632435247
    case 0x23b0: // ⎰
    case 0x27c5: // ⟅
      return MathClass.Opening;
    case 0x23b1: // ⎱
    case 0x27c6: // ⟆
      return MathClass.Closing;

    // Both ∨ and ⟑ are classified as Binary.
    // https://github.com/typst/typst/issues/5764
    case 0x27c7: // ⟇
      return MathClass.Binary;

    // Arabic comma.
    // https://github.com/latex3/unicode-math/pull/633#issuecomment-2028936135
    case 0x060c: // ،
      return MathClass.Punctuation;

    default:
      return unicodeMathClass(c);
  }
}
