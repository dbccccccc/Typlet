// Ported from Typst 0.15.1: crates/typst-eval/src/call.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import {
  type Arg as AstArg,
  type LinkedNode,
  argItems,
  firstExpr,
  lastExpr,
  lastOfKind,
  mathArgItems,
  mathArgsContentItems,
} from '../syntax/ast.js';
import { SyntaxKind } from '../syntax/kind.js';
import { type Arg, Args } from './args.js';
import { accessField, evalDisplay, evalExpr } from './code.js';
import { type Content, join, spaceElem, spanned, symbolElem } from './content.js';
import { HintedError, type SourceDiagnostic, type Span, SourceError, at, bailAt, error, trace, unsupported } from './diag.js';
import { type Func, callFunc, countCall } from './func.js';
import { funcCast } from './cast.js';
import { checkCollectionSize } from './ops.js';
import { hintIfShadowedStd } from './rules.js';
import { type Value, arrayValue, contentValue, display, typeOf } from './value.js';
import type { Vm } from './vm.js';

const K = SyntaxKind;

/** What a callee evaluated to, like Typst's `FieldCallee`. */
type Callee = { kind: 'func'; func: Func } | { kind: 'nonFunc'; value: Value; error: unknown };

function toCallee(value: Value): Callee {
  try {
    return { kind: 'func', func: funcCast.cast(value) };
  } catch (error) {
    return { kind: 'nonFunc', value, error };
  }
}

/** Counts a call against the budget. Typst's call depth only grows in user-defined functions. */
function checkCallDepth(vm: Vm, span: Span): void {
  countCall(vm.engine, span);
}

/** A function call in code: `f(x)`. */
export function evalFuncCall(vm: Vm, node: LinkedNode): Value {
  const span = node.span;
  const callee = firstExpr(node);
  checkCallDepth(vm, span);

  if (callee.kind === K.FieldAccess) {
    const targetExpr = firstExpr(callee);
    const field = lastOfKind(callee, K.Ident)!;
    const target = evalExpr(vm, targetExpr);
    const result = evalFieldCallee(vm, callee, field.text, field.span, target, false);
    if (result.kind === 'nonFunc') {
      return at(callee.span, () => {
        throw result.error;
      });
    }
    const args = evalArgs(vm, lastOfKind(node, K.Args)!).spanned(span);
    return callFuncAt(vm, result.func, args, span);
  }

  // Function call order: the callee before the arguments.
  const calleeValue = evalExpr(vm, callee);
  const func =
    calleeValue.type === 'function'
      ? calleeValue.v
      : at(callee.span, () => {
          try {
            return funcCast.cast(calleeValue);
          } catch (e) {
            throw e instanceof HintedError ? hintIfShadowedStd(vm, callee, e) : e;
          }
        });
  const args = evalArgs(vm, (node.memo ??= lastOfKind(node, K.Args)!) as LinkedNode).spanned(span);
  return callFuncAt(vm, func, args, span);
}

/** A function call in math: `f(x)`. Calls on non-functions display the arguments in parentheses. */
export function evalMathCall(vm: Vm, node: LinkedNode): Value {
  const span = node.span;
  const callee = firstExpr(node);
  checkCallDepth(vm, span);

  let result: Callee;
  if (callee.kind === K.MathIdent) {
    result = toCallee(evalExpr(vm, callee));
  } else {
    const targetExpr = firstExpr(callee);
    const field = lastExpr(callee);
    const target = evalExpr(vm, targetExpr);
    result = evalFieldCallee(vm, callee, field.text, field.span, target, true);
  }

  const args = lastOfKind(node, K.MathArgs)!;
  if (result.kind === 'func') {
    return callFuncAt(vm, result.func, evalMathArgs(vm, args).spanned(span), span);
  }
  const parens = unparseMathArgs(vm, args, callee);
  return contentValue(join(spanned(display(result.value), callee.span), parens));
}

