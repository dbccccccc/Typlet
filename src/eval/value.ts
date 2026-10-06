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
import type { Span } from './diag.js';
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
import { displayFloat, formatFloat, formatIntWithBase, prettyArrayLike, reprStr } from './repr.js';
import type { Module } from './scope.js';
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
  | { readonly type: 'type'; readonly v: TypeName }
  | { readonly type: 'module'; readonly v: Module }
  | { readonly type: 'alignment'; readonly v: Alignment }
  | { readonly type: 'stroke'; readonly v: Stroke }
  | { readonly type: 'styles'; readonly v: Styles }
  | { readonly type: 'label'; readonly v: string };

export type TypeName = Value['type'];

/** Typst's long type names, as error messages use them. */
const LONG_NAMES: Partial<Record<TypeName, string>> = {
  bool: 'boolean',
  int: 'integer',
  relative: 'relative length',
  str: 'string',
};

/** The type's name in messages, such as "integer". */
export function longName(type: TypeName): string {
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
  switch (value.type) {
    case 'none':
      return 'none';
    case 'auto':
      return 'auto';
    case 'bool':
      return value.v ? 'true' : 'false';
    case 'int':
      return value.v.toString();
    case 'float':
      return formatFloat(value.v, null, true, '');
    case 'length':
      return reprLength(value.v);
    case 'angle':
      return reprAngle(value.v);
    case 'ratio':
      return reprRatio(value.v);
    case 'relative':
      return reprRel(value.v);
    case 'fraction':
      return reprFr(value.v);
    case 'color':
      return reprColor(value.v);
    case 'symbol':
      return reprSymbol(value.v);
    case 'str':
      return reprStr(value.v);
    case 'content':
      return reprContent(value.v);
    case 'array': {
      const max = 40;
      const pieces = value.v.slice(0, max).map(repr);
      if (value.v.length > max) pieces.push(`.. (${value.v.length - max} items omitted)`);
      return prettyArrayLike(pieces, value.v.length === 1);
    }
    case 'dictionary': {
      if (value.v.size === 0) return '(:)';
      const max = 40;
      const pieces = [...value.v]
        .slice(0, max)
        .map(([key, v]) => `${isIdent(key) ? key : reprStr(key)}: ${repr(v)}`);
      if (value.v.size > max) pieces.push(`.. (${value.v.size - max} pairs omitted)`);
      return prettyArrayLike(pieces, false);
    }
    case 'function':
      return value.v.name ?? '(..) => ..';
    case 'arguments':
      return `arguments${prettyArrayLike(
        value.v.items.map((item) => (item.name === null ? repr(item.value) : `${item.name}: ${repr(item.value)}`)),
        false,
      )}`;
    case 'type':
      return value.v;
    case 'module':
      return `<module ${value.v.name}>`;
    case 'alignment':
      return reprAlignment(value.v);
    case 'stroke':
      return reprStroke(value.v);
    case 'styles':
      return 'styles(..)';
    case 'label':
      return `<${value.v}>`;
  }
}

function reprStroke(stroke: Stroke): string {
  const { paint, thickness, cap, join, dash, miterLimit } = stroke;
  if (cap === undefined && join === undefined && dash === undefined && miterLimit === undefined) {
    if (paint !== undefined && thickness !== undefined) return `${reprLength(thickness)} + ${reprColor(paint)}`;
    if (paint !== undefined) return reprColor(paint);
    if (thickness !== undefined) return reprLength(thickness);
    return '1pt + black';
  }
  const parts: string[] = [];
  if (paint !== undefined) parts.push(`paint: ${reprColor(paint)}`);
  if (thickness !== undefined) parts.push(`thickness: ${reprLength(thickness)}`);
  if (cap !== undefined) parts.push(`cap: ${reprStr(cap)}`);
  if (join !== undefined) parts.push(`join: ${reprStr(join)}`);
  if (dash !== undefined) parts.push(`dash: ${dash === null ? 'none' : reprDash(dash)}`);
  if (miterLimit !== undefined) parts.push(`miter-limit: ${formatFloat(miterLimit, null, true, '')}`);
  return `(${parts.join(', ')})`;
}

