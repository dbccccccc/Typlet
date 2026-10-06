// Ported from Typst 0.15.1: crates/typst-library/src/foundations/cast.rs, crates/typst-library/src/foundations/int.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { type Content, type Corners, type DashPattern, type Sides, type Stroke, symbolElem, textElem, empty } from './content.js';
import { HintedError, bail, unsupported } from './diag.js';
import type { Func } from './func.js';
import {
  type Alignment,
  type Angle,
  absPt,
  length,
  type Fr,
  type HAlignment,
  type Length,
  type Ratio,
  type RelLength,
  relFromLength,
  relFromRatio,
  reprAlignment,
} from './layout.js';
import { separatedList } from './repr.js';
import { symbolGet } from './symbol.js';
import { type TypeName, type Value, longName, repr, strValue, typeOf } from './value.js';
import type { Color } from './color.js';

/** What a parameter accepts, like Typst's `CastInfo`. */
export type CastInfo =
  | { readonly kind: 'any' }
  | { readonly kind: 'value'; readonly value: Value }
  | { readonly kind: 'type'; readonly type: TypeName }
  | { readonly kind: 'union'; readonly infos: readonly CastInfo[] };

export const anyInfo: CastInfo = { kind: 'any' };
export const typeInfo = (type: TypeName): CastInfo => ({ kind: 'type', type });
export const valueInfo = (value: Value): CastInfo => ({ kind: 'value', value });

/** Combines cast infos into a union, flattening nested unions without duplicates. */
export function union(...infos: CastInfo[]): CastInfo {
  const out: CastInfo[] = [];
  for (const info of infos) {
    for (const leaf of info.kind === 'union' ? info.infos : [info]) {
      if (!out.some((x) => sameInfo(x, leaf))) out.push(leaf);
    }
  }
  return { kind: 'union', infos: out };
}

function sameInfo(a: CastInfo, b: CastInfo): boolean {
  if (a.kind === 'type' && b.kind === 'type') return a.type === b.type;
  if (a.kind === 'value' && b.kind === 'value') {
    // Strings are the same when their text is. The casts made at startup
    // compare many, and `repr` of a string is costly the first time.
    if (a.value.type === 'str' && b.value.type === 'str') return a.value.v === b.value.v;
    return repr(a.value) === repr(b.value);
  }
  return a.kind === b.kind && a.kind === 'any';
}

function walk(info: CastInfo, f: (leaf: CastInfo) => void): void {
  if (info.kind === 'union') for (const child of info.infos) walk(child, f);
  else f(info);
}

/** The error for a value that doesn't match `info`, such as "expected integer, found string". */
export function castError(info: CastInfo, found: Value): HintedError {
  let matchingType = false;
  const parts: string[] = [];
  walk(info, (leaf) => {
    if (leaf.kind === 'any') parts.push('anything');
    else if (leaf.kind === 'value') {
      parts.push(repr(leaf.value));
      if (leaf.value.type === found.type) matchingType = true;
    } else if (leaf.kind === 'type') parts.push(longName(leaf.type));
  });

  let message = 'expected ';
  if (parts.length === 0) message += ' nothing';
  message += separatedList(parts, 'or');
  if (!matchingType) message += `, found ${typeOf(found)}`;

  const error = new HintedError(message);
  if (found.type === 'int' && !matchingType && parts.includes('length')) {
    error.hint(`a length needs a unit - did you mean ${found.v}pt?`);
  }
  return error;
}

/** A conversion from values to a type, like Typst's `Reflect` and `FromValue`. */
export interface Cast<T> {
  readonly info: CastInfo;
  /** Whether the value has a type this cast accepts, like `Reflect::castable`. */
  castable(value: Value): boolean;
  /** Converts the value or throws a `HintedError`. */
  cast(value: Value): T;
}

