// Ported from Typst 0.15.1: crates/typst-library/src/math/root.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { contentCast, optionCast } from '../eval/cast.js';
import { type RootElem, spanned } from '../eval/content.js';
import { contentFunc, param } from '../eval/func.js';
import { NONE } from '../eval/value.js';
import { elemFunc } from './elem.js';

/** A square root: `sqrt(x)`. */
export const sqrt = contentFunc('sqrt', [param('radicand', contentCast, 'required')], (args) => {
  const radicand = args.expect('radicand', contentCast);
  const elem: RootElem = { func: 'root', radicand, span: null };
  return spanned(elem, args.span);
});

/** A root with an optional index: `root(3, x)`. */
export const root = elemFunc('root', [
  { name: 'index', cast: optionCast(contentCast), kind: 'positional', default: () => NONE },
  { name: 'radicand', cast: contentCast, kind: 'required' },
]);