function reprDash(dash: DashPattern): string {
  const array = dash.array.map((l) => (l === null ? reprStr('dot') : reprLength(l)));
  return `(array: (${array.join(', ')}), phase: ${reprLength(dash.phase)})`;
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

/** Converts a field of an element to a value, as Typst's `IntoValue` for the field's type does. */
export function fieldValue(kind: FieldKind, raw: unknown): Value {
  switch (kind) {
    case 'content':
      return contentValue(raw as Content);
    case 'optContent':
      return raw === null ? NONE : contentValue(raw as Content);
    case 'contents':
      return arrayValue((raw as Content[]).map(contentValue));
    case 'rows':
      return arrayValue((raw as Content[][]).map((row) => arrayValue(row.map(contentValue))));
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
      const offsets = (list: readonly number[]) => arrayValue(list.map((n) => intValue(BigInt(n))));
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

function reprContent(content: Content): string {
  switch (content.func) {
    case 'sequence':
      return content.children.length === 0
        ? '[]'
        : `sequence${prettyArrayLike(
            content.children.map((child) => reprContent(child)),
            false,
          )}`;
    case 'styled':
      return `styled(child: ${reprContent(content.child)}, ..)`;
    case 'text':
    case 'symbol':
      return `[${content.text}]`;
    case 'space':
      return '[ ]';
    default:
      return `${content.func}${prettyArrayLike(
        contentFields(content).map(([name, value]) => `${name}: ${repr(value)}`),
        false,
      )}`;
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
      return { func: 'raw', text: repr(value), lang: 'typc', block: false, span };
  }
}

// --- equality --------------------------------------------------------------

/** Whether two values are equal, as Typst's `==` decides. */
export function equal(a: Value, b: Value): boolean {
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
      if (b.type === 'float') return a.v === b.v;
      return b.type === 'int' && a.v === Number(b.v);
    case 'length':
      if (b.type === 'length') return lengthEq(a.v, b.v);
      return b.type === 'relative' && lengthEq(a.v, b.v.abs) && b.v.rel === 0;
    case 'ratio':
      if (b.type === 'ratio') return a.v === b.v;
      return b.type === 'relative' && a.v === b.v.rel && lengthIsZero(b.v.abs);
    case 'relative':
      if (b.type === 'relative') return relEq(a.v, b.v);
      if (b.type === 'length') return lengthEq(b.v, a.v.abs) && a.v.rel === 0;
      return b.type === 'ratio' && b.v === a.v.rel && lengthIsZero(a.v.abs);
    case 'angle':
    case 'fraction':
      return b.type === a.type && a.v === b.v;
    case 'color':
      return b.type === 'color' && colorEq(a.v, b.v);
    case 'symbol':
      return b.type === 'symbol' && symbolEq(a.v, b.v);
    case 'str':
      return b.type === 'str' && a.v === b.v;
    case 'content':
      return b.type === 'content' && JSON.stringify(toJson(a)) === JSON.stringify(toJson(b));
    case 'array':
      return b.type === 'array' && a.v.length === b.v.length && a.v.every((x, i) => equal(x, b.v[i]!));
    case 'dictionary':
      return (
        b.type === 'dictionary' &&
        a.v.size === b.v.size &&
        [...a.v].every(([key, x]) => b.v.has(key) && equal(x, b.v.get(key)!))
      );
    case 'function':
      return b.type === 'function' && a.v === b.v;
    case 'arguments':
      return b.type === 'arguments' && a.v === b.v;
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

// --- serialization ---------------------------------------------------------

/** Serializes a value to JSON as Typst's serde implementation does. */
export function toJson(value: Value): unknown {
  switch (value.type) {
    case 'none':
      return null;
    case 'bool':
    case 'float':
    case 'str':
      return value.v;
    case 'int':
      return Number(value.v);
    case 'symbol':
      return symbolGet(value.v);
    case 'content':
      return contentToJson(value.v);
    case 'array':
      return value.v.map(toJson);
    case 'dictionary':
      return Object.fromEntries([...value.v].map(([key, v]) => [key, toJson(v)]));
    default:
      return repr(value);
  }
}

/** Serializes content to JSON as Typst's `#metadata` does: `{func, ...fields}`. */
export function contentToJson(content: Content): Record<string, unknown> {
  const out: Record<string, unknown> = { func: content.func };
  for (const [name, value] of contentFields(content)) {
    if (!INTERNAL_FIELDS.has(name)) out[name] = toJson(value);
  }
  if (content.label !== undefined) out.label = `<${content.label}>`;
  return out;
}