/** A cast that accepts values of the given types and converts them with `f`. */
function simple<T>(types: TypeName[], f: (value: Value) => T, info: CastInfo = typeInfo(types[0]!)): Cast<T> {
  return {
    info,
    castable: (value) => types.includes(value.type),
    cast(value) {
      if (!types.includes(value.type)) throw castError(info, value);
      return f(value);
    },
  };
}

/** Accepts anything. */
export const valueCast: Cast<Value> = { info: anyInfo, castable: () => true, cast: (v) => v };

export const boolCast = simple(['bool'], (v) => (v as Extract<Value, { type: 'bool' }>).v);
export const intCast = simple(['int'], (v) => (v as Extract<Value, { type: 'int' }>).v);
export const floatCast = simple(['float', 'int'], (v) =>
  v.type === 'int' ? Number(v.v) : (v as Extract<Value, { type: 'float' }>).v,
);
export const lengthCast = simple(['length'], (v) => (v as Extract<Value, { type: 'length' }>).v as Length);
export const angleCast = simple(['angle'], (v) => (v as Extract<Value, { type: 'angle' }>).v as Angle);
export const ratioCast = simple(['ratio'], (v) => (v as Extract<Value, { type: 'ratio' }>).v as Ratio);
export const frCast = simple(['fraction'], (v) => (v as Extract<Value, { type: 'fraction' }>).v as Fr);
export const colorCast = simple(['color'], (v) => (v as Extract<Value, { type: 'color' }>).v as Color);
export const arrayCast = simple(['array'], (v) => (v as Extract<Value, { type: 'array' }>).v);
export const dictCast = simple(['dictionary'], (v) => (v as Extract<Value, { type: 'dictionary' }>).v);
export const alignmentCast = simple(['alignment'], (v) => (v as Extract<Value, { type: 'alignment' }>).v as Alignment);

/** A relative length, also from a length or a ratio. */
export const relCast = simple(['relative', 'length', 'ratio'], (v): RelLength => {
  if (v.type === 'length') return relFromLength(v.v);
  if (v.type === 'ratio') return relFromRatio(v.v);
  return (v as Extract<Value, { type: 'relative' }>).v;
});

/** A string, also from a symbol. */
export const strCast = simple(['str', 'symbol'], (v) =>
  v.type === 'symbol' ? symbolGet(v.v) : (v as Extract<Value, { type: 'str' }>).v,
);

/** Content, also from none, a symbol or a string. */
export const contentCast = simple(['content', 'none', 'symbol', 'str'], (v): Content => {
  switch (v.type) {
    case 'none':
      return empty();
    case 'symbol':
      return symbolElem(symbolGet(v.v));
    case 'str':
      return textElem(v.v);
    default:
      return (v as Extract<Value, { type: 'content' }>).v;
  }
});

/** A function. Callable symbols convert to their function. */
export function funcCast(symbolFunc: (value: Value) => Func): Cast<Func> {
  return simple(['function', 'symbol'], (v) =>
    v.type === 'symbol' ? symbolFunc(v) : (v as Extract<Value, { type: 'function' }>).v,
  );
}

/** A single character, from a string. */
export const charCast: Cast<string> = {
  info: typeInfo('str'),
  castable: (v) => v.type === 'str',
  cast(v) {
    if (v.type !== 'str') throw castError(typeInfo('str'), v);
    const chars = [...v.v];
    if (chars.length !== 1) bail('expected exactly one character');
    return chars[0]!;
  },
};

/** A non-negative integer that fits Rust's `usize`. */
export const usizeCast: Cast<number> = {
  ...intCast,
  cast(v) {
    const n = intCast.cast(v);
    if (n < 0n) bail('number must be at least zero');
    if (n > 0xffff_ffff_ffff_ffffn) bail('number too large');
    return Number(n);
  },
};

/** An integer that fits Rust's `isize`. */
export const isizeCast: Cast<number> = {
  ...intCast,
  cast(v) {
    const n = intCast.cast(v);
    if (n > 0x7fff_ffff_ffff_ffffn || n < -0x8000_0000_0000_0000n) bail('number too large');
    return Number(n);
  },
};

