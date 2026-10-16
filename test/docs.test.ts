import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToResult } from '../src/index.js';
import { corpusDir, corpusNames, fixtureDir, type Formula, readJsonl, root } from './helpers.js';

describe('release documentation', () => {
  it('counts only formulas Typst renders in the current changelog coverage', () => {
    const counts = { total: 0, html: 0, mathml: 0, refused: 0 };
    for (const name of corpusNames().filter((name) => !['expressions', 'syntax'].includes(name))) {
      const fixtures = new Map(
        readJsonl<{ id: string; frame: unknown; mathml: unknown }>(`${fixtureDir}/${name}.jsonl`).map((r) => [r.id, r]),
      );
      for (const formula of readJsonl<Formula>(`${corpusDir}/${name}.jsonl`)) {
        const reference = fixtures.get(formula.id)!;
        if (reference.frame == null || reference.mathml == null) continue;
        counts.total++;
        try {
          const result = renderToResult(formula.src, {
            displayMode: formula.display, preamble: formula.preamble, strict: 'ignore', trust: true,
          });
          expect(['html', 'mathml']).toContain(result.drawnAs);
          if (result.drawnAs === 'html') counts.html++;
          else counts.mathml++;
        } catch (error) {
          expect(error).toHaveProperty('kind', 'unsupported');
          counts.refused++;
        }
      }
    }
    const changelog = readFileSync(`${root}/CHANGELOG.md`, 'utf8');
    const match = /Of the ([\d,]+) formulas of the test corpus that Typst renders, Typlet now lays out ([\d,]+), draws ([\d,]+) as MathML with a warning, and refuses ([\d,]+)\./.exec(changelog);
    expect(match, 'current release coverage is documented').not.toBeNull();
    expect(match!.slice(1).map((value) => Number(value.replaceAll(',', '')))).toEqual([
      counts.total, counts.html, counts.mathml, counts.refused,
    ]);
  });

  it('documents the deliberately narrow formula language', () => {
    const supported = readFileSync(`${root}/docs/supported.md`, 'utf8');
    for (const source of ['#[x].location()', '#(1em).to-absolute()', '#(1, 2).map(x => x)', '#calc.sin(1)']) {
      expect(() => renderToResult(source)).toThrow(expect.objectContaining({ kind: 'unsupported' }));
    }
    for (const description of ['v0.1.1 subset', '`function.where`', '`calc`', '`range`', 'constructors']) {
      expect(supported).toContain(description);
    }
    expect(supported).not.toContain('| Type | Methods |');
  });
});
