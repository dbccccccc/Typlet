// Ported from Typst 0.15.1: crates/typst-library/src/foundations/value.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import type { Args } from './args.js';
import { type Color, colorEq, reprColor } from './color.js';
import {
  type Augment,
  type BoxBaseline,
  type Content,
  type Corners,
  type DashPattern,
  type DelimiterPair,
  type Sides,
  type Sizing,
  CORNERS,
  SIDES,
  type ElemName,
  type Spacing,
  type Stroke,
  INTERNAL_FIELDS,
  spanned,
  symbolElem,
  textElem,
} from './content.js';
import { type Span, at, sameSpan } from './diag.js';
import { type ValueBudget, ReprBuilder, withValueContext } from './value-budget.js';
import type { Func } from './func.js';
import {
  type Alignment,
  type Angle,
  type Fr,
  type Length,
  type Ratio,
  type RelLength,
  alignmentEq,
  lengthEq,
  lengthIsZero,
  relEq,
  reprAlignment,
  reprAngle,
  reprFr,
  reprLength,
  reprRatio,
  reprRel,
} from './layout.js';
import { displayFloat, formatFloat, formatIntWithBase, joinRepr, prettyArrayLike, reprStr } from './repr.js';
import type { Module, Scope } from './scope.js';
import { type Symbol, reprSymbol, symbolEq, symbolGet } from './symbol.js';
import { isIdent } from '../syntax/lexer.js';
import type { Styles } from './styles.js';
import type { Numbering } from './numbering.js';
import type { MathClass } from '../utils/math-class.js';

/** A Typst value. `type` is the short name of Typst's type, as `type(x)` shows it. */
export type Value =
  | { readonly type: 'none' }
  | { readonly type: 'auto' }
  | { readonly type: 'bool'; readonly v: boolean }
  | { readonly type: 'int'; readonly v: bigint }
  | { readonly type: 'float'; readonly v: number }
  | { readonly type: 'length'; readonly v: Length }
  | { readonly type: 'angle'; readonly v: Angle }
  | { readonly type: 'ratio'; readonly v: Ratio }
  | { readonly type: 'relative'; readonly v: RelLength }
  | { readonly type: 'fraction'; readonly v: Fr }
  | { readonly type: 'color'; readonly v: Color }
  | { readonly type: 'symbol'; readonly v: Symbol }
  | { readonly type: 'str'; readonly v: string }
  | { readonly type: 'content'; readonly v: Content }
  | { readonly type: 'array'; readonly v: readonly Value[] }
  | { readonly type: 'dictionary'; readonly v: ReadonlyMap<string, Value> }
  | { readonly type: 'function'; readonly v: Func }
  | { readonly type: 'arguments'; readonly v: Args }
  | { readonly type: 'type'; readonly v: AnyTypeName }
  | { readonly type: 'module'; readonly v: Module }
  | { readonly type: 'alignment'; readonly v: Alignment }
  | { readonly type: 'stroke'; readonly v: Stroke }
  | { readonly type: 'styles'; readonly v: Styles }
  | { readonly type: 'label'; readonly v: string };

export type TypeName = Value['type'];

/** Typst's type names, including types Typlet has no values of, which casts and type values can still name. */
export type AnyTypeName = TypeName | UnsupportedTypeName;

/** The types of Typst's global scope that Typlet has no values of (docs/DESIGN.md §6.3). */
export type UnsupportedTypeName =
  | 'regex'
  | 'decimal'
  | 'bytes'
  | 'version'
  | 'datetime'
  | 'duration'
  | 'location'
  | 'selector'
  | 'path'
  | 'direction'
  | 'gradient'
  | 'tiling'
  | 'counter'
  | 'state';

/** Typst's long type names, as error messages use them. */
const LONG_NAMES: Partial<Record<AnyTypeName, string>> = {
  bool: 'boolean',
  int: 'integer',
  relative: 'relative length',
  str: 'string',
};

/** The type's name in messages, such as "integer". */
export function longName(type: AnyTypeName): string {
  return LONG_NAMES[type] ?? type;
}