/** `none` or a value of `inner`, like Typst's `Option<T>`. */
export function optionCast<T>(inner: Cast<T>): Cast<T | null> {
  const info = union(inner.info, typeInfo('none'));
  return {
    info,
    castable: (v) => v.type === 'none' || inner.castable(v),
    cast(v) {
      if (v.type === 'none') return null;
      if (inner.castable(v)) return inner.cast(v);
      throw castError(info, v);
    },
  };
}

/** `auto` (as `null`) or a value of `inner`, like Typst's `Smart<T>`. */
export function smartCast<T>(inner: Cast<T>): Cast<T | null> {
  const info = union(inner.info, typeInfo('auto'));
  return {
    info,
    castable: (v) => v.type === 'auto' || inner.castable(v),
    cast(v) {
      if (v.type === 'auto') return null;
      if (inner.castable(v)) return inner.cast(v);
      throw castError(info, v);
    },
  };
}

/** One of the given strings, like an enum deriving Typst's `Cast`. */
export function enumCast<T extends string>(names: readonly T[]): Cast<T> {
  const info = union(...names.map((name) => valueInfo(strValue(name))));
  return {
    info,
    castable: (v) => v.type === 'str' && (names as readonly string[]).includes(v.v),
    cast(v) {
      if (v.type === 'str' && (names as readonly string[]).includes(v.v)) return v.v as T;
      throw castError(info, v);
    },
  };
}

/** A horizontal alignment. */
export const hAlignmentCast: Cast<HAlignment> = {
  info: typeInfo('alignment'),
  castable: (v) => v.type === 'alignment',
  cast(v) {
    const a = alignmentCast.cast(v);
    if (a.x === undefined || a.y !== undefined) {
      bail(`expected \`start\`, \`left\`, \`center\`, \`right\`, or \`end\`, found ${reprAlignment(a)}`);
    }
    return a.x;
  },
};

/**
 * A cast that tries several casts in order, like Typst's `cast!` macro with
 * several arms. `info` is their union.
 */
export function unionCast<T>(...arms: Cast<T>[]): Cast<T> {
  const info = union(...arms.map((arm) => arm.info));
  return {
    info,
    castable: (v) => arms.some((arm) => arm.castable(v)),
    cast(v) {
      for (const arm of arms) if (arm.castable(v)) return arm.cast(v);
      throw castError(info, v);
    },
  };
}

/** Maps the result of a cast. */
export function mapCast<T, U>(cast: Cast<T>, f: (value: T) => U): Cast<U> {
  return { info: cast.info, castable: cast.castable, cast: (v) => f(cast.cast(v)) };
}

/** Typst's error for dictionary keys a cast doesn't use, like `Dict::unexpected_keys`. */
export function unexpectedKeys(unexpected: string[], expected: readonly string[] | null): HintedError {
  const list = (keys: readonly string[]) => separatedList(keys.map((k) => `"${k}"`), 'and');
  const valid = expected ? `, valid keys are ${list(expected)}` : '';
  return new HintedError(`unexpected key${unexpected.length === 1 ? '' : 's'} ${list(unexpected)}${valid}`);
}

const SIDE_KEYS = ['left', 'top', 'right', 'bottom', 'x', 'y', 'rest'] as const;

/**
 * A value for each side, like Typst's `Sides<Option<T>>` cast: one value for
 * all sides, or a dictionary with `left`, `top`, `right`, `bottom`, `x`, `y`
 * and `rest`.
 */