/** Calls a function, recording the call in the trace of errors from inside it. */
function callFuncAt(vm: Vm, func: Func, args: Args, span: Span): Value {
  try {
    return callFunc(func, vm.engine, args, true);
  } catch (e) {
    // The trace point is only needed for errors.
    const point = func.name === null ? 'while calling function' : `while calling \`${func.name}\``;
    return trace(point, span, () => {
      throw e;
    });
  }
}

/**
 * Evaluates the callee of a field call, like Typst's `eval_field_callee`.
 * Typlet supports fields of symbols, functions and modules; methods of other
 * types are not supported yet.
 */
function evalFieldCallee(
  vm: Vm,
  access: LinkedNode,
  field: string,
  fieldSpan: Span,
  target: Value,
  inMath: boolean,
): Callee {
  if (target.type === 'symbol' || target.type === 'function' || target.type === 'type' || target.type === 'module') {
    return toCallee(accessField(vm, target, field, fieldSpan));
  }
  if (target.type === 'dictionary' && target.v.has(field)) {
    const value = target.v.get(field)!;
    const hints: string[] = [];
    if (funcCast.castable(value)) {
      hints.push(
        `to call the stored function, ${inMath ? 'use code mode and ' : ''}wrap the field access in parentheses: \`${inMath ? '#' : ''}(${access.fullText()})(..)\``,
      );
    } else if (inMath) {
      hints.push('try adding a space before the parentheses');
    } else {
      hints.push(`to access the \`${field}\` key, remove the function arguments: \`${access.fullText()}\``);
    }
    hints.push('dictionary keys cannot be used with method syntax as keys could conflict with built-in method names');
    bailAt(access.span, 'cannot directly call dictionary keys as functions', ...hints);
  }
  return unsupported(access.span, `methods of ${typeOf(target)} values`);
}

/** The value and span of an argument expression. */
function argValue(vm: Vm, expr: LinkedNode): { value: Value; span: Span } {
  return { value: evalExpr(vm, expr), span: expr.span };
}

/** Adds a spread argument's items. */
function spreadInto(vm: Vm, spread: LinkedNode, span: Span, pos: Arg[], named: Arg[] | null, rowStart = 0): boolean {
  const value = evalExpr(vm, firstExpr(spread));
  const size = value.type === 'array' ? value.v.length : value.type === 'dictionary' ? value.v.size : value.type === 'arguments' ? value.v.items.length : value.type === 'none' ? 0 : null;
  if (size === null) bailAt(spread.span, `cannot spread ${typeOf(value)}`);
  if (size === 0) return false;
  // Math keeps named and positional staging lists separate until rows are grouped.
  let positional = value.type === 'dictionary' ? 0 : size;
  if (named && value.type === 'arguments') positional = value.v.items.reduce((count, arg) => count + Number(arg.name === null), 0);
  at(span, () => {
    checkCollectionSize(pos.length - rowStart + (named ? positional : size));
    if (named) checkCollectionSize(named.length + size - positional);
  });
  switch (value.type) {
    case 'array':
      for (const v of value.v) pos.push({ span, name: null, value: v, valueSpan: span });
      break;
    case 'dictionary':
      for (const [name, v] of value.v) (named ?? pos).push({ span, name, value: v, valueSpan: span });
      break;
    case 'arguments':
      for (const arg of value.v.items) (arg.name === null || !named ? pos : named).push(arg);
      break;
  }
  return true;
}

/** The named argument's name and value expression. */
function namedParts(node: LinkedNode): [string, LinkedNode] {
  const name = node.children().find((child) => child.kind === K.Ident)!.text;
  return [name, lastExpr(node)];
}

/** Evaluates arguments in code, like `Eval for ast::Args`. */
export function evalArgs(vm: Vm, args: LinkedNode): Args {
  const items: Arg[] = [];
  let computed = false;
  for (const arg of argItems(args)) {
    const span = arg.node.span;
    if (arg.kind === 'pos') {
      const { value, span: valueSpan } = argValue(vm, arg.node);
      if (computed) at(span, () => checkCollectionSize(items.length + 1));
      items.push({ span, name: null, value, valueSpan });
    } else if (arg.kind === 'named') {
      const [name, expr] = namedParts(arg.node);
      const { value, span: valueSpan } = argValue(vm, expr);
      if (computed) at(span, () => checkCollectionSize(items.length + 1));
      items.push({ span, name, value, valueSpan });
    } else {
      computed = spreadInto(vm, arg.node, span, items, null) || computed;
    }
  }
  // The call site's span is set by the caller.
  return new Args(null, items);
}

