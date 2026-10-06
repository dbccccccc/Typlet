// Ported from Typst 0.15.1: crates/typst-library/src/math/matrix.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import {
  type Cast,
  arrayCast,
  boolCast,
  castError,
  charCast,
  contentCast,
  dictCast,
  hAlignmentCast,
  isizeCast,
  optionCast,
  relCast,
  typeInfo,
  union,
  unionCast,
} from '../eval/cast.js';
import type { Augment, Content, Delimiter, DelimiterPair } from '../eval/content.js';
import { empty } from '../eval/content.js';
import { at, bail, unsupported } from '../eval/diag.js';
import { type Em, type HAlignment, REL_ZERO, type RelLength, relFromLength, length } from '../eval/layout.js';
import { symbolGet } from '../eval/symbol.js';
import { FALSE, NONE, type Value, arrayValue, display, strValue } from '../eval/value.js';
import { MathClass, defaultMathClass } from '../utils/math-class.js';
import { elemFunc } from './elem.js';

const DEFAULT_ROW_GAP: Em = 0.2;
const DEFAULT_COL_GAP: Em = 0.5;

export const DEFAULT_ROW_GAP_REL: RelLength = relFromLength(length(0, DEFAULT_ROW_GAP));
export const DEFAULT_COL_GAP_REL: RelLength = relFromLength(length(0, DEFAULT_COL_GAP));
export const PAREN: DelimiterPair = { open: '(', close: ')' };
export const BRACE: DelimiterPair = { open: '{', close: '}' };
export const DEFAULT_ALIGN: HAlignment = 'center';

/** Checks that a character can be a delimiter: an opening, closing or fence character. */
function delimiterChar(c: string): Delimiter {
  const cls = defaultMathClass(c.codePointAt(0)!);
  if (cls !== MathClass.Opening && cls !== MathClass.Closing && cls !== MathClass.Fence) {
    bail(`invalid delimiter: "${c}"`);
  }
  return c;
}

/** A delimiter: `none`, a symbol or a one-character string. */
const delimiterCast: Cast<Delimiter> = unionCast<Delimiter>(
  { info: typeInfo('none'), castable: (v) => v.type === 'none', cast: () => null },
  {
    info: typeInfo('symbol'),
    castable: (v) => v.type === 'symbol',
    cast(v) {
      const text = symbolGet((v as Extract<Value, { type: 'symbol' }>).v);
      if ([...text].length !== 1) bail('expected a single-codepoint symbol');
      return delimiterChar(text);
    },
  },
  { ...charCast, cast: (v) => delimiterChar(charCast.cast(v)) },
);

/** The closing delimiter that matches an opening one, or the other way around. */
function findMatching(d: Delimiter): Delimiter {
  if (d === null) return null;
  const pairs: Record<string, string> = { '[': ']', ']': '[', '{': '}', '}': '{' };
  if (pairs[d]) return pairs[d]!;
  const c = d.codePointAt(0)!;
  const cls = defaultMathClass(c);
  if (cls === MathClass.Opening) return String.fromCodePoint(c + 1);
  if (cls === MathClass.Closing) return String.fromCodePoint(c - 1);
  return d;
}

/** A pair of delimiters, or one delimiter whose match closes it. */
export const delimiterPairCast: Cast<DelimiterPair> = {
  info: union(typeInfo('array'), delimiterCast.info),
  castable: (v) => v.type === 'array' || delimiterCast.castable(v),
  cast(v) {
    if (v.type === 'array') {
      if (v.v.length !== 2) bail(`expected 2 delimiters, found ${v.v.length}`);
      return { open: delimiterCast.cast(v.v[0]!), close: delimiterCast.cast(v.v[1]!) };
    }
    if (delimiterCast.castable(v)) {
      const open = delimiterCast.cast(v);
      return { open, close: findMatching(open) };
    }
    throw castError(this.info, v);
  },
};

