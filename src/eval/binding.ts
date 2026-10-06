// Ported from Typst 0.15.1: crates/typst-eval/src/binding.rs, crates/typst-syntax/src/ast.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { type LinkedNode, isExpr } from '../syntax/ast.js';
import { SyntaxKind } from '../syntax/kind.js';
import { evalExpr } from './code.js';
import { type Span, SourceError, at, bail, bailAt, error } from './diag.js';
import { reprStr } from './repr.js';
import { type Value, NONE, arrayValue, dictValue, typeOf } from './value.js';
import type { Vm } from './vm.js';

const K = SyntaxKind;

/** Whether a node is a pattern, like `Pattern::from_untyped`. */
export function isPattern(node: LinkedNode): boolean {
  return node.kind === K.Underscore || node.kind === K.Destructuring || isExpr(node);
}

/** The identifiers a pattern binds, like `Pattern::bindings`. */
export function patternBindings(pattern: LinkedNode): LinkedNode[] {
  switch (pattern.kind) {
    case K.Ident:
      return [pattern];
    case K.Parenthesized:
      return patternBindings(innerPattern(pattern));
    case K.Destructuring:
      return pattern.children().flatMap((item) => {
        if (item.kind === K.Named) return patternBindings(lastPattern(item));
        if (item.kind === K.Spread) {
          const sink = sinkIdent(item);
          return sink ? [sink] : [];
        }
        return isPattern(item) ? patternBindings(item) : [];
      });
    default:
      return [];
  }
}

/** The pattern inside parentheses. */
function innerPattern(node: LinkedNode): LinkedNode {
  return node.children().find(isPattern)!;
}

/** The last pattern child, like `Named::pattern`. */
function lastPattern(node: LinkedNode): LinkedNode {
  const children = node.children();
  for (let i = children.length - 1; i >= 0; i--) if (isPattern(children[i]!)) return children[i]!;
  return undefined!;
}

/** The identifier of a spread's sink, like `Spread::sink_ident`. */
export function sinkIdent(spread: LinkedNode): LinkedNode | null {
  const first = spread.children().find(isExpr);
  return first?.kind === K.Ident ? first : null;
}

/** The parts of a `let` binding: its pattern or closure name, and its initializer. */
export function letParts(node: LinkedNode): { closure: LinkedNode | null; pattern: LinkedNode | null; init: LinkedNode | null } {
  const first = node.children().find(isPattern)!;
  if (first.kind === K.Closure) {
    // `let f(x) = ..`: the closure is the initializer.
    const name = first.children()[0];
    return { closure: name?.kind === K.Ident ? name : null, pattern: null, init: first };
  }
  let init: LinkedNode | null;
  if (isExpr(first)) {
    // A normal or parenthesized pattern: the second expression.
    init = node.children().filter(isExpr)[1] ?? null;
  } else {
    init = node.children().find(isExpr) ?? null;
  }
  return { closure: null, pattern: first, init };
}

/** A `let` binding, like `Eval for ast::LetBinding`. */
export function evalLetBinding(vm: Vm, node: LinkedNode): Value {
  const { closure, pattern, init } = letParts(node);
  const value = init ? evalExpr(vm, init) : NONE;
  if (vm.flow) return NONE;
  if (pattern) destructure(vm, pattern, value);
  else if (closure) vm.define(closure.text, closure.span, value);
  return NONE;
}

/** Destructures a value into a pattern, defining its variables, like `destructure`. */
export function destructure(vm: Vm, pattern: LinkedNode, value: Value): void {
  switch (pattern.kind) {
    case K.Underscore:
      return;
    case K.Parenthesized:
      return destructure(vm, innerPattern(pattern), value);
    case K.Destructuring:
      if (value.type === 'array') return destructureArray(vm, pattern, value.v);
      if (value.type === 'dictionary') return destructureDict(vm, pattern, value.v);
      return bailAt(pattern.span, `cannot destructure ${typeOf(value)}`);
    case K.Ident:
      return vm.define(pattern.text, pattern.span, value);
    default:
      return bailAt(pattern.span, 'cannot assign to this expression');
  }
}

/** The items of a destructuring pattern. */
function items(destruct: LinkedNode): LinkedNode[] {
  return destruct.children().filter((item) => item.kind === K.Named || item.kind === K.Spread || isPattern(item));
}

function destructureArray(vm: Vm, destruct: LinkedNode, array: readonly Value[]): void {
  const len = array.length;
  const list = items(destruct);
  let i = 0;
  for (const p of list) {
    if (p.kind === K.Named) bailAt(p.span, 'cannot destructure named pattern from an array');
    if (p.kind === K.Spread) {
      const sinkSize = 1 + len - list.length;
      if (sinkSize < 0 || i + sinkSize > len) throw new SourceError([wrongNumberOfElements(destruct, list, len)]);
      const sink = p.children().find(isExpr);
      if (sink) destructure(vm, sink, arrayValue(array.slice(i, i + sinkSize)));
      i += sinkSize;
      continue;
    }
    if (i >= len) throw new SourceError([wrongNumberOfElements(destruct, list, len)]);
    destructure(vm, p, array[i]!);
    i++;
  }
  if (i < len) throw new SourceError([wrongNumberOfElements(destruct, list, len)]);
}

function destructureDict(vm: Vm, destruct: LinkedNode, dict: ReadonlyMap<string, Value>): void {
  let sink: LinkedNode | null = null;
  const used = new Set<string>();
  const get = (key: string, span: Span) =>
    at(span, () => dict.get(key) ?? bail(`dictionary does not contain key ${reprStr(key)}`));
  for (const p of items(destruct)) {
    if (p.kind === K.Ident) {
      destructure(vm, p, get(p.text, p.span));
      used.add(p.text);
    } else if (p.kind === K.Named) {
      const name = p.children().find((c) => c.kind === K.Ident)!;
      destructure(vm, lastPattern(p), get(name.text, name.span));
      used.add(name.text);
    } else if (p.kind === K.Spread) {
      sink = p.children().find(isExpr) ?? null;
    } else {
      bailAt(p.span, 'cannot destructure unnamed pattern from dictionary');
    }
  }
  if (sink) destructure(vm, sink, dictValue(new Map([...dict].filter(([key]) => !used.has(key)))));
}

/** The error for an array with the wrong number of elements for a pattern. */
function wrongNumberOfElements(destruct: LinkedNode, list: LinkedNode[], len: number) {
  let count = 0;
  let spread = false;
  for (const p of list) {
    if (p.kind === K.Spread) spread = true;
    else if (p.kind !== K.Named) count++;
  }
  const quantifier = len > count ? 'too many' : 'not enough';
  const expected = spread
    ? count === 1
      ? 'at least 1 element'
      : `at least ${count} elements`
    : count === 0
      ? 'an empty array'
      : count === 1
        ? 'a single element'
        : `${count} elements`;
  return error(
    destruct.span,
    `${quantifier} elements to destructure`,
    `the provided array has a length of ${len}, but the pattern expects ${expected}`,
  );
}
