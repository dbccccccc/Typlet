// Ported from Typst 0.15.1: crates/typst-library/src/foundations/func.rs, crates/typst-library/src/engine.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import type { Args } from './args.js';
import { ValueBudget, withValueBudget } from './value-budget.js';
import type { Cast } from './cast.js';
import type { Content, ElemName } from './content.js';
import type { LinkedNode } from '../syntax/ast.js';
import { type SourceDiagnostic, type Span, SourceError, at, error, limit } from './diag.js';
import type { Scope } from './scope.js';
import type { StyleChain, Styles } from './styles.js';
import { type Value, contentValue } from './value.js';

/** Resource budgets for one evaluation (docs/DESIGN.md §6.6). */
export interface Limits {
  /** The deepest nesting of function calls. */
  readonly callDepth: number;
  /** Function calls per formula. */
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
  readonly values: ValueBudget;
  /** Function calls so far. */
  calls: number;
  /** User-defined functions being called, like the length of Typst's `Route`. */
  depth: number;
  /** Expressions currently being evaluated, including closures and callbacks. */
  evalDepth: number;
  /** Set/show rules whose remaining block is being evaluated. */
  ruleDepth: number;
}

export function newEngine(limits: Limits = DEFAULT_LIMITS): Engine {
  return { warnings: [], limits, values: new ValueBudget(limits.stringLength), calls: 0, depth: 0, evalDepth: 0, ruleDepth: 0 };
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
    limit(span, `Typlet stopped after ${engine.limits.calls} function calls`);
  }
}

/** Bounds the combined active stack even when individual syntax and call depths fit. */
export function checkEvalDepth(engine: Engine, span: Span): void {
  if (engine.evalDepth + engine.ruleDepth >= 512) limit(span, 'Typlet stopped at an evaluation depth of more than 512');
}

/** Bounds rule-tail recursion, which is independent of syntax-tree depth. */
export function withRuleDepth<T>(engine: Engine, span: Span, body: () => T): T {
  if (engine.ruleDepth >= 256) limit(span, 'Typlet stopped at a rule depth of more than 256');
  checkEvalDepth(engine, span);
  engine.ruleDepth++;
  try {
    return body();
  } finally {
    engine.ruleDepth--;
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
  /** Where a closure was defined, which errors in the functions it is passed to point at. */
  readonly span?: Span;
  /**
   * For closures, what Typst compares them by: the closure expression, the
   * defaults of its named parameters and its captured variables, like `Closure`.
   */
  readonly closure?: { readonly node: LinkedNode; readonly defaults: readonly Value[]; readonly captured: Scope };
  /** Calls the function with the arguments, which it consumes. */
  readonly call: (engine: Engine, args: Args, styles?: StyleChain) => Value;
  /**
   * For element functions, the styles of a set rule with the arguments, which
   * it consumes, like `Element::set`.
   */
  readonly set?: (engine: Engine, args: Args) => Styles;
}

/**
 * Calls a function and checks that it used all arguments, like `Func::call`.
 * An error without a location gets the call's, as Typst's native functions
 * report theirs at `args.span`. AST calls reserve their budget before
 * evaluating arguments; callbacks and other internal calls count here.
 */
export function callFunc(func: Func, engine: Engine, args: Args, counted = false): Value {
  return withValueBudget(engine.values, () => {
    if (!counted) countCall(engine, args.span ?? func.span ?? null);
    const value = at(args.span, () => func.call(engine, args));
    args.finish();
    return value;
  });
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