/** The name of a value's type in messages. */
export function typeOf(value: Value): string {
  return longName(value.type);
}

export const NONE: Value = { type: 'none' };
export const AUTO: Value = { type: 'auto' };
export const TRUE: Value = { type: 'bool', v: true };
export const FALSE: Value = { type: 'bool', v: false };

export const boolValue = (v: boolean): Value => (v ? TRUE : FALSE);
export const intValue = (v: bigint): Value => ({ type: 'int', v });
export const floatValue = (v: number): Value => ({ type: 'float', v });
export const strValue = (v: string): Value => ({ type: 'str', v });
export const contentValue = (v: Content): Value => ({ type: 'content', v });
export const arrayValue = (v: readonly Value[]): Value => ({ type: 'array', v });
export const dictValue = (v: ReadonlyMap<string, Value>): Value => ({ type: 'dictionary', v });
export const symbolValue = (v: Symbol): Value => ({ type: 'symbol', v });
export const funcValue = (v: Func): Value => ({ type: 'function', v });

// --- repr ------------------------------------------------------------------

/** Typst's `repr` of a value: how it is written in code. */
export function repr(value: Value): string {
  return withValueContext((budget) => reprValue(value, budget, 0));
}

function reprValue(value: Value, budget: ValueBudget, depth: number): string {
  budget.visit(depth);
  const result = reprInner(value, budget, depth);
  budget.checkString(result.length);
  return result;
}

function reprField(name: string, value: Value, budget: ValueBudget, depth: number): string {
  return joinRepr([name, ': ', reprValue(value, budget, depth + 1)]);
}

function reprInner(value: Value, budget: ValueBudget, depth: number): string {
  switch (value.type) {
    case 'none': return 'none';
    case 'auto': return 'auto';
    case 'bool': return value.v ? 'true' : 'false';
    case 'int': return value.v.toString();
    case 'float': return formatFloat(value.v, null, true, '');
    case 'length': return reprLength(value.v);
    case 'angle': return reprAngle(value.v);
    case 'ratio': return reprRatio(value.v);
    case 'relative': return reprRel(value.v);
    case 'fraction': return reprFr(value.v);
    case 'color': return reprColor(value.v);
    case 'symbol': return reprSymbol(value.v);
    case 'str': return reprStr(value.v);
    case 'content': return reprContent(value.v, budget, depth);
    case 'array': {
      const pieces: string[] = [];
      let length = 0;
      for (let i = 0; i < Math.min(value.v.length, 40); i++) {
        const piece = reprValue(value.v[i]!, budget, depth + 1);
        length += piece.length + (i ? 2 : 0);
        budget.checkString(length);
        pieces.push(piece);
      }
      if (value.v.length > 40) pieces.push(`.. (${value.v.length - 40} items omitted)`);
      return prettyArrayLike(pieces, value.v.length === 1);
    }
    case 'dictionary': {
      if (value.v.size === 0) return '(:)';
      function* pieces() {
        const dict = (value as Extract<Value, { type: 'dictionary' }>).v;
        let count = 0;
        for (const [key, child] of dict) {
          if (count++ === 40) break;
          yield reprField(isIdent(key) ? key : reprStr(key), child, budget, depth);
        }
        if (dict.size > 40) yield `.. (${dict.size - 40} pairs omitted)`;
      }
      return prettyArrayLike(pieces(), false);
    }
    case 'function': return value.v.name ?? '(..) => ..';
    case 'arguments': {
      function* pieces() {
        for (const item of (value as Extract<Value, { type: 'arguments' }>).v.items) {
          yield item.name === null ? reprValue(item.value, budget, depth + 1) : reprField(item.name, item.value, budget, depth);
        }
      }
      return joinRepr(['arguments', prettyArrayLike(pieces(), false)]);
    }
    case 'type': return value.v === 'none' || value.v === 'auto' ? `type(${value.v})` : value.v;
    case 'module': return joinRepr(['<module ', value.v.name, '>']);
    case 'alignment': return reprAlignment(value.v);
    case 'stroke': return reprStroke(value.v, budget, depth);
    case 'styles': return 'styles(..)';
    case 'label': return joinRepr(['<', value.v, '>']);
  }
}

