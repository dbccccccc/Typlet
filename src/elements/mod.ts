// Ported from Typst 0.15.1: crates/typst-library/src/math/mod.rs, crates/typst-library/src/math/equation.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// The math module's definitions live in `src/eval/library.ts`, which builds
// the scopes; this file has the elements and constants of mod.rs.

import { type Cast, boolCast, castError, contentCast, enumCast, mapCast, optionCast, strCast, typeInfo, union } from '../eval/cast.js';
import { bail } from '../eval/diag.js';
import { type Alignment, type Em, reprAlignment } from '../eval/layout.js';
import { numberingCast } from '../eval/numbering.js';
import { AUTO, FALSE, MATH_CLASS_NAMES, NONE } from '../eval/value.js';
import type { MathClass } from '../utils/math-class.js';
import { elemFunc } from './elem.js';

// Spacings.
export const THIN: Em = 1 / 6;
export const MEDIUM: Em = 2 / 9;
export const THICK: Em = 5 / 18;
export const QUAD: Em = 1;
export const WIDE: Em = 2;

/** The classes `math.class` accepts. */
const CLASSES = ['normal', 'punctuation', 'opening', 'closing', 'fence', 'large', 'relation', 'unary', 'binary', 'vary'] as const;

/** Forces a math class: `class("relation", x)`. */
export const classFunc = elemFunc('class', [
  {
    name: 'class',
    cast: mapCast(enumCast(CLASSES), (name) => MATH_CLASS_NAMES.indexOf(name) as MathClass),
    kind: 'required',
  },
  { name: 'body', cast: contentCast, kind: 'required' },
]);

/** Where an equation's number goes: `start`, `left`, `right` or `end`, and `top`, `horizon` or `bottom`. */
const numberAlignCast: Cast<Alignment> = {
  info: typeInfo('alignment'),
  castable: (v) => v.type === 'alignment',
  cast(v) {
    if (v.type !== 'alignment') throw castError(this.info, v);
    if (v.v.x === 'center') {
      const x = v.v.x;
      bail(`expected \`start\`, \`left\`, \`right\`, or \`end\`, found ${reprAlignment({ x })}`);
    }
    return v.v;
  },
};

/** A supplement for references: content, a function, `none` or `auto`. Typlet keeps it but has no references. */
const supplementCast: Cast<unknown> = {
  info: union(typeInfo('content'), typeInfo('function'), typeInfo('none'), typeInfo('auto')),
  castable: (v) => v.type === 'auto' || v.type === 'function' || contentCast.castable(v),
  cast(v) {
    if (v.type === 'auto' || v.type === 'function') return v;
    if (contentCast.castable(v)) return v.type === 'none' ? null : contentCast.cast(v);
    throw castError(this.info, v);
  },
};

/** An equation: `math.equation(block: true, $x$)`. */
export const equation = elemFunc('equation', [
  { name: 'block', cast: boolCast, kind: 'named', default: () => FALSE },
  { name: 'numbering', cast: optionCast(numberingCast), kind: 'named', default: () => NONE },
  {
    name: 'number-align',
    cast: numberAlignCast,
    kind: 'named',
    default: () => ({ type: 'alignment', v: { x: 'end', y: 'horizon' } }),
  },
  { name: 'supplement', cast: supplementCast, kind: 'named', default: () => AUTO },
  { name: 'alt', cast: optionCast(strCast), kind: 'named', default: () => NONE },
  { name: 'body', cast: contentCast, kind: 'required' },
]);

/** Alternates between left and right alignment, starting with `start`. */
export type LeftRightAlternator = 'none' | 'left' | 'right';

export function alternatorNext(alternator: LeftRightAlternator): LeftRightAlternator {
  return alternator === 'left' ? 'right' : alternator === 'right' ? 'left' : 'none';
}
