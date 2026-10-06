// Ported from Typst 0.15.1: crates/typst-library/src/foundations/ops.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { Args } from './args.js';
import { type Content, join as joinContent, repeat as repeatContent, symbolElem, textElem } from './content.js';
import { bail, bailLimit } from './diag.js';
import {
  type Length,
  type RelLength,
  alignmentAdd,
  lengthAdd,
  lengthCmp,
  lengthDiv,
  lengthIsZero,
  lengthMul,
  lengthNeg,
  lengthTryDiv,
  relAdd,
  relCmp,
  relDiv,
  relFromLength,
  relFromRatio,
  relIsZero,
  relMul,
  relNeg,
  relSub,
  relTryDiv,
  reprLength,
  reprRel,
  sc,
} from './layout.js';
import { formatFloat } from './repr.js';
import { symbolGet } from './symbol.js';
import {
  type Value,
  arrayValue,
  boolValue,
  contentValue,
  dictValue,
  equal,
  floatValue,
  intValue,
  strValue,
  typeOf,
} from './value.js';

const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;

/** Fails with a message naming the operands' types. */
function mismatch(template: string, ...values: Value[]): never {
  let i = 0;
  return bail(template.replace(/\{(\d?)\}/g, (_, n: string) => typeOf(values[n === '' ? i++ : Number(n)]!)));
}

function tooLarge(): never {
  return bail('value is too large');
}

/** Checks that an integer result fits Typst's 64-bit integers. */
function checked(n: bigint): Value {
  if (n < I64_MIN || n > I64_MAX) tooLarge();
  return intValue(n);
}

/** The payload of a value whose type a `switch` on type names has established. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (value: Value): any => (value as { v?: unknown }).v;

const length = (v: Length): Value => ({ type: 'length', v });
const relative = (v: RelLength): Value => ({ type: 'relative', v });
const ratio = (v: number): Value => ({ type: 'ratio', v: sc(v) });
const angle = (v: number): Value => ({ type: 'angle', v: sc(v) });
const fraction = (v: number): Value => ({ type: 'fraction', v: sc(v) });

/** Content from a value that joins with content: content, a symbol or a string. */
function asContent(value: Value): Content | null {
  if (value.type === 'content') return value.v;
  if (value.type === 'symbol') return symbolElem(symbolGet(value.v));
  if (value.type === 'str') return textElem(value.v);
  return null;
}

/** The text of a string or symbol. */
function asText(value: Value): string | null {
  if (value.type === 'str') return value.v;
  if (value.type === 'symbol') return symbolGet(value.v);
  return null;
}

/** Joins two values, as consecutive values in a code block do. */
export function join(lhs: Value, rhs: Value): Value {
  if (rhs.type === 'none') return lhs;
  if (lhs.type === 'none') return rhs;
  const joined = joinLike(lhs, rhs);
  if (joined) return joined;
  return mismatch('cannot join {} with {}', lhs, rhs);
}

/** The cases `join` and `add` share: strings, symbols, content and collections. */
function joinLike(lhs: Value, rhs: Value): Value | null {
  const [lt, rt] = [asText(lhs), asText(rhs)];
  if (lt !== null && rt !== null) {
    if (lt.length + rt.length > maxChars) bailLimit(`Typlet stopped at a string longer than ${maxChars} characters`);
    return strValue(lt + rt);
  }
  if (
    (lhs.type === 'content' && (rhs.type === 'content' || rt !== null)) ||
    (rhs.type === 'content' && lt !== null)
  ) {
    // Joining content again and again can double it each time.
    const joined = joinContent(asContent(lhs)!, asContent(rhs)!);
    if (joined.func === 'sequence' && joined.children.length > maxItems) {
      bailLimit(`Typlet stopped at content of more than ${maxItems} items`);
    }
    return contentValue(joined);
  }
  if (lhs.type === 'array' && rhs.type === 'array') {
    checkItems(1, lhs.v.length + rhs.v.length);
    return arrayValue([...lhs.v, ...rhs.v]);
  }
  if (lhs.type === 'dictionary' && rhs.type === 'dictionary') return dictValue(new Map([...lhs.v, ...rhs.v]));
  if (lhs.type === 'arguments' && rhs.type === 'arguments') {
    const names = new Set(rhs.v.items.flatMap((item) => (item.name === null ? [] : [item.name])));
    return {
      type: 'arguments',
      v: new Args(null, [...lhs.v.items.filter((item) => item.name === null || !names.has(item.name)), ...rhs.v.items]),
    };
  }
  return null;
}