function reprStroke(stroke: Stroke, budget: ValueBudget, depth: number): string {
  const { paint, thickness, cap, join, dash, miterLimit } = stroke;
  if (cap === undefined && join === undefined && dash === undefined && miterLimit === undefined) {
    if (paint !== undefined && thickness !== undefined) return joinRepr([reprLength(thickness), ' + ', reprColor(paint)]);
    if (paint !== undefined) return reprColor(paint);
    if (thickness !== undefined) return reprLength(thickness);
    return '1pt + black';
  }
  function* parts() {
    if (paint !== undefined) yield joinRepr(['paint: ', reprColor(paint)]);
    if (thickness !== undefined) yield joinRepr(['thickness: ', reprLength(thickness)]);
    if (cap !== undefined) yield joinRepr(['cap: ', reprStr(cap)]);
    if (join !== undefined) yield joinRepr(['join: ', reprStr(join)]);
    if (dash !== undefined) yield joinRepr(['dash: ', dash === null ? 'none' : reprDash(dash, budget, depth)]);
    if (miterLimit !== undefined) yield joinRepr(['miter-limit: ', formatFloat(miterLimit, null, true, '')]);
  }
  return joinRepr(['(', joinRepr(parts(), ', '), ')']);
}

function reprDash(dash: DashPattern, budget: ValueBudget, depth: number): string {
  function* lengths() {
    for (const length of dash.array) {
      budget.visit(depth + 1);
      yield length === null ? reprStr('dot') : reprLength(length);
    }
  }
  return joinRepr(['(array: (', joinRepr(lengths(), ', '), '), phase: ', reprLength(dash.phase), ')']);
}

// The order of each element's fields, as Typst declares them, with the kind of
// value each one holds. `repr` and `toJson` list fields in this order.
export type FieldKind =
  | 'content'
  | 'optContent'
  | 'contents'
  | 'rows'
  | 'bool'
  | 'int'
  | 'str'
  | 'optStr'
  | 'rel'
  | 'spacing'
  | 'delims'
  | 'halign'
  | 'augment'
  | 'class'
  | 'enum'
  | 'cancelAngle'
  | 'stroke'
  | 'styles'
  | 'length'
  | 'optColor'
  | 'sizing'
  | 'smartRel'
  | 'baseline'
  | 'sides'
  | 'sidesStroke'
  | 'corners'
  | 'edge'
  | 'numbering'
  | 'alignment'
  | 'supplement';

const UNDER_OVER: [string, FieldKind][] = [
  ['body', 'content'],
  ['annotation', 'optContent'],
];

