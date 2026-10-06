// Ported from Typst 0.15.1: crates/typst-eval/src/flow.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { type LinkedNode, isExpr } from '../syntax/ast.js';
import { boolCast } from './cast.js';
import { evalExpr } from './code.js';
import { at } from './diag.js';
import { type Value, NONE } from './value.js';
import type { Vm } from './vm.js';

/** `if`/`else`, like `Eval for ast::Conditional`. */
export function evalConditional(vm: Vm, node: LinkedNode): Value {
  const [condition, ifBody, elseBody] = (node.memo ??= node.children().filter(isExpr)) as LinkedNode[];
  const value = evalExpr(vm, condition!);
  let output: Value = NONE;
  const flag = value.type === 'bool' ? value.v : at(condition!.span, () => boolCast.cast(value));
  if (flag) output = evalExpr(vm, ifBody!);
  else if (elseBody) output = evalExpr(vm, elseBody);
  // A return inside is conditional.
  if (vm.flow?.kind === 'return') vm.flow.conditional = true;
  return output;
}

/** `return`, with an optional value, like `Eval for ast::FuncReturn`. */
export function evalReturn(vm: Vm, node: LinkedNode): Value {
  const body = node.children().filter(isExpr).at(-1);
  const value = body ? evalExpr(vm, body) : null;
  vm.flow ??= { kind: 'return', span: node.span, value, conditional: false };
  return NONE;
}

/** `break` or `continue`, which are only allowed in loops. */
export function evalLoopControl(vm: Vm, node: LinkedNode, kind: 'break' | 'continue'): Value {
  vm.flow ??= { kind, span: node.span };
  return NONE;
}
