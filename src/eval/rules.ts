// Ported from Typst 0.15.1: crates/typst-eval/src/rules.rs, crates/typst-eval/src/vm.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { type LinkedNode, firstExpr, isExpr, lastOfKind } from '../syntax/ast.js';
import { SyntaxKind } from '../syntax/kind.js';
import { evalArgs } from './call.js';
import { boolCast } from './cast.js';
import { evalExpr } from './code.js';
import { HintedError, at, bail } from './diag.js';
import type { Func } from './func.js';
import { funcCast } from './library.js';
import type { Styles } from './styles.js';
import type { Vm } from './vm.js';

const K = SyntaxKind;

/** A set rule's styles, like `Eval for ast::SetRule`. */
export function evalSetRule(vm: Vm, node: LinkedNode): Styles {
  const children = node.children();
  const ifIndex = children.findIndex((child) => child.kind === K.If);
  if (ifIndex >= 0) {
    const condition = children.slice(ifIndex).find(isExpr)!;
    const value = evalExpr(vm, condition);
    if (!at(condition.span, () => boolCast.cast(value))) return [];
  }

  const targetExpr = firstExpr(node);
  const target = evalExpr(vm, targetExpr);
  const func = at(targetExpr.span, (): Func => {
    let func: Func;
    try {
      func = funcCast.cast(target);
    } catch (e) {
      throw e instanceof HintedError ? hintIfShadowedStd(vm, targetExpr, e) : e;
    }
    return func.set ? func : bail('only element functions can be used in set rules');
  });
  const args = evalArgs(vm, lastOfKind(node, K.Args)!).spanned(node.span);
  const styles = func.set!(vm.engine, args);
  args.finish();
  return styles;
}

/** Adds a hint when a variable shadows a function of the standard library. */
export function hintIfShadowedStd(vm: Vm, callee: LinkedNode, error: HintedError): HintedError {
  if (callee.kind === K.Ident && vm.scopes.local(callee.text) && vm.library.global.scope.has(callee.text)) {
    error.hint(`use \`std.${callee.text}\` to access the shadowed standard library function`);
  }
  return error;
}