export const ELEM_FIELDS: Record<ElemName, readonly [string, FieldKind][]> = {
  sequence: [['children', 'contents']],
  styled: [
    ['child', 'content'],
    ['styles', 'styles'],
  ],
  space: [],
  linebreak: [['justify', 'bool']],
  text: [['text', 'str']],
  symbol: [['text', 'str']],
  raw: [
    ['text', 'str'],
    ['block', 'bool'],
    ['lang', 'optStr'],
  ],
  h: [
    ['amount', 'spacing'],
    ['weak', 'bool'],
  ],
  'align-point': [],
  equation: [
    ['block', 'bool'],
    ['numbering', 'numbering'],
    ['number-align', 'alignment'],
    ['supplement', 'supplement'],
    ['alt', 'optStr'],
    ['body', 'content'],
  ],
  class: [
    ['class', 'class'],
    ['body', 'content'],
  ],
  attach: [
    ['base', 'content'],
    ['t', 'optContent'],
    ['b', 'optContent'],
    ['tl', 'optContent'],
    ['bl', 'optContent'],
    ['tr', 'optContent'],
    ['br', 'optContent'],
  ],
  primes: [['count', 'int']],
  scripts: [['body', 'content']],
  limits: [
    ['body', 'content'],
    ['inline', 'bool'],
  ],
  stretch: [
    ['body', 'content'],
    ['size', 'rel'],
  ],
  lr: [
    ['size', 'rel'],
    ['body', 'content'],
  ],
  mid: [['body', 'content']],
  accent: [
    ['base', 'content'],
    ['accent', 'str'],
    ['size', 'rel'],
    ['dotless', 'bool'],
  ],
  underline: [['body', 'content']],
  overline: [['body', 'content']],
  underbrace: UNDER_OVER,
  overbrace: UNDER_OVER,
  underbracket: UNDER_OVER,
  overbracket: UNDER_OVER,
  underparen: UNDER_OVER,
  overparen: UNDER_OVER,
  undershell: UNDER_OVER,
  overshell: UNDER_OVER,
  cancel: [
    ['body', 'content'],
    ['length', 'rel'],
    ['inverted', 'bool'],
    ['cross', 'bool'],
    ['angle', 'cancelAngle'],
    ['stroke', 'stroke'],
  ],
  frac: [
    ['num', 'content'],
    ['denom', 'content'],
    ['style', 'enum'],
  ],
  binom: [
    ['upper', 'content'],
    ['lower', 'contents'],
  ],
  vec: [
    ['delim', 'delims'],
    ['align', 'halign'],
    ['gap', 'rel'],
    ['children', 'contents'],
  ],
  mat: [
    ['delim', 'delims'],
    ['align', 'halign'],
    ['augment', 'augment'],
    ['row-gap', 'rel'],
    ['column-gap', 'rel'],
    ['rows', 'rows'],
  ],
  cases: [
    ['delim', 'delims'],
    ['reverse', 'bool'],
    ['gap', 'rel'],
    ['children', 'contents'],
  ],
  root: [
    ['index', 'optContent'],
    ['radicand', 'content'],
  ],
  op: [
    ['text', 'content'],
    ['limits', 'bool'],
  ],
  parbreak: [],
  smartquote: [['double', 'bool']],
  strong: [
    ['delta', 'int'],
    ['body', 'content'],
  ],
  emph: [['body', 'content']],
  hide: [['body', 'content']],
  link: [
    ['dest', 'str'],
    ['body', 'content'],
  ],
  box: [
    ['width', 'sizing'],
    ['height', 'smartRel'],
    ['baseline', 'baseline'],
    ['fill', 'optColor'],
    ['stroke', 'sidesStroke'],
    ['radius', 'corners'],
    ['inset', 'sides'],
    ['outset', 'sides'],
    ['clip', 'bool'],
    ['body', 'optContent'],
  ],
  highlight: [
    ['fill', 'optColor'],
    ['stroke', 'sidesStroke'],
    ['top-edge', 'edge'],
    ['bottom-edge', 'edge'],
    ['extent', 'length'],
    ['radius', 'corners'],
    ['body', 'content'],
  ],
};

/** Sides as a value: their common value if all are set and equal, else a dictionary of the set ones. */
function sidesValue<T>(sides: Sides<T>, f: (v: T) => Value): Value {
  const values = SIDES.map((side) => (sides[side] === undefined ? undefined : f(sides[side]!)));
  if (values[0] !== undefined && values.every((v) => v !== undefined && equal(v, values[0]!))) return values[0];
  return dictValue(new Map(SIDES.flatMap((side, i) => (values[i] === undefined ? [] : [[side, values[i]!]]))));
}

/** Corners as a value, like sides. */
function cornersValue<T>(corners: Corners<T>, f: (v: T) => Value): Value {
  const values = CORNERS.map((corner) => (corners[corner] === undefined ? undefined : f(corners[corner]!)));
  if (values[0] !== undefined && values.every((v) => v !== undefined && equal(v, values[0]!))) return values[0];
  return dictValue(new Map(CORNERS.flatMap((corner, i) => (values[i] === undefined ? [] : [[corner, values[i]!]]))));
}

const relValue = (rel: RelLength): Value => ({ type: 'relative', v: rel });

/** Wrapping content fields is work too, before recursive serialization begins. */
function mapField<T, U>(items: readonly T[], convert: (item: T) => U): U[] {
  return withValueContext((budget) => items.map((item) => { budget.visit(); return convert(item); }));
}