/** Unary `+`. */
export function pos(value: Value): Value {
  switch (value.type) {
    case 'int':
    case 'float':
    case 'length':
    case 'angle':
    case 'ratio':
    case 'relative':
    case 'fraction':
      return value;
    case 'symbol':
    case 'str':
    case 'content':
    case 'array':
    case 'dictionary':
    case 'alignment':
      return mismatch("cannot apply unary '+' to {}", value);
    default:
      return mismatch("cannot apply '+' to {}", value);
  }
}

/** Unary `-`. */
export function neg(value: Value): Value {
  switch (value.type) {
    case 'int':
      return checked(-value.v);
    case 'float':
      return floatValue(-value.v);
    case 'length':
      return length(lengthNeg(value.v));
    case 'angle':
      return angle(-value.v);
    case 'ratio':
      return ratio(-value.v);
    case 'relative':
      return relative(relNeg(value.v));
    case 'fraction':
      return fraction(-value.v);
    default:
      return mismatch("cannot apply '-' to {}", value);
  }
}

/** Binary `+`. */
export function add(lhs: Value, rhs: Value): Value {
  if (rhs.type === 'none') return lhs;
  if (lhs.type === 'none') return rhs;

  switch (`${lhs.type}+${rhs.type}`) {
    case 'int+int':
      return checked((v(lhs) as bigint) + (v(rhs) as bigint));
    case 'int+float':
      return floatValue(Number(v(lhs)) + (v(rhs) as number));
    case 'float+int':
      return floatValue((v(lhs) as number) + Number(v(rhs)));
    case 'float+float':
      return floatValue((v(lhs) as number) + (v(rhs) as number));
    case 'angle+angle':
      return angle((v(lhs) as number) + (v(rhs) as number));
    case 'length+length':
      return length(lengthAdd(v(lhs) as Length, v(rhs) as Length));
    case 'length+ratio':
      return relative(relAdd(relFromRatio(v(rhs) as number), relFromLength(v(lhs) as Length)));
    case 'length+relative':
      return relative(relAdd(v(rhs) as RelLength, relFromLength(v(lhs) as Length)));
    case 'ratio+length':
      return relative(relAdd(relFromRatio(v(lhs) as number), relFromLength(v(rhs) as Length)));
    case 'ratio+ratio':
      return ratio((v(lhs) as number) + (v(rhs) as number));
    case 'ratio+relative':
      return relative(relAdd(v(rhs) as RelLength, relFromRatio(v(lhs) as number)));
    case 'relative+length':
      return relative(relAdd(v(lhs) as RelLength, relFromLength(v(rhs) as Length)));
    case 'relative+ratio':
      return relative(relAdd(v(lhs) as RelLength, relFromRatio(v(rhs) as number)));
    case 'relative+relative':
      return relative(relAdd(v(lhs) as RelLength, v(rhs) as RelLength));
    case 'fraction+fraction':
      return fraction((v(lhs) as number) + (v(rhs) as number));
    case 'color+length':
      return { type: 'stroke', v: { paint: v(lhs), thickness: v(rhs) as Length } };
    case 'length+color':
      return { type: 'stroke', v: { paint: v(rhs), thickness: v(lhs) as Length } };
    case 'alignment+alignment':
      return { type: 'alignment', v: alignmentAdd(v(lhs) as never, v(rhs)) };
  }

  const joined = joinLike(lhs, rhs);
  if (joined) return joined;
  return mismatch('cannot add {} and {}', lhs, rhs);
}

