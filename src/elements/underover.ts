// Ported from Typst 0.15.1: crates/typst-library/src/math/underover.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { contentCast, optionCast } from '../eval/cast.js';
import type { UnderOverElem } from '../eval/content.js';
import { NONE } from '../eval/value.js';
import { elemFunc } from './elem.js';

export const underline = elemFunc('underline', [{ name: 'body', cast: contentCast, kind: 'required' }]);
export const overline = elemFunc('overline', [{ name: 'body', cast: contentCast, kind: 'required' }]);

const underOver = (name: UnderOverElem['func']) =>
  elemFunc(name, [
    { name: 'body', cast: contentCast, kind: 'required' },
    { name: 'annotation', cast: optionCast(contentCast), kind: 'positional', default: () => NONE },
  ]);

export const underbrace = underOver('underbrace');
export const overbrace = underOver('overbrace');
export const underbracket = underOver('underbracket');
export const overbracket = underOver('overbracket');
export const underparen = underOver('underparen');
export const overparen = underOver('overparen');
export const undershell = underOver('undershell');
export const overshell = underOver('overshell');
