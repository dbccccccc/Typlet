// Ported from Typst 0.15.1: crates/typst-library/src/model/numbering.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// Numbering patterns such as "(1)" or "i.", for equation numbers. The
// numeral systems are in ./numeral.ts.

import { Args } from './args.js';
import { type Cast, castError, typeInfo, union } from './cast.js';
import { HintedError, type Span, bail, warning } from './diag.js';
import { type Named, SYSTEMS, represent } from './numeral.js';
import type { Engine, Func } from './func.js';
import { type Value, intValue, strValue } from './value.js';

/** A numbering: a pattern such as "(1)", or a function of the numbers. */
export type Numbering =
  | { readonly kind: 'pattern'; readonly source: string; readonly pieces: readonly (readonly [string, Named])[]; readonly suffix: string }
  | { readonly kind: 'func'; readonly func: Func };

/** Parses a numbering pattern, like `NumberingPattern::from_str`. */
function parsePattern(source: string): Numbering {
  const pieces: [string, Named][] = [];
  let prefix = '';
  for (const c of source) {
    const named = SYSTEMS.get(c);
    if (named) {
      pieces.push([prefix, named]);
      prefix = '';
    } else {
      prefix += c;
    }
  }
  if (pieces.length === 0) bail('invalid numbering pattern');
  return { kind: 'pattern', source, pieces, suffix: prefix };
}

/** A numbering: a pattern string or a function. */
export const numberingCast: Cast<Numbering> = {
  info: union(typeInfo('str'), typeInfo('function')),
  castable: (v) => v.type === 'str' || v.type === 'function',
  cast(v): Numbering {
    if (v.type === 'str') return parsePattern(v.v);
    if (v.type === 'function') return { kind: 'func', func: v.v };
    throw castError(this.info, v);
  },
};

/** A numbering as a value: its pattern or its function. */
export const numberingValue = (numbering: Numbering): Value =>
  numbering.kind === 'pattern' ? strValue(numbering.source) : { type: 'function', v: numbering.func };

/**
 * Applies a numbering to numbers, like `Numbering::apply`. A number a
 * pattern's numeral system can't write falls back to Arabic numerals with
 * Typst's warning.
 */
export function applyNumbering(
  numbering: Numbering,
  numbers: readonly number[],
  engine: Engine,
  span: Span,
  call: (func: Func, args: Args) => Value,
): Value {
  if (numbering.kind === 'func') {
    return call(numbering.func, numbersArgs(numbers, span));
  }
  const write = (named: Named, n: number): string => {
    try {
      return represent(named, n);
    } catch (e) {
      if (!(e instanceof HintedError)) throw e;
      engine.warnings.push(warning(span, e.message, 'this will become a hard error in the future'));
      return String(n);
    }
  };
  let out = '';
  const { pieces, suffix } = numbering;
  numbers.forEach((n, i) => {
    if (i < pieces.length) {
      out += pieces[i]![0] + write(pieces[i]![1], n);
    } else {
      const [prefix, named] = pieces.at(-1)!;
      out += (prefix === '' ? suffix : prefix) + write(named, n);
    }
  });
  return strValue(out + suffix);
}

/** The arguments of a numbering function: the numbers. */
function numbersArgs(numbers: readonly number[], span: Span): Args {
  return new Args(
    span,
    numbers.map((n) => ({ span, name: null, value: intValue(BigInt(n)), valueSpan: span })),
  );
}
