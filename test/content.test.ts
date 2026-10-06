import { describe, expect, it } from 'vitest';
import { SourceError } from '../src/eval/diag.js';
import { contentToJson } from '../src/eval/value.js';
import { equationStyles, resolveEquation } from '../src/ir/resolve.js';
import { evalCorpusFormula, isPreambleWarning } from './eval-helpers.js';
import { parseMath } from '../src/syntax/parser.js';
import { type Formula, corpusDir, fixtureDir, readJsonl } from './helpers.js';

/** Sorts object keys so that JSON comparisons ignore key order. */
function canon(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canon((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

interface Diag {
  severity: string;
  message: string;
  hints?: string[];
  at?: string | null;
}

const simplify = (d: { severity: string; message: string; hints?: string[] }) => ({
  severity: d.severity,
  message: d.message,
  ...(d.hints && d.hints.length > 0 ? { hints: d.hints } : {}),
});

describe.each(['paired', 'typst-docs', 'symbols', 'code', 'features', 'levels'])('content of %s formulas', (name) => {
  const fixtures = new Map(
    readJsonl<{ id: string; content?: unknown; diagnostics?: Diag[] }>(`${fixtureDir}/${name}.jsonl`).map((r) => [r.id, r]),
  );
  const formulas = readJsonl<Formula>(`${corpusDir}/${name}.jsonl`);

  it('matches Typst, except for refused constructs', () => {
    const failures: string[] = [];
    const refused: string[] = [];
    for (const formula of formulas) {
      const root = parseMath(formula.src);
      if (root.erroneous()) continue; // The syntax tests cover these.
      const fixture = fixtures.get(formula.id)!;
      let content: unknown = null;
      let diagnostics: unknown[];
      try {
        const result = evalCorpusFormula(formula);
        content = contentToJson(result.equation);
        // The fixture's diagnostics come from laying the formula out, so they
        // include those of the math IR.
        const warnings = result.warnings.filter((d) => !isPreambleWarning(d));
        try {
          resolveEquation(result.equation.body, equationStyles(formula.display, result.styles), warnings);
        } catch (e) {
          if (!(e instanceof SourceError)) throw e;
          warnings.push(...e.diagnostics);
        }
        diagnostics = warnings.map(simplify);
      } catch (e) {
        if (!(e instanceof SourceError)) throw e;
        if (e.diagnostics.some((d) => d.kind === 'unsupported')) {
          refused.push(`${formula.id}: ${e.diagnostics[0]!.message}`);
          continue;
        }
        diagnostics = e.diagnostics.map(simplify);
      }
      const want = (fixture.diagnostics ?? []).filter((d) => d.at === 'src' || d.severity === 'error').map(simplify);
      const expected = JSON.stringify(canon({ content: fixture.content ?? null, diagnostics: want }));
      const got = JSON.stringify(canon({ content, diagnostics }));
      if (got !== expected) failures.push(`${formula.id}: ${formula.src}
  want ${expected}
  got  ${got}`);
    }
    expect(failures).toEqual([]);
    // Refusals are constructs outside Levels 1 to 3 (docs/DESIGN.md §6.3), such as
    // show rules and loops, and fonts other than New Computer Modern Math.
    expect(refused).toEqual(EXPECTED_REFUSALS[name] ?? []);
  });
});

/** The formulas each corpus refuses, with the reason. */
const EXPECTED_REFUSALS: Record<string, string[]> = {
  paired: [
    // Level 4.
    'loop-matrix: Typlet does not support the `range` function',
    // Never supported.
    'show-rule: Typlet does not support `show` rules',
    'math-font: Typlet does not support `show` rules',
  ],
  levels: [
    'content-heading: Typlet does not support headings',
    'loop-refused: Typlet does not support loops',
    'show-refused: Typlet does not support `show` rules',
    'preamble-show: Typlet does not support `show` rules',
  ],
};