/** Binary `-`. */
export function sub(lhs: Value, rhs: Value): Value {
  switch (`${lhs.type}-${rhs.type}`) {
    case 'int-int':
      return checked((v(lhs) as bigint) - (v(rhs) as bigint));
    case 'int-float':
      return floatValue(Number(v(lhs)) - (v(rhs) as number));
    case 'float-int':
      return floatValue((v(lhs) as number) - Number(v(rhs)));
    case 'float-float':
      return floatValue((v(lhs) as number) - (v(rhs) as number));
    case 'angle-angle':
      return angle((v(lhs) as number) - (v(rhs) as number));
    case 'length-length':
      return length(lengthAdd(v(lhs) as Length, lengthNeg(v(rhs) as Length)));
    case 'length-ratio':
      return relative(relAdd(relFromRatio(-(v(rhs) as number)), relFromLength(v(lhs) as Length)));
    case 'length-relative':
      return relative(relAdd(relNeg(v(rhs) as RelLength), relFromLength(v(lhs) as Length)));
    case 'ratio-length':
      return relative(relAdd(relFromRatio(v(lhs) as number), relFromLength(lengthNeg(v(rhs) as Length))));
    case 'ratio-ratio':
      return ratio((v(lhs) as number) - (v(rhs) as number));
    case 'ratio-relative':
      return relative(relAdd(relNeg(v(rhs) as RelLength), relFromRatio(v(lhs) as number)));
    case 'relative-length':
      return relative(relAdd(v(lhs) as RelLength, relFromLength(lengthNeg(v(rhs) as Length))));
    case 'relative-ratio':
      return relative(relAdd(v(lhs) as RelLength, relFromRatio(-(v(rhs) as number))));
    case 'relative-relative':
      return relative(relSub(v(lhs) as RelLength, v(rhs) as RelLength));
    case 'fraction-fraction':
      return fraction((v(lhs) as number) - (v(rhs) as number));
  }
  return mismatch('cannot subtract {1} from {0}', lhs, rhs);
}

/** Converts an integer to a repeat count, as casting to `usize` does. */
function count(n: bigint): number {
  if (n < 0n) bail('number must be at least zero');
  return Number(n);
}

// The budgets for collections built by repetition (docs/DESIGN.md §6.6). The
// evaluator sets them for each formula; evaluation is synchronous.
let maxItems = 10_000;
let maxChars = 100_000;

/** Sets the collection budgets for the following evaluation. */
export function setCollectionLimits(items: number, chars: number): void {
  maxItems = items;
  maxChars = chars;
}

function repeatStr(text: string, n: number): string {
  if (text.length * n > maxChars) bailLimit(`Typlet stopped at a string longer than ${maxChars} characters`);
  return text.repeat(n);
}

function checkedCount(n: number): number {
  checkItems(1, n);
  return n;
}

function checkItems(len: number, n: number): void {
  if (len * n > maxItems) bailLimit(`Typlet stopped at a collection of more than ${maxItems} items`);
}

/** Binary `*`. */
export function mul(lhs: Value, rhs: Value): Value {
  const num = (x: Value): number => (x.type === 'int' ? Number(x.v) : v(x));
  const isNum = (v: Value) => v.type === 'int' || v.type === 'float';

  switch (`${lhs.type}*${rhs.type}`) {
    case 'int*int':
      return checked((v(lhs) as bigint) * (v(rhs) as bigint));
    case 'int*float':
    case 'float*int':
    case 'float*float':
      return floatValue(num(lhs) * num(rhs));
    case 'length*ratio':
      return length(lengthMul(v(lhs) as Length, v(rhs) as number));
    case 'ratio*length':
      return length(lengthMul(v(rhs) as Length, v(lhs) as number));
    case 'angle*ratio':
    case 'ratio*angle':
      return angle((v(lhs) as number) * (v(rhs) as number));
    case 'ratio*ratio':
      return ratio((v(lhs) as number) * (v(rhs) as number));
    case 'relative*ratio':
      return relative(relMul(v(lhs) as RelLength, v(rhs) as number));
    case 'ratio*relative':
      return relative(relMul(v(rhs) as RelLength, v(lhs) as number));
    case 'fraction*ratio':
    case 'ratio*fraction':
      return fraction((v(lhs) as number) * (v(rhs) as number));
    case 'str*int':
      return strValue(repeatStr(v(lhs) as string, count(v(rhs) as bigint)));
    case 'int*str':
      return strValue(repeatStr(v(rhs) as string, count(v(lhs) as bigint)));
    case 'array*int':
      return arrayValue(repeatArray(v(lhs) as Value[], count(v(rhs) as bigint)));
    case 'int*array':
      return arrayValue(repeatArray(v(rhs) as Value[], count(v(lhs) as bigint)));
    case 'content*int':
      return contentValue(repeatContent(v(lhs) as Content, checkedCount(count(v(rhs) as bigint))));
    case 'int*content':
      return contentValue(repeatContent(v(rhs) as Content, checkedCount(count(v(lhs) as bigint))));
  }

  // A quantity times a number.
  const [q, n] = isNum(rhs) ? [lhs, rhs] : isNum(lhs) ? [rhs, lhs] : [null, null];
  if (q && n) {
    const f = num(n);
    switch (q.type) {
      case 'length':
        return length(lengthMul(q.v, f));
      case 'angle':
        return angle(q.v * f);
      case 'ratio':
        return ratio(q.v * f);
      case 'relative':
        return relative(relMul(q.v, f));
      case 'fraction':
        return fraction(q.v * f);
    }
  }
  return mismatch('cannot multiply {} with {}', lhs, rhs);
}

