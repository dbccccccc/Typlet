// Helpers to evaluate code expressions and formulas the way the oracle does,
// and to compare the results with its fixtures.

import { LinkedNode } from '../src/syntax/ast.js';
import { SyntaxKind } from '../src/syntax/kind.js';
import { parse, parseCode, parseMath } from '../src/syntax/parser.js';
import { evalExpr } from '../src/eval/code.js';
import { SourceError, type SourceDiagnostic } from '../src/eval/diag.js';
import { DEFAULT_LIMITS, newEngine } from '../src/eval/func.js';
import { type Evaluated, type Preamble, evalFormula, evalPreamble } from '../src/eval/index.js';
import type { Formula } from './helpers.js';
import { LIBRARY } from '../src/eval/library.js';
import { type Value, repr, toJson } from '../src/eval/value.js';
import { absToPt, angleToDeg } from '../src/eval/layout.js';
import { Vm, forbidden } from '../src/eval/vm.js';

export interface ValueResult {
  value: { type: string; repr: string; json: unknown; exact?: Record<string, number> } | null;
  diagnostics: { severity: string; message: string; hints?: string[]; unsupported?: boolean }[];
}

/** Full-precision numbers, as the oracle's `exact` field gives them. */
function exact(value: Value): Record<string, number> | undefined {
  switch (value.type) {
    case 'float':
      return { float: value.v };
    case 'length':
      return { abs: absToPt(value.v.abs), em: value.v.em };
    case 'angle':
      return { deg: angleToDeg(value.v) };
    case 'ratio':
      return { ratio: value.v };
    case 'relative':
      return { ratio: value.v.rel, abs: absToPt(value.v.abs.abs), em: value.v.abs.em };
    case 'fraction':
      return { fr: value.v };
    default:
      return undefined;
  }
}

function diagnostic(d: SourceDiagnostic) {
  return {
    severity: d.severity,
    message: d.message,
    ...(d.hints.length > 0 ? { hints: d.hints } : {}),
    ...(d.kind === 'unsupported' ? { unsupported: true } : {}),
  };
}

/** Evaluates a code expression as the oracle's `#metadata(expr)` does. */
export function evalExpression(expr: string): ValueResult {
  const root = parseCode(expr);
  if (root.erroneous()) {
    return {
      value: null,
      diagnostics: root.diagnostics().map((d) => ({ severity: d.severity, message: d.message, ...(d.hints.length ? { hints: d.hints } : {}) })),
    };
  }
  const engine = newEngine();
  const vm = new Vm(engine, LIBRARY);
  const node = new LinkedNode(root, 0).children().find((c) => c.kind !== SyntaxKind.Space)!;
  try {
    const value = evalExpr(vm, node);
    // A `return` or `break` outside a function or loop fails at the top.
    if (vm.flow) throw new SourceError([forbidden(vm.flow)]);
    const e = exact(value);
    return {
      value: { type: value.type, repr: repr(value), json: toJson(value), ...(e ? { exact: e } : {}) },
      diagnostics: engine.warnings.map(diagnostic),
    };
  } catch (e) {
    if (!(e instanceof SourceError)) throw e;
    return { value: null, diagnostics: [...engine.warnings.map(diagnostic), ...e.diagnostics.map(diagnostic)] };
  }
}

/**
 * Evaluates a corpus formula after its preamble, as the oracle compiles them
 * together. Throws a `SourceError` when either fails, and an `Error` for a
 * preamble with syntax errors.
 */
export function evalCorpusFormula(formula: Formula): Evaluated {
  let preamble: Preamble | null = null;
  if (formula.preamble?.trim()) {
    const tree = parse(formula.preamble);
    if (tree.erroneous()) throw new Error(`syntax error in the preamble of ${formula.id}`);
    preamble = evalPreamble(tree);
  }
  const result = evalFormula(parseMath(formula.src), formula.display, DEFAULT_LIMITS, preamble, null);
  return { ...result, warnings: [...(preamble?.warnings ?? []), ...result.warnings] };
}

/** Whether a diagnostic is a warning in the preamble, which fixtures of formulas leave out. */
export const isPreambleWarning = (d: SourceDiagnostic): boolean => d.severity === 'warning' && d.span?.file === 'preamble';
