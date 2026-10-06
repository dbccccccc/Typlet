// Checks that the oracle's fixtures match the corpus and are well formed.
// Regenerate them with `npm run fixtures` after changing the corpus.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { typstVersion } from '../src/version.js';
import { corpusDir, corpusNames, type Expression, type Formula, fixtureDir, readJsonl, root } from './helpers.js';

type Node = [string, number, number, ...unknown[]];

interface FormulaFixture {
  id: string;
  cst: Node;
  content: unknown;
  mathml: string[] | null;
  frame: { box: { anchor: string } | null; glyphs: unknown[]; fonts: string[] } | null;
  diagnostics: { severity: string; message: string }[];
  panic?: string;
  error?: string;
}

const formulaCorpora = corpusNames().filter((name) => name !== 'expressions' && name !== 'syntax');

describe('fixtures', () => {
  it('target the Typst version the oracle pins', () => {
    const cargo = readFileSync(join(root, 'oracle/Cargo.toml'), 'utf8');
    expect(cargo).toContain(`typst = "=${typstVersion}"`);
    expect(readFileSync(join(root, 'oracle/src/main.rs'), 'utf8')).toContain(
      `const TYPST_VERSION: &str = "${typstVersion}";`,
    );
    expect(existsSync(fixtureDir)).toBe(true);
  });

  it('exist for every corpus file, in the same order', () => {
    for (const name of corpusNames()) {
      const corpus = readJsonl<{ id: string }>(join(corpusDir, `${name}.jsonl`));
      const fixtures = readJsonl<{ id: string }>(join(fixtureDir, `${name}.jsonl`));
      expect(fixtures.map((f) => f.id), name).toEqual(corpus.map((c) => c.id));
    }
  });

  it('cover at least 1,000 formulas', () => {
    const count = formulaCorpora.reduce((sum, name) => sum + readJsonl(join(fixtureDir, `${name}.jsonl`)).length, 0);
    expect(count).toBeGreaterThanOrEqual(1000);
  });

  describe.each(formulaCorpora)('%s', (name) => {
    const corpus = new Map(readJsonl<Formula>(join(corpusDir, `${name}.jsonl`)).map((f) => [f.id, f]));
    const fixtures = readJsonl<FormulaFixture>(join(fixtureDir, `${name}.jsonl`));

    it('ran without oracle failures', () => {
      expect(fixtures.filter((f) => f.panic !== undefined || f.error !== undefined)).toEqual([]);
    });

    it('parse the whole source', () => {
      for (const fixture of fixtures) {
        const [kind, start, end] = fixture.cst;
        expect([kind, start, end], fixture.id).toEqual(['Math', 0, corpus.get(fixture.id)!.src.length]);
      }
    });

    it('lay out every formula that compiles, with a box anchored by display mode', () => {
      for (const fixture of fixtures) {
        const failed = fixture.diagnostics.some((d) => d.severity === 'error');
        if (failed) {
          expect(fixture.frame, fixture.id).toBeNull();
          continue;
        }
        const anchor = corpus.get(fixture.id)!.display ? 'top' : 'baseline';
        expect(fixture.frame?.box?.anchor, fixture.id).toBe(anchor);
        expect(fixture.mathml?.length, fixture.id).toBeGreaterThan(0);
        expect(fixture.content, fixture.id).not.toBeNull();
      }
    });
  });

  it('evaluate every expression to a value or an error', () => {
    const corpus = readJsonl<Expression>(join(corpusDir, 'expressions.jsonl'));
    const fixtures = readJsonl<{ id: string; value: unknown; diagnostics: { severity: string }[] }>(
      join(fixtureDir, 'expressions.jsonl'),
    );
    expect(fixtures).toHaveLength(corpus.length);
    for (const fixture of fixtures) {
      const failed = fixture.diagnostics.some((d) => d.severity === 'error');
      expect(failed === (fixture.value === null), fixture.id).toBe(true);
    }
  });

  it('use New Computer Modern Math Book, Typst’s default math font', () => {
    const paired = readJsonl<FormulaFixture>(join(fixtureDir, 'paired.jsonl'));
    const fonts = new Set(paired.flatMap((f) => f.frame?.fonts ?? []));
    expect(fonts).toContain('NewCMMath-Book');
  });
});