/** Converts a field of an element to a value, as Typst's `IntoValue` for the field's type does. */
export function fieldValue(kind: FieldKind, raw: unknown): Value {
  switch (kind) {
    case 'content':
      return contentValue(raw as Content);
    case 'optContent':
      return raw === null ? NONE : contentValue(raw as Content);
    case 'contents':
      return arrayValue(mapField(raw as Content[], contentValue));
    case 'rows':
      return arrayValue(mapField(raw as Content[][], (row) => arrayValue(mapField(row, contentValue))));
    case 'bool':
      return boolValue(raw as boolean);
    case 'int':
      return intValue(BigInt(raw as number));
    case 'str':
    case 'enum':
      return strValue(raw as string);
    case 'optStr':
      return raw === null ? NONE : strValue(raw as string);
    case 'rel':
      return { type: 'relative', v: raw as RelLength };
    case 'spacing': {
      const spacing = raw as Spacing;
      if ('fr' in spacing) return { type: 'fraction', v: spacing.fr };
      if (spacing.rel.rel === 0) return { type: 'length', v: spacing.rel.abs };
      if (lengthIsZero(spacing.rel.abs)) return { type: 'ratio', v: spacing.rel.rel };
      return { type: 'relative', v: spacing.rel };
    }
    case 'delims': {
      const pair = raw as DelimiterPair;
      const delim = (d: string | null) => (d === null ? NONE : strValue(d));
      return arrayValue([delim(pair.open), delim(pair.close)]);
    }
    case 'halign':
      return { type: 'alignment', v: { x: raw as Alignment['x'] } };
    case 'augment': {
      if (raw === null) return NONE;
      const augment = raw as Augment;
      if (augment.stroke === null && augment.hline.length === 0 && augment.vline.length === 1) {
        return intValue(BigInt(augment.vline[0]!));
      }
      const offsets = (list: readonly number[]) => arrayValue(mapField(list, (n) => intValue(BigInt(n))));
      return dictValue(
        new Map<string, Value>([
          ['hline', offsets(augment.hline)],
          ['vline', offsets(augment.vline)],
          ['stroke', augment.stroke === null ? AUTO : { type: 'stroke', v: augment.stroke }],
        ]),
      );
    }
    case 'class':
      return strValue(MATH_CLASS_NAMES[raw as MathClass]);
    case 'cancelAngle': {
      if (raw === null) return AUTO;
      const angle = raw as { angle: Angle } | { func: Func };
      return 'angle' in angle ? { type: 'angle', v: angle.angle } : funcValue(angle.func);
    }
    case 'stroke':
      return { type: 'stroke', v: raw as Stroke };
    case 'styles':
      return { type: 'styles', v: raw as Styles };
    case 'length':
      return { type: 'length', v: raw as Length };
    case 'optColor':
      return raw === null ? NONE : { type: 'color', v: raw as Color };
    case 'sizing': {
      const sizing = raw as Sizing;
      if (sizing === 'auto') return AUTO;
      return 'fr' in sizing ? { type: 'fraction', v: sizing.fr } : relValue(sizing.rel);
    }
    case 'smartRel':
      return raw === 'auto' ? AUTO : relValue(raw as RelLength);
    case 'baseline': {
      const baseline = raw as BoxBaseline;
      const map = new Map<string, Value>();
      if (baseline.at !== undefined) map.set('at', baseline.at === 'auto' ? AUTO : { type: 'alignment', v: { y: baseline.at } });
      if (baseline.shift !== undefined) map.set('shift', relValue(baseline.shift));
      return dictValue(map);
    }
    case 'sides':
      return sidesValue(raw as Sides<RelLength>, relValue);
    case 'sidesStroke':
      return sidesValue(raw as Sides<Stroke | null>, (stroke) => (stroke === null ? NONE : { type: 'stroke', v: stroke }));
    case 'corners':
      return cornersValue(raw as Corners<RelLength>, relValue);
    case 'edge':
      return typeof raw === 'string' ? strValue(raw) : { type: 'length', v: raw as Length };
    case 'numbering': {
      if (raw === null) return NONE;
      const numbering = raw as Numbering;
      return numbering.kind === 'pattern' ? strValue(numbering.source) : funcValue(numbering.func);
    }
    case 'alignment':
      return { type: 'alignment', v: raw as Alignment };
    case 'supplement':
      return raw === null ? NONE : (raw as { func?: string }).func !== undefined ? contentValue(raw as Content) : (raw as Value);
  }
}

