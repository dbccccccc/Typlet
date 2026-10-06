// Ported from Typst 0.15.1: crates/typst-library/src/layout/container.rs, crates/typst-library/src/layout/hide.rs, crates/typst-library/src/model/link.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import {
  type Cast,
  boolCast,
  castError,
  contentCast,
  cornersCast,
  frCast,
  optionCast,
  paintCast,
  relCast,
  sidesCast,
  strokeCast,
  typeInfo,
  union,
  unexpectedKeys,
} from '../eval/cast.js';
import type { BoxBaseline, Sizing } from '../eval/content.js';
import { bail, unsupported } from '../eval/diag.js';
import { type Func, param } from '../eval/func.js';
import { linkFromUrl } from '../eval/markup.js';
import { relFromLength } from '../eval/layout.js';
import { AUTO, FALSE, NONE, type TypeName, type Value, dictValue } from '../eval/value.js';
import { elemFunc } from './elem.js';

/** A width: `auto`, a relative length or a fraction, like `Sizing`'s cast. */
const sizingCast: Cast<Sizing> = {
  info: union(typeInfo('auto'), relCast.info, frCast.info),
  castable: (v) => v.type === 'auto' || relCast.castable(v) || frCast.castable(v),
  cast(v): Sizing {
    if (v.type === 'auto') return 'auto';
    if (frCast.castable(v)) return { fr: frCast.cast(v) };
    if (relCast.castable(v)) return { rel: relCast.cast(v) };
    throw castError(this.info, v);
  },
};

/** A height: a relative length or `auto`. */
const heightCast: Cast<import('../eval/layout.js').RelLength | 'auto'> = {
  info: union(relCast.info, typeInfo('auto')),
  castable: (v) => v.type === 'auto' || relCast.castable(v),
  cast(v) {
    if (v.type === 'auto') return 'auto';
    if (relCast.castable(v)) return relCast.cast(v);
    throw castError(this.info, v);
  },
};

/** A vertical alignment or `auto`, for a box's baseline. */
function baselineAt(v: Value): BoxBaseline['at'] {
  if (v.type === 'auto') return 'auto';
  if (v.type === 'alignment' && v.v.x === undefined && v.v.y !== undefined) return v.v.y;
  if (v.type === 'alignment') bail('expected `top`, `horizon`, or `bottom`');
  throw castError(union(typeInfo('alignment'), typeInfo('auto')), v);
}

/** A box's baseline, like `BaselinePos`'s cast: an alignment, a shift, or both in a dictionary. */
const baselineCast: Cast<BoxBaseline> = {
  info: union(typeInfo('alignment'), typeInfo('auto'), relCast.info, typeInfo('dictionary')),
  castable: (v) => v.type === 'alignment' || v.type === 'auto' || v.type === 'dictionary' || relCast.castable(v),
  cast(v): BoxBaseline {
    if (v.type === 'alignment' || v.type === 'auto') return { at: baselineAt(v) };
    if (relCast.castable(v)) return { shift: relCast.cast(v) };
    if (v.type === 'dictionary') {
      const at = v.v.get('at');
      const shift = v.v.get('shift');
      const out: { at?: BoxBaseline['at']; shift?: BoxBaseline['shift'] } = {};
      if (at !== undefined) out.at = baselineAt(at);
      if (shift !== undefined) out.shift = relCast.cast(shift);
      const unknown = [...v.v.keys()].filter((k) => k !== 'at' && k !== 'shift');
      if (unknown.length > 0) throw unexpectedKeys(unknown, ['at', 'shift']);
      return out;
    }
    throw castError(this.info, v);
  },
};

const fillCast = { ...optionCast(paintCast), info: union(...(['color', 'gradient', 'tiling', 'none'] as TypeName[]).map(typeInfo)) };

/** An inline box: `box(stroke: 1pt, inset: 2pt, $x$)`. */
export const box = elemFunc('box', [
  { name: 'width', cast: sizingCast, kind: 'named', default: () => AUTO },
  { name: 'height', cast: heightCast, kind: 'named', default: () => AUTO },
  {
    name: 'baseline',
    cast: baselineCast,
    kind: 'named',
    default: () =>
      dictValue(
        new Map<string, Value>([
          ['at', AUTO],
          ['shift', { type: 'relative', v: relFromLength({ abs: 0, em: 0 }) }],
        ]),
      ),
  },
  { name: 'fill', cast: fillCast, kind: 'named', default: () => NONE },
  { name: 'stroke', cast: sidesCast(optionCast(strokeCast)), kind: 'named', default: () => dictValue(new Map()) },
  { name: 'radius', cast: cornersCast(relCast), kind: 'named', default: () => dictValue(new Map()) },
  { name: 'inset', cast: sidesCast(relCast), kind: 'named', default: () => dictValue(new Map()) },
  { name: 'outset', cast: sidesCast(relCast), kind: 'named', default: () => dictValue(new Map()) },
  { name: 'clip', cast: boolCast, kind: 'named', default: () => FALSE },
  { name: 'body', cast: optionCast(contentCast), kind: 'positional', default: () => NONE },
]);

/** Hides its body but keeps its space: `hide[x]`. */
export const hide = elemFunc('hide', [{ name: 'body', cast: contentCast, kind: 'required' }]);

/** A link's destination: a URL; locations, labels and positions are refused. */
const destCast: Cast<string> = {
  info: union(...(['str', 'dictionary', 'location', 'label'] as TypeName[]).map(typeInfo)),
  castable: (v) => v.type === 'str' || v.type === 'dictionary' || v.type === 'label',
  cast(v) {
    if (v.type === 'str') return v.v;
    if (v.type === 'dictionary' || v.type === 'label') unsupported(null, 'links to places in a document');
    throw castError(this.info, v);
  },
};

/** A hyperlink: `link("https://typst.app")[docs]`. Its body defaults to the URL. */
export const link: Func = {
  name: 'link',
  elem: 'link',
  params: [param('dest', destCast, 'required'), param('body', contentCast, 'required')],
  call(_engine, args) {
    const dest = args.expect('dest', destCast);
    const body = args.eat(contentCast);
    const elem = linkFromUrl(dest, args.span);
    return { type: 'content', v: body === undefined ? { ...elem, span: null } : { ...elem, body, span: null } };
  },
};