/**
 * Evaluates arguments in math, like `Eval for ast::MathArgs`. Named
 * arguments come first, and semicolons group the positional arguments
 * before them into arrays: `mat(a, b; c, d)`.
 */
function evalMathArgs(vm: Vm, args: LinkedNode): Args {
  const named: Arg[] = [];
  let pos: Arg[] = [];
  let computed = false;
  let twoDimStart: number | null = null;
  const span = args.span;
  const drainIntoArray = (start: number) => {
    at(span, () => checkCollectionSize(pos.length - start));
    const array = pos.slice(start).map((arg) => arg.value);
    pos = pos.slice(0, start);
    pos.push({ span, name: null, value: arrayValue(array), valueSpan: span });
  };

  for (const { arg, endsInSemicolon } of mathArgItems(args)) {
    const argSpan = arg.node.span;
    if (arg.kind === 'pos') {
      const { value, span: valueSpan } = argValue(vm, arg.node);
      if (computed) at(argSpan, () => checkCollectionSize(pos.length - (twoDimStart ?? 0) + 1));
      pos.push({ span: argSpan, name: null, value, valueSpan });
    } else if (arg.kind === 'named') {
      const [name, expr] = namedParts(arg.node);
      const { value, span: valueSpan } = argValue(vm, expr);
      if (computed) at(argSpan, () => checkCollectionSize(named.length + 1));
      named.push({ span: argSpan, name, value, valueSpan });
    } else {
      computed = spreadInto(vm, arg.node, argSpan, pos, named, twoDimStart ?? 0) || computed;
    }
    if (endsInSemicolon) {
      drainIntoArray(twoDimStart ?? 0);
      twoDimStart = pos.length;
    }
  }
  if (twoDimStart !== null && twoDimStart !== pos.length) drainIntoArray(twoDimStart);
  if (computed) at(span, () => checkCollectionSize(named.length + pos.length));
  return new Args(null, [...named, ...pos]);
}

/** The arguments of a call on a non-function, as content in parentheses. */
function unparseMathArgs(vm: Vm, args: LinkedNode, callee: LinkedNode): Content {
  const body: Content[] = [];
  const errors: SourceDiagnostic[] = [];
  for (const item of mathArgsContentItems(args)) {
    if (item.kind === 'space') {
      body.push(spanned(spaceElem(), item.node.span));
    } else if (item.kind === 'punct') {
      body.push(spanned(symbolElem(item.char), item.node.span));
    } else {
      const arg: AstArg = item.arg;
      const name = callee.fullText();
      if (arg.kind === 'pos') {
        // Display, rather than cast to content, so `sin(#1)` works like `#1`.
        body.push(evalDisplay(vm, arg.node));
      } else if (arg.kind === 'named') {
        const fixed = arg.node.fullText().replace(':', '\\:');
        errors.push(
          error(
            arg.node.span,
            'named-argument syntax can only be used with functions',
            `\`${name}\` is not a function`,
            `to render the colon as text, escape it: \`${fixed}\``,
          ),
        );
      } else {
        const fixed = arg.node.fullText().replace('..', '.. ');
        errors.push(
          error(
            arg.node.span,
            'spread-argument syntax can only be used with functions',
            `\`${name}\` is not a function`,
            `to render the dots as text, add a space: \`${fixed}\``,
          ),
        );
      }
    }
  }
  if (errors.length > 0) throw new SourceError(errors);
  // Always a sequence, even with one item, as Typst builds it.
  return { func: 'lr', body: { func: 'sequence', children: body, span: null }, span: args.span };
}