function repeatArray(items: Value[], n: number): Value[] {
  checkItems(items.length, n);
  const out: Value[] = [];
  for (let i = 0; i < n; i++) out.push(...items);
  return out;
}

/** Whether a value is a numeric zero. */
function isZero(v: Value): boolean {
  switch (v.type) {
    case 'int':
      return v.v === 0n;
    case 'float':
    case 'angle':
    case 'ratio':
    case 'fraction':
      return v.v === 0;
    case 'length':
      return lengthIsZero(v.v);
    case 'relative':
      return relIsZero(v.v);
    default:
      return false;
  }
}

function tryDivLength(a: Length, b: Length): number {
  const result = lengthTryDiv(a, b);
  if (result === null) bail('cannot divide these two lengths');
  return result;
}

/** Binary `/`. */
export function div(lhs: Value, rhs: Value): Value {
  if (isZero(rhs)) bail('cannot divide by zero');
  const num = (x: Value): number => (x.type === 'int' ? Number(x.v) : v(x));
  const isNum = rhs.type === 'int' || rhs.type === 'float';

  switch (`${lhs.type}/${rhs.type}`) {
    case 'int/int':
    case 'int/float':
    case 'float/int':
    case 'float/float':
      return floatValue(num(lhs) / num(rhs));
    case 'length/length':
      return floatValue(tryDivLength(v(lhs) as Length, v(rhs) as Length));
    case 'length/relative':
      if ((v(rhs) as RelLength).rel === 0) {
        return floatValue(tryDivLength(v(lhs) as Length, (v(rhs) as RelLength).abs));
      }
      break;
    case 'angle/angle':
    case 'ratio/ratio':
    case 'fraction/fraction':
      return floatValue((v(lhs) as number) / (v(rhs) as number));
    case 'ratio/relative':
      if (lengthIsZero((v(rhs) as RelLength).abs)) {
        return floatValue((v(lhs) as number) / (v(rhs) as RelLength).rel);
      }
      break;
    case 'relative/length':
      if ((v(lhs) as RelLength).rel === 0) {
        return floatValue(tryDivLength((v(lhs) as RelLength).abs, v(rhs) as Length));
      }
      break;
    case 'relative/ratio':
      if (lengthIsZero((v(lhs) as RelLength).abs)) {
        return floatValue((v(lhs) as RelLength).rel / (v(rhs) as number));
      }
      break;
    case 'relative/relative': {
      const result = relTryDiv(v(lhs) as RelLength, v(rhs) as RelLength);
      if (result === null) bail('cannot divide these two relative lengths');
      return floatValue(result);
    }
  }

  if (isNum) {
    const f = num(rhs);
    switch (lhs.type) {
      case 'length':
        return length(lengthDiv(lhs.v, f));
      case 'angle':
        return angle(lhs.v / f);
      case 'ratio':
        return ratio(lhs.v / f);
      case 'relative':
        return relative(relDiv(lhs.v, f));
      case 'fraction':
        return fraction(lhs.v / f);
    }
  }
  return mismatch('cannot divide {} by {}', lhs, rhs);
}

/** Logical `not`. */
export function not(value: Value): Value {
  if (value.type === 'bool') return boolValue(!value.v);
  return mismatch("cannot apply 'not' to {}", value);
}

/** Logical `and`. */
export function and(lhs: Value, rhs: Value): Value {
  if (lhs.type === 'bool' && rhs.type === 'bool') return boolValue(lhs.v && rhs.v);
  return mismatch("cannot apply 'and' to {} and {}", lhs, rhs);
}

/** Logical `or`. */
export function or(lhs: Value, rhs: Value): Value {
  if (lhs.type === 'bool' && rhs.type === 'bool') return boolValue(lhs.v || rhs.v);
  return mismatch("cannot apply 'or' to {} and {}", lhs, rhs);
}

