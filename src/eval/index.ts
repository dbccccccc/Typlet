// Typlet original: not ported from Typst.
//
// Evaluates a parsed formula to content, as Typst evaluates `$…$`, after an
// optional preamble of definitions and set rules.

import { LinkedNode, exprs } from '../syntax/ast.js';
import { SyntaxKind } from '../syntax/kind.js';
import type { SyntaxNode } from '../syntax/node.js';
import { evalDisplay, evalExpr } from './code.js';
import { type Content, type EquationElem, sequence } from './content.js';
import { type SourceDiagnostic, SourceError, unsupported } from './diag.js';
import { DEFAULT_LIMITS, type Limits, callFunc, newEngine } from './func.js';
import { LIBRARY } from './library.js';
import { setCollectionLimits } from './ops.js';
import { evalSetRule } from './rules.js';
import type { Scope } from './scope.js';
import { EMPTY_CHAIN, type Property, type Styles, chain, get } from './styles.js';
import { type Numbering, applyNumbering } from './numbering.js';
import { display } from './value.js';
import { markupExprs } from './markup.js';
import { Vm, forbidden } from './vm.js';

const K = SyntaxKind;

export interface Evaluated {
  readonly equation: EquationElem;
  readonly warnings: SourceDiagnostic[];
  /** The styles of the preamble's set rules, which apply to the equation. */
  readonly styles: Styles;
  /** The number of a numbered display equation, such as `(1)`. */
  readonly number: Content | null;
}

/** A preamble's definitions and settings, for the formulas that follow it (docs/DESIGN.md §6.3). */
export interface Preamble {
  /** The definitions. */
  readonly scope: Scope;
  /** The styles of the set rules. */
  readonly styles: Styles;
  readonly warnings: readonly SourceDiagnostic[];
}

/**
 * Evaluates a preamble, parsed in markup mode, as the start of a Typst
 * document: definitions and set rules apply to the formulas after it, and
 * the content it displays is dropped. Throws a `SourceError`, whose spans are
 * in the preamble. The tree must be free of syntax errors.
 */
export function evalPreamble(root: SyntaxNode, limits: Limits = DEFAULT_LIMITS): Preamble {
  const engine = newEngine(limits);
  setCollectionLimits(limits.collectionSize, limits.stringLength);
  const vm = new Vm(engine, LIBRARY);
  const styles: Property[] = [];
  for (const expr of markupExprs(new LinkedNode(root, 0, 'preamble'))) {
    if (expr.kind === K.SetRule) styles.push(...evalSetRule(vm, expr));
    else if (expr.kind === K.ShowRule) unsupported(expr.span, '`show` rules');
    else evalExpr(vm, expr);
    if (vm.flow) throw new SourceError([forbidden(vm.flow)]);
  }
  return { scope: vm.scopes.top, styles, warnings: engine.warnings };
}

/**
 * Evaluates the syntax tree of a formula, parsed in math mode, to an
 * equation. Throws a `SourceError` when evaluation fails. The tree must be
 * free of syntax errors.
 */
export function evalFormula(
  root: SyntaxNode,
  block: boolean,
  limits: Limits = DEFAULT_LIMITS,
  preamble: Preamble | null = null,
  counter: { value: number } | null = null,
): Evaluated {
  const engine = newEngine(limits);
  setCollectionLimits(limits.collectionSize, limits.stringLength);
  const vm = new Vm(engine, LIBRARY);
  // The formula sees the preamble's definitions, and its own `let`s don't
  // change them for other formulas.
  if (preamble) vm.scopes.top = preamble.scope.clone();

  // In `$ x $`, the spaces next to the dollar signs belong to the equation,
  // not to its body. A formula's source has no dollar signs, so they are
  // trimmed here to give the body Typst would.
  const children = exprs(new LinkedNode(root, 0), true);
  let start = 0;
  let end = children.length;
  while (start < end && children[start]!.kind === SyntaxKind.Space) start++;
  while (end > start && children[end - 1]!.kind === SyntaxKind.Space) end--;
  const body = sequence(children.slice(start, end).map((child) => evalDisplay(vm, child)));
  if (vm.flow) throw new SourceError([forbidden(vm.flow)]);

  const styles = preamble?.styles ?? [];
  return {
    equation: { func: 'equation', block, body, span: null },
    warnings: engine.warnings,
    styles,
    number: block ? equationNumber(vm, styles, counter) : null,
  };
}

/**
 * The number of a display equation, if a set rule numbers equations: the
 * counter's next value, or 1, in the numbering, like `Counter::display_at`.
 */
function equationNumber(vm: Vm, styles: Styles, counter: { value: number } | null): Content | null {
  const numbering = get<Numbering | null>(chain(EMPTY_CHAIN, styles), 'equation', 'numbering', null);
  if (!numbering) return null;
  const n = counter ? ++counter.value : 1;
  const value = applyNumbering(numbering, [n], vm.engine, null, (func, args) => callFunc(func, vm.engine, args));
  return display(value);
}