export function sidesCast<T>(inner: Cast<T>): Cast<Sides<T>> {
  const info = union(inner.info, typeInfo('dictionary'));
  return {
    info,
    castable: (v) => v.type === 'dictionary' || inner.castable(v),
    cast(v): Sides<T> {
      if (v.type === 'dictionary') {
        if (v.v.size === 0) return {};
        if ([...v.v.keys()].some((k) => (SIDE_KEYS as readonly string[]).includes(k))) {
          const take = (key: string): T | undefined => (v.v.has(key) ? inner.cast(v.v.get(key)!) : undefined);
          const rest = take('rest');
          const x = or(take('x'), rest);
          const y = or(take('y'), rest);
          const sides = defined({ left: or(take('left'), x), top: or(take('top'), y), right: or(take('right'), x), bottom: or(take('bottom'), y) });
          const unknown = [...v.v.keys()].filter((k) => !(SIDE_KEYS as readonly string[]).includes(k));
          if (unknown.length > 0) throw unexpectedKeys(unknown, SIDE_KEYS);
          return sides;
        }
      }
      if (inner.castable(v)) {
        const value = inner.cast(v);
        return { left: value, top: value, right: value, bottom: value };
      }
      if (v.type === 'dictionary') throw unexpectedKeys([...v.v.keys()], null);
      throw castError(info, v);
    },
  };
}

const CORNER_KEYS = ['top-left', 'top-right', 'bottom-right', 'bottom-left', 'left', 'top', 'right', 'bottom', 'rest'] as const;

/** A value for each corner, like Typst's `Corners<Option<T>>` cast. */
export function cornersCast<T>(inner: Cast<T>): Cast<Corners<T>> {
  const info = union(inner.info, typeInfo('dictionary'));
  return {
    info,
    castable: (v) => v.type === 'dictionary' || inner.castable(v),
    cast(v): Corners<T> {
      if (v.type === 'dictionary') {
        if (v.v.size === 0) return {};
        if ([...v.v.keys()].some((k) => (CORNER_KEYS as readonly string[]).includes(k))) {
          const take = (key: string): T | undefined => (v.v.has(key) ? inner.cast(v.v.get(key)!) : undefined);
          const rest = take('rest');
          const left = or(take('left'), rest);
          const top = or(take('top'), rest);
          const right = or(take('right'), rest);
          const bottom = or(take('bottom'), rest);
          const corners = defined({
            'top-left': or(or(take('top-left'), top), left),
            'top-right': or(or(take('top-right'), top), right),
            'bottom-right': or(or(take('bottom-right'), bottom), right),
            'bottom-left': or(or(take('bottom-left'), bottom), left),
          });
          const unknown = [...v.v.keys()].filter((k) => !(CORNER_KEYS as readonly string[]).includes(k));
          if (unknown.length > 0) throw unexpectedKeys(unknown, CORNER_KEYS);
          return corners;
        }
      }
      if (inner.castable(v)) {
        const value = inner.cast(v);
        return { 'top-left': value, 'top-right': value, 'bottom-right': value, 'bottom-left': value };
      }
      if (v.type === 'dictionary') throw unexpectedKeys([...v.v.keys()], null);
      throw castError(info, v);
    },
  };
}

/** `a` unless it is undefined, like `Option::or`. */
const or = <T>(a: T | undefined, b: T | undefined): T | undefined => (a !== undefined ? a : b);

/** The object without its undefined properties. */
function defined<T extends object>(object: T): T {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined)) as T;
}

const STROKE_KEYS = ['paint', 'thickness', 'cap', 'join', 'dash', 'miter-limit'];

/** A length of a dash pattern, or `null` for `"dot"`: as long as the stroke is thick. */
const dashLengthCast: Cast<Length | null> = unionCast<Length | null>(
  { ...enumCast(['dot']), cast: (v) => (enumCast(['dot']).cast(v), null) },
  lengthCast,
);

/** Typst's named dash patterns, after TikZ, in points: `null` is a dot. */
const DASH_NAMES: Record<string, readonly (number | null)[]> = {
  solid: [],
  dotted: [null, 2],
  'densely-dotted': [null, 1],
  'loosely-dotted': [null, 4],
  dashed: [3, 3],
  'densely-dashed': [3, 2],
  'loosely-dashed': [3, 6],
  'dash-dotted': [3, 2, null, 2],
  'densely-dash-dotted': [3, 1, null, 1],
  'loosely-dash-dotted': [3, 4, null, 4],
};