export const eq = (lhs: Value, rhs: Value): Value => boolValue(equal(lhs, rhs));
export const neq = (lhs: Value, rhs: Value): Value => boolValue(!equal(lhs, rhs));
export const lt = (lhs: Value, rhs: Value): Value => boolValue(compare(lhs, rhs) < 0);
export const leq = (lhs: Value, rhs: Value): Value => boolValue(compare(lhs, rhs) <= 0);
export const gt = (lhs: Value, rhs: Value): Value => boolValue(compare(lhs, rhs) > 0);
export const geq = (lhs: Value, rhs: Value): Value => boolValue(compare(lhs, rhs) >= 0);

/** Compares two values: negative, zero or positive. */
export function compare(lhs: Value, rhs: Value): number {
  const cmp = (a: number | bigint | string | boolean, b: typeof a) => (a < b ? -1 : a > b ? 1 : 0);
  const tryCmp = (a: number, b: number, ra: () => string, rb: () => string) => {
    if (Number.isNaN(a) || Number.isNaN(b)) bail(`cannot compare ${ra()} with ${rb()}`);
    return cmp(a, b);
  };
  const reprF = (x: number) => () => formatFloat(x, null, true, '');

  switch (`${lhs.type}<${rhs.type}`) {
    case 'bool<bool':
    case 'int<int':
    case 'str<str':
      return cmp(v(lhs), v(rhs));
    case 'float<float':
      return tryCmp(v(lhs) as number, v(rhs) as number, reprF(v(lhs) as number), reprF(v(rhs) as number));
    case 'int<float':
      return tryCmp(Number(v(lhs)), v(rhs) as number, reprF(Number(v(lhs))), reprF(v(rhs) as number));
    case 'float<int':
      return tryCmp(v(lhs) as number, Number(v(rhs)), reprF(v(lhs) as number), reprF(Number(v(rhs))));
    case 'angle<angle':
    case 'ratio<ratio':
    case 'fraction<fraction':
      return cmp(v(lhs) as number, v(rhs) as number);
    case 'length<length': {
      const result = lengthCmp(v(lhs) as Length, v(rhs) as Length);
      if (result === null) bail(`cannot compare ${reprLength(v(lhs) as Length)} with ${reprLength(v(rhs) as Length)}`);
      return result;
    }
    case 'relative<relative': {
      const result = relCmp(v(lhs) as RelLength, v(rhs) as RelLength);
      if (result === null) bail(`cannot compare ${reprRel(v(lhs) as RelLength)} with ${reprRel(v(rhs) as RelLength)}`);
      return result;
    }
    case 'length<relative':
      if ((v(rhs) as RelLength).rel === 0) return compare(lhs, { type: 'length', v: (v(rhs) as RelLength).abs });
      break;
    case 'ratio<relative':
      if (lengthIsZero((v(rhs) as RelLength).abs)) return cmp(v(lhs) as number, (v(rhs) as RelLength).rel);
      break;
    case 'relative<length':
      if ((v(lhs) as RelLength).rel === 0) return compare({ type: 'length', v: (v(lhs) as RelLength).abs }, rhs);
      break;
    case 'relative<ratio':
      if (lengthIsZero((v(lhs) as RelLength).abs)) return cmp((v(lhs) as RelLength).rel, v(rhs) as number);
      break;
    case 'array<array': {
      const [a, b] = [v(lhs) as Value[], v(rhs) as Value[]];
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const result = compare(a[i]!, b[i]!);
        if (result !== 0) return result;
      }
      return cmp(a.length, b.length);
    }
  }
  return mismatch('cannot compare {} and {}', lhs, rhs);
}

/** Whether `lhs` is in `rhs`, or `null` if the types don't support containment. */
export function contains(lhs: Value, rhs: Value): boolean | null {
  if (lhs.type === 'str' && rhs.type === 'str') return rhs.v.includes(lhs.v);
  if (lhs.type === 'str' && rhs.type === 'dictionary') return rhs.v.has(lhs.v);
  if (lhs.type === 'str' && rhs.type === 'module') return rhs.v.scope.has(lhs.v);
  if (rhs.type === 'array') return rhs.v.some((item) => equal(item, lhs));
  return null;
}

/** Binary `in`. */
export function inOp(lhs: Value, rhs: Value): Value {
  const result = contains(lhs, rhs);
  if (result === null) return mismatch("cannot apply 'in' to {} and {}", lhs, rhs);
  return boolValue(result);
}

/** Binary `not in`. */
export function notIn(lhs: Value, rhs: Value): Value {
  const result = contains(lhs, rhs);
  if (result === null) return mismatch("cannot apply 'not in' to {} and {}", lhs, rhs);
  return boolValue(!result);
}