/** The names Typst gives math classes as values, in `MathClass` order. */
export const MATH_CLASS_NAMES = [
  'normal', 'alphabetic', 'binary', 'closing', 'diacritic', 'fence', 'glyph-part', 'large',
  'opening', 'punctuation', 'relation', 'space', 'unary', 'vary', 'special',
] as const;

/** The set fields of an element, in Typst's order, as values. */
export function contentFields(content: Content): [string, Value][] {
  const record = content as unknown as Record<string, unknown>;
  return ELEM_FIELDS[content.func]
    .filter(([name]) => record[name] !== undefined)
    .map(([name, kind]) => [name, fieldValue(kind, record[name])]);
}

function reprContent(content: Content, budget: ValueBudget, depth: number): string {
  switch (content.func) {
    case 'sequence': {
      if (content.children.length === 0) return '[]';
      function* pieces() {
        for (const child of (content as Extract<Content, { func: 'sequence' }>).children) {
          yield reprValue(contentValue(child), budget, depth + 1);
        }
      }
      return joinRepr(['sequence', prettyArrayLike(pieces(), false)]);
    }
    case 'styled': return joinRepr(['styled(child: ', reprValue(contentValue(content.child), budget, depth + 1), ', ..)']);
    case 'text':
    case 'symbol': return joinRepr(['[', content.text, ']']);
    case 'space': return '[ ]';
    default: {
      function* pieces() {
        for (const [name, value] of contentFields(content)) yield reprField(name, value, budget, depth);
      }
      return joinRepr([content.func, prettyArrayLike(pieces(), false)]);
    }
  }
}

// --- display ---------------------------------------------------------------

/**
 * Turns a value into content, as Typst does when it displays a value in
 * markup or math. With a span, the result is also `spanned`, as in
 * `eval_display`.
 */
export function display(value: Value, span: Span = null): Content {
  switch (value.type) {
    case 'none':
      return { func: 'sequence', children: [], span };
    case 'int':
      return textElem(formatIntWithBase(value.v, 10), span);
    case 'float':
      return textElem(displayFloat(value.v), span);
    case 'str':
      return textElem(value.v, span);
    case 'symbol':
      return symbolElem(symbolGet(value.v), span);
    case 'content':
      return spanned(value.v, span);
    default:
      return at(span, () => ({ func: 'raw', text: repr(value), lang: 'typc', block: false, span }));
  }
}

// --- equality --------------------------------------------------------------

/** Whether two values are equal, as Typst's `==` decides. */
export function equal(a: Value, b: Value): boolean {
  return withValueContext((budget) => compareValue(a, b, budget, 0, false));
}

