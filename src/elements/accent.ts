// Ported from Typst 0.15.1: crates/typst-library/src/math/accent.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import type { Args } from '../eval/args.js';
import { type Cast, boolCast, castError, contentCast, relCast, strCast, typeInfo, union } from '../eval/cast.js';
import { type AccentElem, type Content } from '../eval/content.js';
import { bail } from '../eval/diag.js';
import { type Func, contentFunc, param } from '../eval/func.js';
import { type Em, REL_ONE } from '../eval/layout.js';
import { TRUE } from '../eval/value.js';
import { elemFunc } from './elem.js';

/** How much an accent may fall short of the width it should stretch to. */
export const ACCENT_SHORT_FALL: Em = 0.5;

// The combining accents that symbols can stand for, with the symbols' values.
const ACCENTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['̀', ['`']],
  ['́', ['´']],
  ['̂', ['^', 'ˆ']],
  ['̃', ['~', '∼', '˜']],
  ['̄', ['¯']],
  ['̅', ['-', '–', '‾', '−']],
  ['̆', ['˘']],
  ['̇', ['.', '˙', '⋅']],
  ['̈', ['¨']],
  ['⃛', []],
  ['⃜', []],
  ['̊', ['∘', '○']],
  ['̋', ['˝']],
  ['̌', ['ˇ']],
  ['⃖', ['←']],
  ['⃗', ['→', '⟶']],
  ['⃡', ['↔', '↔︎', '⟷']],
  ['⃐', ['↼']],
  ['⃑', ['⇀']],
];

const isChar = (s: string) => [...s].length === 1;

/** The combining accent a string stands for, if any. */
export function accentCombining(value: string): string | null {
  const c = isChar(value) ? value : null;
  return ACCENTS.find(([accent, names]) => accent === c || names.includes(value))?.[0] ?? null;
}

/** The accent for a string: a combining accent it stands for, or the character itself. */
export function accentNormalize(value: string): string | null {
  return accentCombining(value) ?? (isChar(value) ? value : null);
}

// Combining marks below the base (canonical combining class 220) in the
// blocks of combining diacritics. Typst asks ICU for the class of any
// character; this table covers the combining-mark blocks.
const BELOW =
  /[̖-̙̜-̠̣-̦̩-̳̹-̼͇-͉͍͎͓-͖͙͚᪵-᪺᪽ᪿᫀ᫃᫄᫊᷂᷊᷏᷹᷽᷿⃨⃬-⃯]/u;

/** Whether the accent goes below the base. */
export function accentIsBottom(accent: string): boolean {
  return ['⏟', '⎵', '⏝', '⏡'].includes(accent) || BELOW.test(accent);
}

/** Casts an accent from a string, symbol or symbol content. */
const accentCast: Cast<string> = {
  info: union(typeInfo('str'), typeInfo('content')),
  castable: (v) => strCast.castable(v) || contentCast.castable(v),
  cast(v) {
    if (strCast.castable(v)) {
      return accentNormalize(strCast.cast(v)) ?? bail('expected exactly one character');
    }
    if (!contentCast.castable(v)) throw castError(this.info, v);
    const content = contentCast.cast(v);
    const accent = content.func === 'symbol' ? accentNormalize(content.text) : null;
    return accent ?? bail('expected a single-codepoint symbol');
  },
};

/** An accent over or under a base: `accent(x, arrow)`. */
export const accent = elemFunc('accent', [
  { name: 'base', cast: contentCast, kind: 'required' },
  { name: 'accent', cast: accentCast, kind: 'required' },
  { name: 'size', cast: relCast, kind: 'named', default: () => ({ type: 'relative', v: REL_ONE }) },
  { name: 'dotless', cast: boolCast, kind: 'named', default: () => TRUE },
]);

const accentFuncs = new Map<string, Func>();
const accentParams = [
  param('base', contentCast, 'required'),
  param('size', relCast, 'named'),
  param('dotless', boolCast, 'named'),
];

/** The function of a callable accent symbol, such as `hat`, if the value is one. */
export function getAccentFunc(value: string): Func | null {
  const c = accentCombining(value);
  if (c === null) return null;
  let func = accentFuncs.get(c);
  if (!func) {
    func = contentFunc(null, accentParams, (args: Args): Content => {
      const base = args.expect('base', contentCast);
      const size = args.named('size', relCast);
      const dotless = args.named('dotless', boolCast);
      const elem: AccentElem = {
        func: 'accent',
        base,
        accent: c,
        ...(size !== undefined ? { size } : {}),
        ...(dotless !== undefined ? { dotless } : {}),
        span: null,
      };
      return elem;
    });
    accentFuncs.set(c, func);
  }
  return func;
}
