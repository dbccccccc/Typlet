// Ported from Typst 0.15.1: crates/typst-library/src/math/cancel.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { type Cast, angleCast, boolCast, contentCast, relCast, smartCast, strokeCast, unionCast } from '../eval/cast.js';
import type { CancelAngle } from '../eval/content.js';
import { type Func } from '../eval/func.js';
import { type RelLength, length, relLength } from '../eval/layout.js';
import { AUTO, FALSE } from '../eval/value.js';
import { elemFunc } from './elem.js';

/** The default length of a cancel line: the body's size plus 0.3em. */
export const CANCEL_LENGTH: RelLength = relLength(1, length(0, 0.3));

/** An angle, or a function that computes one from the body's size. */
function cancelAngleCast(funcCast: Cast<Func>): Cast<CancelAngle> {
  return unionCast<CancelAngle>(
    { ...angleCast, cast: (v) => ({ angle: angleCast.cast(v) }) },
    { ...funcCast, cast: (v) => ({ func: funcCast.cast(v) }) },
  );
}

/** Builds the `cancel` element function; it needs the function cast, which knows callable symbols. */
export function cancelFunc(funcCast: Cast<Func>): Func {
  return elemFunc('cancel', [
    { name: 'body', cast: contentCast, kind: 'required' },
    { name: 'length', cast: relCast, kind: 'named', default: () => ({ type: 'relative', v: CANCEL_LENGTH }) },
    { name: 'inverted', cast: boolCast, kind: 'named', default: () => FALSE },
    { name: 'cross', cast: boolCast, kind: 'named', default: () => FALSE },
    { name: 'angle', cast: smartCast(cancelAngleCast(funcCast)), kind: 'named', default: () => AUTO },
    {
      name: 'stroke',
      cast: strokeCast,
      kind: 'named',
      default: () => ({ type: 'stroke', v: { thickness: length(0, 0.05) } }),
    },
  ]);
}