/** A dash pattern: a name, an array of lengths, or `(array: .., phase: ..)`. */
export const dashCast: Cast<DashPattern> = (() => {
  const names = enumCast(Object.keys(DASH_NAMES));
  const arrayOf = (items: readonly Value[]) => items.map((item) => dashLengthCast.cast(item));
  const info = union(names.info, typeInfo('array'), typeInfo('dictionary'));
  return {
    info,
    castable: (v) => names.castable(v) || v.type === 'array' || v.type === 'dictionary',
    cast(v): DashPattern {
      if (names.castable(v)) {
        const pattern = DASH_NAMES[names.cast(v)]!;
        return { array: pattern.map((pt) => (pt === null ? null : length(absPt(pt), 0))), phase: length(0, 0) };
      }
      if (v.type === 'array') return { array: arrayOf(v.v), phase: length(0, 0) };
      if (v.type === 'dictionary') {
        const array = v.v.get('array');
        if (array === undefined) bail('dictionary does not contain key "array"');
        const phase = v.v.get('phase');
        const unknown = [...v.v.keys()].filter((k) => k !== 'array' && k !== 'phase');
        if (unknown.length > 0) throw unexpectedKeys(unknown, ['array', 'phase']);
        return { array: arrayOf(arrayCast.cast(array)), phase: phase === undefined ? length(0, 0) : lengthCast.cast(phase) };
      }
      throw castError(info, v);
    },
  };
})();

/** A paint: Typlet supports colors, and names gradients and tilings in errors. */
export const paintCast: Cast<Color> = {
  ...colorCast,
  info: union(...(['color', 'gradient', 'tiling'] as TypeName[]).map(typeInfo)),
  cast(v) {
    if (v.type !== 'color') throw castError(this.info, v);
    return v.v;
  },
};

/** A stroke: a length, a color, a stroke, or a dictionary of its parts, like Typst's `Stroke` cast. */
export const strokeCast: Cast<Stroke> = {
  info: union(...(['length', 'color', 'gradient', 'tiling', 'dictionary', 'stroke'] as TypeName[]).map(typeInfo)),
  castable: (v) => ['length', 'color', 'dictionary', 'stroke'].includes(v.type),
  cast(v) {
    switch (v.type) {
      case 'length':
        return { thickness: v.v };
      case 'color':
        return { paint: v.v };
      case 'stroke':
        return v.v;
      case 'dictionary': {
        // Each part is optional and may be `auto`.
        const take = <T>(key: string, cast: Cast<T>): T | undefined => {
          const value = v.v.get(key);
          return value === undefined ? undefined : (smartCast(cast).cast(value) ?? undefined);
        };
        const paint = take('paint', paintCast);
        const thickness = take('thickness', lengthCast);
        const cap = take('cap', enumCast(['butt', 'round', 'square'] as const));
        const join = take('join', enumCast(['miter', 'round', 'bevel'] as const));
        const dash = take('dash', optionCast(dashCast));
        const miterLimit = take('miter-limit', floatCast);
        const unknown = [...v.v.keys()].filter((k) => !STROKE_KEYS.includes(k));
        if (unknown.length > 0) throw unexpectedKeys(unknown, STROKE_KEYS);
        const stroke: { -readonly [K in keyof Stroke]: Stroke[K] } = {};
        if (paint !== undefined) stroke.paint = paint;
        if (thickness !== undefined) stroke.thickness = thickness;
        if (cap !== undefined) stroke.cap = cap;
        if (join !== undefined) stroke.join = join;
        if (dash !== undefined) stroke.dash = dash;
        if (miterLimit !== undefined) stroke.miterLimit = miterLimit;
        return stroke;
      }
      default:
        throw castError(this.info, v);
    }
  },
};
