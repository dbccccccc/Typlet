// Checks Typlet's parser against typst-syntax: every formula in the corpus must
// produce the same syntax tree as the oracle's `cst` fixture (docs/DESIGN.md §5.3).

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, parseCode, parseMath } from '../src/syntax/index.js';
import { dumpCst } from './cst.js';
import { corpusDir, corpusNames, fixtureDir, type Formula, readJsonl } from './helpers.js';

const formulaCorpora = corpusNames().filter((name) => name !== 'expressions' && name !== 'syntax');
const parsers = { math: parseMath, code: parseCode, markup: parse };

describe('syntax trees match typst-syntax: edge cases', () => {
  const cases = readJsonl<{ id: string; src: string; mode: keyof typeof parsers }>(join(corpusDir, 'syntax.jsonl'));
  const fixtures = new Map(readJsonl<{ id: string; cst: unknown }>(join(fixtureDir, 'syntax.jsonl')).map((f) => [f.id, f.cst]));

  it.each(cases.map((c) => [c.id, c] as const))('%s', (_, c) => {
    expect(dumpCst(parsers[c.mode](c.src))).toEqual(fixtures.get(c.id));
  });
});

describe.each(formulaCorpora)('syntax trees match typst-syntax: %s', (name) => {
  const corpus = readJsonl<Formula>(join(corpusDir, `${name}.jsonl`));
  const fixtures = new Map(readJsonl<{ id: string; cst: unknown }>(join(fixtureDir, `${name}.jsonl`)).map((f) => [f.id, f.cst]));

  it('for every formula', () => {
    const mismatches = corpus
      .filter((formula) => JSON.stringify(dumpCst(parseMath(formula.src))) !== JSON.stringify(fixtures.get(formula.id)))
      .map((formula) => formula.id);
    expect(mismatches).toEqual([]);
  });
});
