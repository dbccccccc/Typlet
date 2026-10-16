// Ported from Typst 0.15.1: crates/typst-eval/src/rules.rs, crates/typst-eval/src/vm.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { type LinkedNode, firstExpr, isExpr, lastExpr, lastOfKind } from '../syntax/ast.js';
import { SyntaxKind } from '../syntax/kind.js';
import { evalArgs } from './call.js';
import { boolCast, castError, contentCast, funcCast, typeInfo, union } from './cast.js';
import { evalExpr } from './code.js';
import { HintedError, type Span, at, bail, bailAt, unsupported } from './diag.js';
import type { Func } from './func.js';
import { type ShowSet, type Styles, showSet } from './styles.js';
import { typeOf } from './value.js';
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

/**
 * A show rule as styles, like `Eval for ast::ShowRule`, for the rules Typlet
 * supports: `show math.equation: set …`, with or without `where(block: …)`
 * (docs/DESIGN.md §6.3). Other selectors and transformations are refused as
 * unsupported.
 */
export function evalShowRule(vm: Vm, node: LinkedNode): Styles {
  const children = node.children();
  const colon = children.findIndex((child) => child.kind === K.Colon);
  const selectorExpr = children.slice(0, Math.max(colon, 0)).filter(isExpr).at(-1);
  if (selectorExpr === undefined) return unsupported(node.span, '`show` rules without a selector');
  const selector = evalSelector(vm, selectorExpr);
  const transformExpr = lastExpr(node);
  if (transformExpr.kind !== K.SetRule) {
    const transform = evalExpr(vm, transformExpr);
    if (transform.type === 'function') return unsupported(transformExpr.span, '`show` rules with a function');
    if (contentCast.castable(transform)) return unsupported(transformExpr.span, '`show` rules with content');
    return at(transformExpr.span, () => {
      throw castError(union(typeInfo('content'), typeInfo('function')), transform);
    });
  }
  return [showSet({ ...selector, styles: evalSetRule(vm, transformExpr) })];
}

type Selector = Pick<ShowSet, 'elem' | 'fields'>;

/** A show rule's selector: an element function, or `where()` called on one. */
function evalSelector(vm: Vm, expr: LinkedNode): Selector {
  if (expr.kind === K.FuncCall) {
    const callee = firstExpr(expr);
    if (callee.kind === K.FieldAccess && lastOfKind(callee, K.Ident)!.text === 'where') {
      const target = evalExpr(vm, firstExpr(callee));
      if (target.type === 'function') return evalWhere(vm, target.v, expr);
    }
  }
  const value = evalExpr(vm, expr);
  if (value.type !== 'function') {
    const what = value.type === 'str' ? 'text' : value.type === 'label' ? 'labels' : `selectors of type ${typeOf(value)}`;
    return unsupported(expr.span, `\`show\` rules for ${what}`);
  }
  return { elem: selectedElem(value.v, expr.span), fields: [] };
}

/** The element a function selects, if Typlet can apply show-set rules to it. */
function selectedElem(func: Func, span: Span): string {
  if (!func.elem) bailAt(span, 'only element functions can be used as selectors');
  if (func.elem !== 'equation') unsupported(span, `\`show\` rules for \`${func.elem}\``);
  return func.elem;
}

/**
 * `where()` on an element function, like `Func::where`: the named arguments
 * are the fields to match. Typlet matches an equation's `block` field.
 */
function evalWhere(vm: Vm, func: Func, call: LinkedNode): Selector {
  const span = call.span;
  if (!func.elem) bailAt(span, '`where()` can only be called on element functions');
  const args = evalArgs(vm, lastOfKind(call, K.Args)!).spanned(span);
  const fields: [string, unknown][] = [];
  for (const item of args.items) {
    if (item.name === null) continue;
    if (item.name !== 'block' || func.elem !== 'equation') unsupported(item.span, `\`where()\` with the field \`${item.name}\``);
    // The field matches only if the equation's value equals it, as in Typst,
    // so any value but a boolean matches no equation.
    fields.push([item.name, item.value.type === 'bool' ? item.value.v : item.value]);
  }
  // `where()` takes no positional arguments.
  args.items = args.items.filter((item) => item.name === null);
  args.finish();
  return { elem: selectedElem(func, span), fields };
}

/** Adds a hint when a variable shadows a function of the standard library. */
export function hintIfShadowedStd(vm: Vm, callee: LinkedNode, error: HintedError): HintedError {
  if (callee.kind === K.Ident && vm.scopes.local(callee.text) && vm.library.global.scope.has(callee.text)) {
    error.hint(`use \`std.${callee.text}\` to access the shadowed standard library function`);
  }
  return error;
}