function compareValue(a: Value, b: Value, budget: ValueBudget, depth: number, hash: boolean): boolean {
  budget.visit(depth);
  if (hash && a.type !== b.type) return false;
  switch (a.type) {
    case 'none':
    case 'auto':
      return a.type === b.type;
    case 'bool':
      return b.type === 'bool' && a.v === b.v;
    case 'int':
      if (b.type === 'int') return a.v === b.v;
      return b.type === 'float' && Number(a.v) === b.v;
    case 'float':
      if (b.type === 'float') return numberEqual(a.v, b.v, hash);
      return b.type === 'int' && a.v === Number(b.v);
    case 'length':
      if (hash) return lengthBitsEqual(a.v, (b as typeof a).v);
      if (b.type === 'length') return lengthEq(a.v, b.v);
      return b.type === 'relative' && lengthEq(a.v, b.v.abs) && b.v.rel === 0;
    case 'ratio':
      if (b.type === 'ratio') return numberEqual(a.v, b.v, hash);
      return b.type === 'relative' && a.v === b.v.rel && lengthIsZero(b.v.abs);
    case 'relative':
      if (hash) {
        const y = (b as typeof a).v;
        return Object.is(a.v.rel, y.rel) && lengthBitsEqual(a.v.abs, y.abs);
      }
      if (b.type === 'relative') return relEq(a.v, b.v);
      if (b.type === 'length') return lengthEq(b.v, a.v.abs) && a.v.rel === 0;
      return b.type === 'ratio' && b.v === a.v.rel && lengthIsZero(a.v.abs);
    case 'angle':
    case 'fraction':
      return b.type === a.type && numberEqual(a.v, b.v, hash);
    case 'color':
      return b.type === 'color' && colorEq(a.v, b.v);
    case 'symbol':
      return b.type === 'symbol' && symbolEq(a.v, b.v);
    case 'str':
      return b.type === 'str' && a.v === b.v;
    case 'content':
      return b.type === 'content' && (!hash || sameSpan(a.v.span, b.v.span)) && jsonEqual(jsonValue(a, budget, depth), jsonValue(b, budget, depth), budget, depth);
    case 'array':
      return b.type === 'array' && a.v.length === b.v.length && a.v.every((x, i) => compareValue(x, b.v[i]!, budget, depth + 1, hash));
    case 'dictionary': {
      if (b.type !== 'dictionary' || a.v.size !== b.v.size) return false;
      const entries = b.v.entries();
      for (const [key, child] of a.v) {
        const other = hash ? entries.next().value! : [key, b.v.get(key)] as const;
        if (other[0] !== key || other[1] === undefined || !compareValue(child, other[1], budget, depth + 1, hash)) return false;
      }
      return true;
    }
    case 'function':
      return b.type === 'function' && compareFunctions(a.v, b.v, budget, depth);
    case 'arguments':
      if (b.type !== 'arguments') return false;
      if (!hash) return compareArgs(a.v, b.v, budget, depth);
      return sameSpan(a.v.span, b.v.span) && a.v.items.length === b.v.items.length && a.v.items.every((item, i) => {
        const other = b.v.items[i]!;
        return item.name === other.name && compareValue(item.value, other.value, budget, depth + 1, true);
      });
    case 'type':
      return b.type === 'type' && a.v === b.v;
    case 'module':
      return b.type === 'module' && a.v === b.v;
    case 'alignment':
      return b.type === 'alignment' && alignmentEq(a.v, b.v);
    case 'stroke':
      return b.type === 'stroke' && repr(a) === repr(b);
    case 'styles':
      return false;
    case 'label':
      return b.type === 'label' && a.v === b.v;
  }
}


/** Function identity and closure hashing retain their existing semantics. */
function compareFunctions(a: Func, b: Func, budget: ValueBudget, depth: number): boolean {
  budget.visit(depth);
  if (a === b) return true;
  if (a.closure && b.closure) {
    const x = a.closure;
    const y = b.closure;
    return sameSpan(x.node.span, y.node.span) && x.defaults.length === y.defaults.length
      && x.defaults.every((value, i) => compareValue(value, y.defaults[i]!, budget, depth + 1, true))
      && compareScopes(x.captured, y.captured, budget, depth + 1);
  }
  return false;
}

function compareScopes(a: Scope, b: Scope, budget: ValueBudget, depth: number): boolean {
  budget.visit(depth);
  let countA = 0;
  let countB = 0;
  for (const name of a.names()) {
    countA++;
    const other = b.get(name);
    if (other === undefined || !compareValue(a.get(name)!.value, other.value, budget, depth + 1, true)) return false;
  }
  for (const _name of b.names()) { budget.visit(depth + 1); countB++; }
  return countA === countB;
}

/** Equality of arguments: positional values in order, named values as a dictionary. */
export function argsEqual(a: Args, b: Args): boolean {
  return withValueContext((budget) => compareArgs(a, b, budget, 0));
}

