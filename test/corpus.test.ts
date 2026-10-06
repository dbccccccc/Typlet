import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { corpusDir, corpusNames, type Expression, type Formula, readJsonl } from './helpers.js';

describe('corpus', () => {
  it('has the expected files', () => {
    expect(corpusNames()).toEqual(['code', 'expressions', 'features', 'levels', 'paired', 'symbols', 'syntax', 'typst-docs', 'typstpad']);
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
});
