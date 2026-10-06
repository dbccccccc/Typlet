// Ported from Typst 0.15.1: crates/typst-library/src/math/lr.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import type { Args } from '../eval/args.js';
import { contentCast, relCast } from '../eval/cast.js';
import { type Content, type LrElem, empty, join, sequence, spanned, symbolElem } from '../eval/content.js';
import { type Func, contentFunc, param } from '../eval/func.js';
import { type Em, REL_ONE, type RelLength } from '../eval/layout.js';
import { elemFunc } from './elem.js';

/** How much a delimiter may fall short of the height it should stretch to. */
export const DELIM_SHORT_FALL: Em = 0.1;

/** Scales delimiters to the height of their content: `lr(( x ))`. */
export const lr = elemFunc('lr', [
  { name: 'size', cast: relCast, kind: 'named', default: () => ({ type: 'relative', v: REL_ONE }) },
  {
    name: 'body',
    cast: contentCast,
    kind: 'required',
    parse(args) {
      // Several arguments are joined with commas.
      const [first, ...rest] = args.all(contentCast);
      let body: Content = first ?? empty();
      for (const arg of rest) body = join(join(body, symbolElem(',')), arg);
      return body;
    },
  },
]);

/** Scales a delimiter in the middle of an `lr` group. */
export const mid = elemFunc('mid', [{ name: 'body', cast: contentCast, kind: 'required' }]);

/** Wraps content in delimiters, as the `abs`, `floor` and similar functions do. */
function delimited(body: Content, left: string, right: string, size: RelLength | undefined): Content {
  const elem: LrElem = { func: 'lr', body: sequence([symbolElem(left), body, symbolElem(right)]), span: null };
  if (size !== undefined) elem.size = size;
  return spanned(elem, body.span);
}

const wrapperParams = [param('size', relCast, 'named'), param('body', contentCast, 'required')];

function wrapper(name: string | null, left: string, right: string): Func {
  return contentFunc(name, wrapperParams, (args: Args) => {
    const size = args.named('size', relCast);
    const body = args.expect('body', contentCast);
    return delimited(body, left, right, size);
  });
}

export const floor = wrapper('floor', '⌊', '⌋');
export const ceil = wrapper('ceil', '⌈', '⌉');
export const round = wrapper('round', '⌊', '⌉');
export const abs = wrapper('abs', '|', '|');
export const norm = wrapper('norm', '‖', '‖');

// The delimiter pairs whose opening symbol can be called as a function, such
// as `paren.l(x)` or `chevron.l(x)`. `floor` and `ceil` are handled above.
const DELIMS: ReadonlyArray<readonly [string, string]> = [
  ['(', ')'], ['⟮', '⟯'], ['⦇', '⦈'], ['⦅', '⦆'], ['⦓', '⦔'], ['⦕', '⦖'], ['{', '}'], ['⦃', '⦄'],
  ['[', ']'], ['⦍', '⦐'], ['⦏', '⦎'], ['⟦', '⟧'], ['⦋', '⦌'], ['❲', '❳'], ['⟬', '⟭'], ['⦗', '⦘'],
  ['⟅', '⟆'], ['⎰', '⎱'], ['⎱', '⎰'], ['⧘', '⧙'], ['⧚', '⧛'], ['⟨', '⟩'], ['⧼', '⧽'], ['⦑', '⦒'],
  ['⦉', '⦊'], ['⟪', '⟫'], ['⌜', '⌝'], ['⌞', '⌟'],
  // Fences.
  ['|', '|'], ['‖', '‖'], ['⦀', '⦀'], ['⦙', '⦙'], ['⦚', '⦚'],
];

const wrappers = new Map<string, Func>();

/** The function that wraps content in the delimiters starting with `value`, if any. */
export function getLrWrapperFunc(value: string): Func | null {
  if ([...value].length !== 1) return null;
  if (value === '⌈') return ceil;
  if (value === '⌊') return floor;
  const pair = DELIMS.find(([l]) => l === value);
  if (!pair) return null;
  let func = wrappers.get(value);
  if (!func) {
    // Typst names these functions `(..) => ..`, which is how they show.
    func = wrapper(null, pair[0], pair[1]);
    wrappers.set(value, func);
  }
  return func;
}
