import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { renderToString } from '../src/index.js';
import { corpusDir, corpusNames, type Expression, type Formula, readJsonl } from './helpers.js';

describe('corpus', () => {
  it('has the expected files', () => {
    expect(corpusNames()).toEqual(['code', 'expressions', 'features', 'levels', 'paired', 'symbols', 'syntax', 'typst-docs']);
  });

  it.each(corpusNames())('%s has unique ids', (name) => {
    const ids = readJsonl<{ id: string }>(join(corpusDir, `${name}.jsonl`)).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('holds parse cases with a mode in syntax.jsonl', () => {
    for (const record of readJsonl<{ id: string; mode: string }>(join(corpusDir, 'syntax.jsonl'))) {
      expect(['math', 'code', 'markup'], record.id).toContain(record.mode);
    }
  });

  it.each(corpusNames().filter((n) => n !== 'expressions' && n !== 'syntax'))('%s holds formula records', (name) => {
    for (const record of readJsonl<Formula>(join(corpusDir, `${name}.jsonl`))) {
      expect(typeof record.src, record.id).toBe('string');
      expect(typeof record.display, record.id).toBe('boolean');
      if (record.preamble !== undefined) expect(record.preamble, record.id).not.toBe('');
    }
  });

  it('holds expression records in expressions.jsonl', () => {
    for (const record of readJsonl<Expression>(join(corpusDir, 'expressions.jsonl'))) {
      expect(typeof record.expr, record.id).toBe('string');
    }
  });

  it('keeps every paired formula', () => {
    const paired = readJsonl<Formula>(join(corpusDir, 'paired.jsonl'));
    expect(paired).toHaveLength(81);
    // Formulas that were whole documents keep their statements as a preamble.
    expect(paired.find((f) => f.id === 'macros')?.preamble).toBe('#let Real = $bb(R)$');
  });

  // bench/web.mjs and tools/site/build.mjs choose the benchmark page's formulas this way.
  it('lists the benchmark page’s formulas in web-page.json: those both Typlet and KaTeX render, without a preamble', () => {
    const renders = (render: () => string): boolean => {
      try {
        render();
        return true;
      } catch {
        return false;
      }
    };
    const page = readJsonl<Formula & { tex?: string }>(join(corpusDir, 'paired.jsonl'))
      .filter((f) => f.tex && !f.preamble)
      .filter((f) => renders(() => renderToString(f.src, { displayMode: f.display, strict: 'ignore' })))
      .filter((f) => renders(() => katex.renderToString(f.tex!, { displayMode: f.display, throwOnError: true })))
      .map((f) => f.id);
    const listed = JSON.parse(readFileSync(join(corpusDir, 'web-page.json'), 'utf8')) as { description: string; ids: string[] };
    expect(listed.ids).toEqual(page);
    expect(listed.description).toContain(`The ${page.length} formulas`);
  });
});
