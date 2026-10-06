// Ported from Typst 0.15.1: crates/typst-library/src/math/op.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { boolCast, contentCast } from '../eval/cast.js';
import { type Content, join, styled, symbolElem, textElem } from '../eval/content.js';
import { length, relFromLength } from '../eval/layout.js';
import { property } from '../eval/styles.js';
import { FALSE } from '../eval/value.js';
import { MathClass } from '../utils/math-class.js';
import { elemFunc } from './elem.js';
import { THIN } from './mod.js';

/** A text operator: `op("argmax", limits: #true)`. */
export const op = elemFunc('op', [
  { name: 'text', cast: contentCast, kind: 'required' },
  { name: 'limits', cast: boolCast, kind: 'named', default: () => FALSE },
]);

// The predefined text operators, with `limits` for those whose attachments go
// above and below in display style.
const OPS: ReadonlyArray<readonly [name: string, text?: string, limits?: boolean]> = [
  ['arccos'], ['arcsin'], ['arctan'], ['arg'], ['cos'], ['cosh'], ['cot'], ['coth'], ['csc'],
  ['csch'], ['ctg'], ['deg'], ['det', undefined, true], ['dim'], ['exp'],
  ['gcd', undefined, true], ['lcm', undefined, true], ['hom'], ['id'], ['im'],
  ['inf', undefined, true], ['ker'], ['lg'], ['lim', undefined, true], ['liminf', 'lim inf', true],
  ['limsup', 'lim sup', true], ['ln'], ['log'], ['max', undefined, true], ['min', undefined, true],
  ['mod'], ['Pr', undefined, true], ['sec'], ['sech'], ['sin'], ['sinc'], ['sinh'],
  ['sup', undefined, true], ['tan'], ['tanh'], ['tg'], ['tr'],
];

/** The text operators and `dif`, as content to define in the math scope. */
export function textOperators(): [string, Content][] {
  const out: [string, Content][] = OPS.map(([name, text, limits]) => [
    name,
    { func: 'op', text: textElem(text ?? name), limits: limits ?? false, span: null },
  ]);
  // The differential `dif`: thin weak space, then an upright d of class unary.
  const dif = (d: string): Content =>
    join(
      { func: 'h', amount: { rel: relFromLength(length(0, THIN)) }, weak: true, span: null },
      {
        func: 'class',
        class: MathClass.Unary,
        body: styled(symbolElem(d), [property('equation', 'italic', false)]),
        span: null,
      },
    );
  out.push(['dif', dif('d')], ['Dif', dif('D')]);
  return out;
}
