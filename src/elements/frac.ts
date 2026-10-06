// Ported from Typst 0.15.1: crates/typst-library/src/math/frac.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { contentCast, enumCast, valueCast } from '../eval/cast.js';
import { bailAt } from '../eval/diag.js';
import type { Em } from '../eval/layout.js';
import { display, strValue } from '../eval/value.js';
import { elemFunc } from './elem.js';

/** The padding around fraction bars. */
export const FRAC_PADDING: Em = 0.1;

/** A fraction: `frac(1, 2)` or `1/2`. */
export const frac = elemFunc('frac', [
  { name: 'num', cast: contentCast, kind: 'required' },
  { name: 'denom', cast: contentCast, kind: 'required' },
  {
    name: 'style',
    cast: enumCast(['vertical', 'skewed', 'horizontal'] as const),
    kind: 'named',
    default: () => strValue('vertical'),
  },
]);

/** A binomial: `binom(n, k)`. Several lower values are joined by commas. */
export const binom = elemFunc('binom', [
  { name: 'upper', cast: contentCast, kind: 'required' },
  {
    name: 'lower',
    cast: contentCast,
    kind: 'variadic',
    parse(args) {
      const values = args.all(valueCast);
      // Prevents one-element binomials.
      if (values.length === 0) bailAt(args.span, 'missing argument: lower');
      return values.map((value) => display(value));
    },
  },
]);
