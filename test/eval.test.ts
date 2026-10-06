import { describe, expect, it } from 'vitest';
import { evalExpression } from './eval-helpers.js';
import { fixtureDir, readJsonl } from './helpers.js';
import { corpusDir } from './helpers.js';

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

describe('expressions', () => {
  const corpus = new Map(readJsonl<{ id: string; expr: string }>(`${corpusDir}/expressions.jsonl`).map((r) => [r.id, r.expr]));
  const fixtures = readJsonl<{ id: string; value: unknown; diagnostics: { severity: string; message: string; hints?: string[] }[] }>(
    `${fixtureDir}/expressions.jsonl`,
  );

  it('evaluate to the values and errors Typst gives', () => {
    const failures: string[] = [];
    const unsupported: string[] = [];
    for (const fixture of fixtures) {
      const expr = corpus.get(fixture.id)!;
      const got = evalExpression(expr);
      if (got.diagnostics.some((d) => d.unsupported)) {
        unsupported.push(expr);
        continue;
      }
      const want = {
        value: fixture.value,
        diagnostics: fixture.diagnostics.map((d) => ({
          severity: d.severity,
          message: d.message,
          ...(d.hints ? { hints: d.hints } : {}),
        })),
      };
      if (JSON.stringify(canon(want)) !== JSON.stringify(canon({ value: got.value, diagnostics: got.diagnostics }))) {
        failures.push(expr);
      }
    }
    expect(failures).toEqual([]);
    // Every expression evaluates: Levels 1 to 3 (docs/DESIGN.md §6.3).
    expect(unsupported).toEqual([]);
  });
});