function compareArgs(a: Args, b: Args, budget: ValueBudget, depth: number): boolean {
  budget.visit(depth);
  const split = (args: Args) => {
    const pos: Value[] = [];
    const named = new Map<string, Value>();
    for (const item of args.items) {
      budget.visit(depth + 1);
      if (item.name === null) pos.push(item.value);
      else named.set(item.name, item.value);
    }
    return { pos, named };
  };
  const x = split(a);
  const y = split(b);
  return compareValue(arrayValue(x.pos), arrayValue(y.pos), budget, depth, false)
    && compareValue(dictValue(x.named), dictValue(y.named), budget, depth, false);
}

const numberEqual = (a: number, b: number, hash: boolean): boolean => hash ? Object.is(a, b) : a === b;
const lengthBitsEqual = (a: Length, b: Length): boolean => Object.is(a.abs, b.abs) && Object.is(a.em, b.em);

/** Hash equality preserves floating bits, dictionary order and content locations. */
export function hashEqual(a: Value, b: Value): boolean {
  return withValueContext((budget) => compareValue(a, b, budget, 0, true));
}

/** Compares JSON equivalents without materializing their escaped string form. */
function jsonEqual(a: unknown, b: unknown, budget: ValueBudget, depth: number): boolean {
  const stack: [unknown, unknown, number][] = [[a, b, depth]];
  while (stack.length) {
    const [rawA, rawB, level] = stack.pop()!;
    budget.visit(level);
    const x = typeof rawA === 'number' && !Number.isFinite(rawA) ? null : rawA;
    const y = typeof rawB === 'number' && !Number.isFinite(rawB) ? null : rawB;
    if (x === y) continue;
    if (!x || !y || typeof x !== 'object' || typeof y !== 'object') return false;
    if (Array.isArray(x) || Array.isArray(y)) {
      if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return false;
      for (let i = x.length - 1; i >= 0; i--) stack.push([x[i] ?? null, y[i] ?? null, level + 1]);
    } else {
      const left = x as Record<string, unknown>;
      const right = y as Record<string, unknown>;
      const keys = Object.keys(left).filter((key) => left[key] !== undefined);
      const other = Object.keys(right).filter((key) => right[key] !== undefined);
      if (keys.length !== other.length || keys.some((key, i) => key !== other[i])) return false;
      for (let i = keys.length - 1; i >= 0; i--) stack.push([left[keys[i]!], right[keys[i]!], level + 1]);
    }
  }
  return true;
}

// --- serialization ---------------------------------------------------------

/** Serializes a value to JSON as Typst's serde implementation does. */
export function toJson(value: Value): unknown {
  return withValueContext((budget) => jsonValue(value, budget, 0));
}

function jsonValue(value: Value, budget: ValueBudget, depth: number): unknown {
  budget.visit(depth);
  switch (value.type) {
    case 'none': return null;
    case 'bool':
    case 'float':
    case 'str': return value.v;
    case 'int': return Number(value.v);
    case 'symbol': return symbolGet(value.v);
    case 'content': return jsonContent(value.v, budget, depth);
    case 'array': return value.v.map((child) => jsonValue(child, budget, depth + 1));
    case 'dictionary': {
      function* entries(): Generator<[string, unknown]> {
        for (const [key, child] of (value as Extract<Value, { type: 'dictionary' }>).v) yield [key, jsonValue(child, budget, depth + 1)];
      }
      return Object.fromEntries(entries());
    }
    default: {
      const text = reprInner(value, budget, depth);
      budget.checkString(text.length);
      return text;
    }
  }
}

/** Serializes content to JSON as Typst's `#metadata` does: `{func, ...fields}`. */
export function contentToJson(content: Content): Record<string, unknown> {
  return toJson(contentValue(content)) as Record<string, unknown>;
}

function jsonContent(content: Content, budget: ValueBudget, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = { func: content.func };
  for (const [name, value] of contentFields(content)) {
    if (!INTERNAL_FIELDS.has(name)) out[name] = jsonValue(value, budget, depth + 1);
  }
  if (content.label !== undefined) out.label = joinRepr(['<', content.label, '>']);
  return out;
}
