// Checks Typlet's parser against typst-syntax: every formula in the corpus must
// produce the same syntax tree as the oracle's `cst` fixture (docs/DESIGN.md §5.3).

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, parseCode, parseMath } from '../src/syntax/index.js';
import { dumpCst } from './cst.js';
import { corpusDir, corpusNames, fixtureDir, type Formula, readJsonl } from './helpers.js';

const formulaCorpora = corpusNames().filter((name) => name !== 'expressions' && name !== 'syntax');
const parsers = { math: parseMath, code: parseCode, markup: parse };

describe('parser wrapping boundaries', () => {
  it.each([
    ['', ['Code', 0, 0]],
    ['a+b', ['Code', 0, 3, [['Binary', 0, 3, [['Ident', 0, 1], ['Plus', 1, 2], ['Ident', 2, 3]]]]]],
    ['a+b  // tail', ['Code', 0, 12, [
      ['Binary', 0, 3, [['Ident', 0, 1], ['Plus', 1, 2], ['Ident', 2, 3]]],
      ['Space', 3, 5], ['LineComment', 5, 12],
    ]]],
  ] as const)('keeps children and trailing trivia for %j', (source, expected) => {
    const root = parseCode(source);
    expect(dumpCst(root)).toEqual(expected);
    expect(root.fullText()).toBe(source);
    expect(root.diagnostics()).toEqual([]);
  });

  it('keeps zero-width malformed-expression diagnostics before trailing trivia', () => {
    const root = parseCode('a+  // tail');
    expect(dumpCst(root)).toEqual(['Code', 0, 11, [
      ['Binary', 0, 2, [['Ident', 0, 1], ['Plus', 1, 2], ['Error', 2, 2, 'expected expression', []]]],
      ['Space', 2, 4], ['LineComment', 4, 11],
    ]]);
    expect(root.diagnostics()).toEqual([{ severity: 'error', message: 'expected expression', hints: [], start: 2, end: 2 }]);
  });
});

describe('parser token snapshots', () => {
  it.each([
    {
      name: 'nested default memo', mode: 'code',
      source: '(f: (x) => x) => f',
      cst: ['Code', 0, 18, [
        ['Closure', 0, 18, [
          ['Params', 0, 13, [
            ['LeftParen', 0, 1],
            ['Named', 1, 12, [
              ['Ident', 1, 2],
              ['Colon', 2, 3],
              ['Space', 3, 4],
              ['Closure', 4, 12, [
                ['Params', 4, 7, [['LeftParen', 4, 5], ['Ident', 5, 6], ['RightParen', 6, 7]]],
                ['Space', 7, 8],
                ['Arrow', 8, 10],
                ['Space', 10, 11],
                ['Ident', 11, 12],
              ]],
            ]],
            ['RightParen', 12, 13],
          ]],
          ['Space', 13, 14],
          ['Arrow', 14, 16],
          ['Space', 16, 17],
          ['Ident', 17, 18],
        ]],
      ]],
    },
    {
      name: 'named destructure trivia', mode: 'code',
      source: '(a /*c*/ : b, c) = value',
      cst: ['Code', 0, 24, [
        ['DestructAssignment', 0, 24, [
          ['Destructuring', 0, 16, [
            ['LeftParen', 0, 1],
            ['Named', 1, 12, [
              ['Ident', 1, 2],
              ['Space', 2, 3],
              ['BlockComment', 3, 8],
              ['Space', 8, 9],
              ['Colon', 9, 10],
              ['Space', 10, 11],
              ['Ident', 11, 12],
            ]],
            ['Comma', 12, 13],
            ['Space', 13, 14],
            ['Ident', 14, 15],
            ['RightParen', 15, 16],
          ]],
          ['Space', 16, 17],
          ['Eq', 17, 18],
          ['Space', 18, 19],
          ['Ident', 19, 24],
        ]],
      ]],
    },
    {
      name: 'newline fake end', mode: 'markup',
      source: '#let x = 1\n#x',
      cst: ['Markup', 0, 13, [
        ['Hash', 0, 1],
        ['LetBinding', 1, 10, [
          ['Let', 1, 4],
          ['Space', 4, 5],
          ['Ident', 5, 6],
          ['Space', 6, 7],
          ['Eq', 7, 8],
          ['Space', 8, 9],
          ['Int', 9, 10],
        ]],
        ['Space', 10, 11],
        ['Hash', 11, 12],
        ['Ident', 12, 13],
      ]],
    },
    {
      name: 'mixed modes', mode: 'code',
      source: '(x) => [#x\n$y$]',
      cst: ['Code', 0, 15, [
        ['Closure', 0, 15, [
          ['Params', 0, 3, [['LeftParen', 0, 1], ['Ident', 1, 2], ['RightParen', 2, 3]]],
          ['Space', 3, 4],
          ['Arrow', 4, 6],
          ['Space', 6, 7],
          ['ContentBlock', 7, 15, [
            ['LeftBracket', 7, 8],
            ['Markup', 8, 14, [
              ['Hash', 8, 9],
              ['Ident', 9, 10],
              ['Space', 10, 11],
              ['Equation', 11, 14, [
                ['Dollar', 11, 12],
                ['Math', 12, 13, [['MathText', 12, 13]]],
                ['Dollar', 13, 14],
              ]],
            ]],
            ['RightBracket', 14, 15],
          ]],
        ]],
      ]],
    },
    {
      name: 'memo malformed', mode: 'code',
      source: '(f: (x) => x) =>  // tail',
      cst: ['Code', 0, 25, [
        ['Closure', 0, 16, [
          ['Params', 0, 13, [
            ['LeftParen', 0, 1],
            ['Named', 1, 12, [
              ['Ident', 1, 2],
              ['Colon', 2, 3],
              ['Space', 3, 4],
              ['Closure', 4, 12, [
                ['Params', 4, 7, [['LeftParen', 4, 5], ['Ident', 5, 6], ['RightParen', 6, 7]]],
                ['Space', 7, 8],
                ['Arrow', 8, 10],
                ['Space', 10, 11],
                ['Ident', 11, 12],
              ]],
            ]],
            ['RightParen', 12, 13],
          ]],
          ['Space', 13, 14],
          ['Arrow', 14, 16],
          ['Error', 16, 16, 'expected expression', []],
        ]],
        ['Space', 16, 18],
        ['LineComment', 18, 25],
      ]],
    },
  ] as const)('keeps $name across token reuse', ({ name, mode, source, cst }) => {
    const root = parsers[mode](source);
    expect(dumpCst(root)).toEqual(cst);
    expect(root.fullText()).toBe(source);
    if (name === 'memo malformed') {
      expect(root.diagnostics()).toEqual([{ severity: 'error', message: 'expected expression', hints: [], start: 16, end: 16 }]);
    } else {
      expect(root.diagnostics()).toEqual([]);
    }
  });
});

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
