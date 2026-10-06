import { describe, expect, it } from 'vitest';
import { SourceError } from '../src/eval/diag.js';
import { parseMath } from '../src/syntax/parser.js';
import { type Formula, corpusDir, fixtureDir, readJsonl } from './helpers.js';
import { type FlatFrame, type FrameFixture, frameDiff, layoutFlat } from './layout-helpers.js';

interface Fixture {
  id: string;
  frame?: FrameFixture | null;
}

/** Formulas whose frames differ from Typst's by design. */
const KNOWN_DIFFERENCES = new Set([
  // Typst draws rounded and partial borders as curves; Typlet keeps a box,
  // which its HTML draws with CSS.
  'levels/box-radius',
  'levels/box-side-stroke',
  // The oracle's frame has the preamble's text too.
  'levels/preamble-text',
]);

describe.each(['paired', 'typst-docs', 'typstpad', 'symbols', 'code', 'features', 'levels'])('layout of %s formulas', (name) => {
  const fixtures = new Map(readJsonl<Fixture>(`${fixtureDir}/${name}.jsonl`).map((r) => [r.id, r]));
  const formulas = readJsonl<Formula>(`${corpusDir}/${name}.jsonl`);

  it('matches Typst’s frames', () => {
    let compared = 0;
    const failures: string[] = [];
    for (const formula of formulas) {
      const want = fixtures.get(formula.id)?.frame;
      if (!want || parseMath(formula.src).erroneous() || KNOWN_DIFFERENCES.has(`${name}/${formula.id}`)) continue;
      let got: FlatFrame;
      try {
        got = layoutFlat(formula);
      } catch (e) {
        if (e instanceof SourceError && e.diagnostics.some((d) => d.kind === 'unsupported')) continue;
        failures.push(`${formula.id}: ${formula.src}\n  ${e instanceof Error ? e.message : e}`);
        compared++;
        continue;
      }
      compared++;
      const diff = frameDiff(got, want);
      if (diff) failures.push(`${formula.id}: ${formula.src}\n  ${diff}`);
    }
    expect(failures).toEqual([]);
    expect(compared).toBeGreaterThan(0);
  });
});
