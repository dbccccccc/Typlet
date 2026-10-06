import { describe, expect, it } from 'vitest';
import { SourceError, type SourceDiagnostic } from '../src/eval/diag.js';
import { evalCorpusFormula, isPreambleWarning } from './eval-helpers.js';
import { equationToMathml } from '../src/mathml/index.js';
import { parseMath } from '../src/syntax/parser.js';
import { type Formula, corpusDir, fixtureDir, readJsonl } from './helpers.js';

interface Fixture {
  id: string;
  mathml?: string[] | null;
  mathmlDiagnostics?: { severity: string; message: string; hints?: string[]; at?: string | null; span?: [number, number] }[];
}

const simplify = (d: { severity: string; message: string; hints?: string[]; span?: [number, number] | null }) => ({
  severity: d.severity,
  message: d.message,
  ...(d.hints && d.hints.length > 0 ? { hints: d.hints } : {}),
  ...(d.span ? { span: d.span } : {}),
});

const fromTyplet = (d: SourceDiagnostic) =>
  simplify({ ...d, span: d.span ? [d.span.start, d.span.end] : null });

describe.each(['paired', 'typst-docs', 'typstpad', 'symbols', 'code', 'features', 'levels'])('MathML of %s formulas', (name) => {
  const fixtures = new Map(readJsonl<Fixture>(`${fixtureDir}/${name}.jsonl`).map((r) => [r.id, r]));
  const formulas = readJsonl<Formula>(`${corpusDir}/${name}.jsonl`);

  it('matches Typst’s MathML export', () => {
    const failures: string[] = [];
    let compared = 0;
    for (const formula of formulas) {
      const root = parseMath(formula.src);
      if (root.erroneous()) continue;
      const fixture = fixtures.get(formula.id)!;
      const warnings: SourceDiagnostic[] = [];
      let mathml: string[] | null;
      try {
        const result = evalCorpusFormula(formula);
        warnings.push(...result.warnings.filter((d) => !isPreambleWarning(d)));
        mathml = [equationToMathml(result.equation, warnings, undefined, result.styles)];
      } catch (e) {
        if (!(e instanceof SourceError)) throw e;
        if (e.diagnostics.some((d) => d.kind === 'unsupported')) continue;
        mathml = null;
        warnings.push(...e.diagnostics);
      }
      compared++;
      const want = JSON.stringify({
        mathml: fixture.mathml ?? null,
        diagnostics: (fixture.mathmlDiagnostics ?? []).filter((d) => d.at === 'src' || d.severity === 'error').map(simplify),
      });
      const got = JSON.stringify({ mathml, diagnostics: warnings.map(fromTyplet) });
      if (got !== want) failures.push(`${formula.id}: ${formula.src}
  want ${want}
  got  ${got}`);
    }
    expect(failures).toEqual([]);
    expect(compared).toBeGreaterThan(0);
  });
});