/** Offsets of augmentation lines: one integer or an array of them. */
const offsetsCast: Cast<number[]> = unionCast<number[]>(
  { ...isizeCast, cast: (v) => [isizeCast.cast(v)] },
  { ...arrayCast, cast: (v) => arrayCast.cast(v).map((x) => isizeCast.cast(x)) },
);

/** An augmentation: the offset of a vertical line, or a dictionary of lines and stroke. */
export const augmentCast: Cast<Augment> = unionCast<Augment>(
  { ...isizeCast, cast: (v) => ({ hline: [], vline: [isizeCast.cast(v)], stroke: null }) },
  {
    ...dictCast,
    cast(v) {
      const dict = dictCast.cast(v);
      const take = (key: string) => (dict.has(key) ? offsetsCast.cast(dict.get(key)!) : []);
      const hline = take('hline');
      const vline = take('vline');
      if (dict.has('stroke')) unsupported(null, 'strokes in augmentations yet');
      return { hline, vline, stroke: null };
    },
  },
);

const delimParam = (fallback: DelimiterPair) => ({
  name: 'delim',
  cast: delimiterPairCast,
  kind: 'named' as const,
  default: () => arrayValue([fallback.open === null ? NONE : strValue(fallback.open), fallback.close === null ? NONE : strValue(fallback.close)]),
});
const alignParam = {
  name: 'align',
  cast: hAlignmentCast,
  kind: 'named' as const,
  default: (): Value => ({ type: 'alignment', v: { x: DEFAULT_ALIGN } }),
};
const gapParam = (name: string, fallback: RelLength) => ({
  name,
  cast: relCast,
  kind: 'named' as const,
  default: (): Value => ({ type: 'relative', v: fallback }),
});

/** A column vector: `vec(1, 2)`. */
export const vec = elemFunc('vec', [
  delimParam(PAREN),
  alignParam,
  gapParam('gap', DEFAULT_ROW_GAP_REL),
  { name: 'children', cast: contentCast, kind: 'variadic' },
]);

/** A matrix: `mat(1, 2; 3, 4)`. */
export const mat = elemFunc('mat', [
  delimParam(PAREN),
  alignParam,
  { name: 'augment', cast: optionCast(augmentCast), kind: 'named', default: () => NONE },
  // `gap` sets both gaps; the specific ones take precedence.
  {
    name: 'gap',
    cast: relCast,
    kind: 'named',
    external: true,
    settable: false,
    default: (): Value => ({ type: 'relative', v: REL_ZERO }),
    parse(args, _engine, scratch) {
      scratch.gap = args.named('gap', relCast);
      return undefined;
    },
  },
  {
    ...gapParam('row-gap', DEFAULT_ROW_GAP_REL),
    parse: (args, _engine, scratch) => args.named('row-gap', relCast) ?? scratch.gap,
  },
  {
    ...gapParam('column-gap', DEFAULT_COL_GAP_REL),
    parse: (args, _engine, scratch) => args.named('column-gap', relCast) ?? scratch.gap,
  },
  {
    name: 'rows',
    cast: arrayCast,
    kind: 'variadic',
    parse(args) {
      const values = args.allSpanned();
      let rows: Content[][];
      let width = 0;
      if (values.some(({ value }) => value.type === 'array')) {
        rows = values.map(({ value, span }) => {
          const row = at(span, () => arrayCast.cast(value)).map((item) => display(item));
          width = Math.max(width, row.length);
          return row;
        });
      } else {
        rows = [values.map(({ value }) => display(value))];
      }
      for (const row of rows) while (row.length < width) row.push(empty());
      return rows;
    },
  },
]);

/** Cases: `cases(1 "if" x > 0, 0 "else")`. */
export const cases = elemFunc('cases', [
  delimParam(BRACE),
  { name: 'reverse', cast: boolCast, kind: 'named', default: () => FALSE },
  gapParam('gap', DEFAULT_ROW_GAP_REL),
  { name: 'children', cast: contentCast, kind: 'variadic' },
]);
