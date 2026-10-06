// Ported from Typst 0.15.1: crates/typst-library/src/foundations/func.rs, crates/typst-library/src/engine.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import type { Args } from './args.js';
import type { Cast } from './cast.js';
import type { Content, ElemName } from './content.js';
import { type SourceDiagnostic, type Span, SourceError, error, limit } from './diag.js';
import type { StyleChain, Styles } from './styles.js';
import { type Value, contentValue } from './value.js';

/** Resource budgets for one evaluation (docs/DESIGN.md §6.6). */
export interface Limits {
  /** The deepest nesting of function calls. */
  readonly callDepth: number;
  /** Function calls and loop iterations per formula. */
  readonly calls: number;
  /** Items in an array or dictionary. */
  readonly collectionSize: number;
  /** Characters in a string. */
  readonly stringLength: number;
}

export const DEFAULT_LIMITS: Limits = { callDepth: 80, calls: 30_000, collectionSize: 10_000, stringLength: 100_000 };

/** State shared by everything that runs during one evaluation, like Typst's `Engine`. */
export interface Engine {
  /** Warnings, in the order they were emitted. */
  readonly warnings: SourceDiagnostic[];
  readonly limits: Limits;
  /** Function calls and loop iterations so far. */
  calls: number;
  /** User-defined functions being called, like the length of Typst's `Route`. */
  depth: number;
}

export function newEngine(limits: Limits = DEFAULT_LIMITS): Engine {
  return { warnings: [], limits, calls: 0, depth: 0 };
}

/**
 * Checks a call against the budgets, like Typst's `check_call_depth`: Typst
 * allows 80 nested calls of user-defined functions.
 */
export function countCall(engine: Engine, span: Span): void {
  if (engine.depth >= engine.limits.callDepth) {
    // Typst's own limit, with its message.
    throw new SourceError([error(span, 'maximum function call depth exceeded')]);
  }
  if (++engine.calls > engine.limits.calls) {
    limit(span, `Typlet stopped after ${engine.limits.calls} function calls and loop iterations`);
  }
}

/** A parameter of a built-in function, as Typst's `NativeParamInfo` describes it. */
export interface ParamInfo {
  readonly name: string;
  readonly cast: Cast<unknown>;
  readonly positional: boolean;
  readonly named: boolean;
  readonly variadic: boolean;
  readonly required: boolean;
  readonly settable: boolean;
  readonly default?: () => Value;
}

/** A function value. */
export interface Func {
  /** The name `repr` shows; `null` for anonymous functions, shown as `(..) => ..`. */
  readonly name: string | null;
  /** For element functions, the element they construct. */
  readonly elem?: ElemName;
  readonly params: readonly ParamInfo[];
  /** Calls the function with the arguments, which it consumes. */
  readonly call: (engine: Engine, args: Args, styles?: StyleChain) => Value;
  /**
   * For element functions, the styles of a set rule with the arguments, which
   * it consumes, like `Element::set`.
   */
  readonly set?: (engine: Engine, args: Args) => Styles;
}

/** Calls a function and checks that it used all arguments, like `Func::call`. */
export function callFunc(func: Func, engine: Engine, args: Args): Value {
  const value = func.call(engine, args);
  args.finish();
  return value;
}

/** Defines a built-in function returning content. */
export function contentFunc(
  name: string | null,
  params: readonly ParamInfo[],
  f: (args: Args, engine: Engine) => Content,
  elem?: ElemName,
): Func {
  return { name, elem, params, call: (engine, args) => contentValue(f(args, engine)) };
}

/** Shorthand for a parameter description. */
export function param(
  name: string,
  cast: Cast<unknown>,
  kind: 'required' | 'positional' | 'named' | 'variadic',
  options: { settable?: boolean; default?: () => Value } = {},
): ParamInfo {
  return {
    name,
    cast,
    positional: kind !== 'named',
    named: kind === 'named',
    variadic: kind === 'variadic',
    required: kind === 'required' || kind === 'variadic',
    settable: options.settable ?? false,
    ...(options.default ? { default: options.default } : {}),
  };
}
