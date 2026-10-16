// Checks Typlet's parser against typst-syntax: every formula in the corpus must
// produce the same syntax tree as the oracle's `cst` fixture (docs/DESIGN.md §5.3).

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SyntaxKind as K, SyntaxMode, parse, parseCode, parseMath } from '../src/syntax/index.js';
import { Lexer } from '../src/syntax/lexer.js';
import { dumpCst } from './cst.js';
import { corpusDir, corpusNames, fixtureDir, type Formula, readJsonl } from './helpers.js';

const formulaCorpora = corpusNames().filter((name) => name !== 'expressions' && name !== 'syntax');
const parsers = { math: parseMath, code: parseCode, markup: parse };

describe.each(['next', 'nextNode'] as const)('lexer %s transport', (method) => {
  // Exact node records captured from the reviewed pre-transport parser.
  it.each([
    { name: 'empty raw', mode: 'Markup', source: '``', expected: [{ kind: 'Raw', text: '``', len: 2, cursor: 2, newline: false, cst: ['Raw', 0, 2, [['RawDelim', 0, 1], ['RawDelim', 1, 2]]], diagnostics: [] }, { kind: 'End', text: '', len: 0, cursor: 2, newline: false, cst: ['End', 2, 2], diagnostics: [] }] },
    { name: 'raw warning', mode: 'Markup', source: '```lang```', expected: [{ kind: 'Raw', text: '```lang```', len: 10, cursor: 10, newline: false, cst: ['Raw', 0, 10, [['RawDelim', 0, 3], ['RawLang', 3, 7], ['RawDelim', 7, 10]]], diagnostics: [{ severity: 'warning', message: 'empty raw text', hints: ['Typst is treating `lang` as the language tag', 'to treat this as text, add a space after the initial backticks'], start: 0, end: 10 }] }, { kind: 'End', text: '', len: 0, cursor: 10, newline: false, cst: ['End', 10, 10], diagnostics: [] }] },
    { name: 'unclosed raw', mode: 'Markup', source: '`unclosed', expected: [{ kind: 'Error', text: '`unclosed', len: 9, cursor: 9, newline: false, cst: ['Error', 0, 9, 'unclosed raw text', []], diagnostics: [{ severity: 'error', message: 'unclosed raw text', hints: [], start: 0, end: 9 }] }, { kind: 'End', text: '', len: 0, cursor: 9, newline: false, cst: ['End', 9, 9], diagnostics: [] }] },
    { name: 'math field', mode: 'Math', source: 'arrow.r.long', expected: [{ kind: 'MathFieldAccess', text: 'arrow.r.long', len: 12, cursor: 12, newline: false, cst: ['MathFieldAccess', 0, 12, [['MathFieldAccess', 0, 7, [['MathIdent', 0, 5], ['Dot', 5, 6], ['MathIdent', 6, 7]]], ['Dot', 7, 8], ['MathIdent', 8, 12]]], diagnostics: [] }, { kind: 'End', text: '', len: 0, cursor: 12, newline: false, cst: ['End', 12, 12], diagnostics: [] }] },
    { name: 'UTF16 and CRLF', mode: 'Math', source: '😀\r\nalpha é', expected: [{ kind: 'MathText', text: '😀', len: 2, cursor: 2, newline: false, cst: ['MathText', 0, 2], diagnostics: [] }, { kind: 'Space', text: '\r\n', len: 2, cursor: 4, newline: true, cst: ['Space', 2, 4], diagnostics: [] }, { kind: 'MathIdent', text: 'alpha', len: 5, cursor: 9, newline: false, cst: ['MathIdent', 4, 9], diagnostics: [] }, { kind: 'Space', text: ' ', len: 1, cursor: 10, newline: false, cst: ['Space', 9, 10], diagnostics: [] }, { kind: 'MathText', text: 'é', len: 2, cursor: 12, newline: false, cst: ['MathText', 10, 12], diagnostics: [] }, { kind: 'End', text: '', len: 0, cursor: 12, newline: false, cst: ['End', 12, 12], diagnostics: [] }] },
    { name: 'invalid math escape', mode: 'Math', source: '\\u{110000}', expected: [{ kind: 'Error', text: '\\u{110000}', len: 10, cursor: 10, newline: false, cst: ['Error', 0, 10, 'invalid Unicode codepoint: 110000', []], diagnostics: [{ severity: 'error', message: 'invalid Unicode codepoint: 110000', hints: [], start: 0, end: 10 }] }, { kind: 'End', text: '', len: 0, cursor: 10, newline: false, cst: ['End', 10, 10], diagnostics: [] }] },
    { name: 'code errors and hints', mode: 'Code', source: '&& 0b102 "unterminated', expected: [{ kind: 'Error', text: '&&', len: 2, cursor: 2, newline: false, cst: ['Error', 0, 2, '`&&` is not valid in code', ['in Typst, `and` is used for logical AND']], diagnostics: [{ severity: 'error', message: '`&&` is not valid in code', hints: ['in Typst, `and` is used for logical AND'], start: 0, end: 2 }] }, { kind: 'Space', text: ' ', len: 1, cursor: 3, newline: false, cst: ['Space', 2, 3], diagnostics: [] }, { kind: 'Error', text: '0b102', len: 5, cursor: 8, newline: false, cst: ['Error', 3, 8, 'invalid binary number: `0b102`', []], diagnostics: [{ severity: 'error', message: 'invalid binary number: `0b102`', hints: [], start: 3, end: 8 }] }, { kind: 'Space', text: ' ', len: 1, cursor: 9, newline: false, cst: ['Space', 8, 9], diagnostics: [] }, { kind: 'Error', text: '"unterminated', len: 13, cursor: 22, newline: false, cst: ['Error', 9, 22, 'unclosed string', []], diagnostics: [{ severity: 'error', message: 'unclosed string', hints: [], start: 9, end: 22 }] }, { kind: 'End', text: '', len: 0, cursor: 22, newline: false, cst: ['End', 22, 22], diagnostics: [] }] },
    { name: 'code trivia', mode: 'Code', source: ' /* c */\r\nx', expected: [{ kind: 'Space', text: ' ', len: 1, cursor: 1, newline: false, cst: ['Space', 0, 1], diagnostics: [] }, { kind: 'BlockComment', text: '/* c */', len: 7, cursor: 8, newline: false, cst: ['BlockComment', 1, 8], diagnostics: [] }, { kind: 'Space', text: '\r\n', len: 2, cursor: 10, newline: true, cst: ['Space', 8, 10], diagnostics: [] }, { kind: 'Ident', text: 'x', len: 1, cursor: 11, newline: false, cst: ['Ident', 10, 11], diagnostics: [] }, { kind: 'End', text: '', len: 0, cursor: 11, newline: false, cst: ['End', 11, 11], diagnostics: [] }] },
  ] as const)('preserves $name', ({ mode, source, expected }) => {
    const lexer = new Lexer(source, SyntaxMode[mode]);
    const records = [];
    while (true) {
      const start = lexer.cursor();
      const tuple = method === 'next' ? lexer.next() : null;
      const node = tuple ? tuple[1] : lexer.nextNode();
      const kind = tuple ? tuple[0] : node.kind;
      records.push({
        kind: K[kind], text: node.fullText(), len: node.len, cursor: lexer.cursor(),
        newline: lexer.newline, cst: dumpCst(node, start), diagnostics: node.diagnostics(start),
      });
      if (kind === K.End) break;
    }
    expect(records).toEqual(expected);
  });
});

describe('lexer mutable results and scanner state', () => {
  it('keeps mixed calls and repeated EOF results independently mutable', () => {
    const lexer = new Lexer('x y', SyntaxMode.Code);
    const first = lexer.next();
    const space = lexer.nextNode();
    const last = lexer.next();
    const end1 = lexer.next();
    const end2 = lexer.next();
    const end3 = lexer.nextNode();
    const nodes = [first[1], space, last[1], end1[1], end2[1], end3];
    expect(nodes.map((node) => [node.kind, node.fullText()])).toEqual([
      [K.Ident, 'x'], [K.Space, ' '], [K.Ident, 'y'], [K.End, ''], [K.End, ''], [K.End, ''],
    ]);
    expect(new Set(nodes).size).toBe(nodes.length);
    expect(first).not.toBe(last);
    expect(end1).not.toBe(end2);
    first[0] = K.Error;
    first[1].kind = K.Error;
    first[1].text = 'changed';
    first[1].children.push(space);
    end1[0] = K.Error;
    end1[1].text = 'changed EOF';
    expect([last[0], last[1].text, end2[0], end2[1].text, end3.kind, end3.text]).toEqual([K.Ident, 'y', K.End, '', K.End, '']);
    lexer.jump(0);
    const again = lexer.nextNode();
    expect([again.kind, again.text, again.len, lexer.cursor()]).toEqual([K.Ident, 'x', 1, 1]);
    expect(again).not.toBe(first[1]);
  });

  it('isolates cloned cursors, jumps, modes and returned nodes', () => {
    const lexer = new Lexer('😀\r\nalpha', SyntaxMode.Math);
    const first = lexer.nextNode();
    expect([first.kind, first.text, first.len, lexer.cursor()]).toEqual([K.MathText, '😀', 2, 2]);
    const clone = lexer.clone();
    const newline = clone.next();
    expect([newline[0], newline[1].text, clone.cursor(), clone.newline]).toEqual([K.Space, '\r\n', 4, true]);
    expect([lexer.cursor(), lexer.newline, lexer.mode]).toEqual([2, false, SyntaxMode.Math]);
    clone.jump(4);
    clone.mode = SyntaxMode.Markup;
    const text = clone.nextNode();
    expect([text.kind, text.text, clone.cursor(), clone.newline]).toEqual([K.Text, 'alpha', 9, false]);
    const originalNewline = lexer.nextNode();
    expect(originalNewline).not.toBe(newline[1]);
    expect([originalNewline.kind, originalNewline.text, lexer.cursor(), lexer.newline]).toEqual([K.Space, '\r\n', 4, true]);
    const ident = lexer.nextNode();
    text.kind = K.Error;
    text.text = 'changed clone';
    expect([ident.kind, ident.text, lexer.mode]).toEqual([K.MathIdent, 'alpha', SyntaxMode.Math]);
  });

  it('preserves actual kinds across code, markup and math mode transitions', () => {
    const lexer = new Lexer('#let x = 1\r\n$😀$', SyntaxMode.Markup);
    const expected = [
      [SyntaxMode.Markup, K.Hash, '#', 1, false],
      [SyntaxMode.Code, K.Let, 'let', 4, false],
      [SyntaxMode.Code, K.Space, ' ', 5, false],
      [SyntaxMode.Code, K.Ident, 'x', 6, false],
      [SyntaxMode.Code, K.Space, ' ', 7, false],
      [SyntaxMode.Code, K.Eq, '=', 8, false],
      [SyntaxMode.Code, K.Space, ' ', 9, false],
      [SyntaxMode.Code, K.Int, '1', 10, false],
      [SyntaxMode.Code, K.Space, '\r\n', 12, true],
      [SyntaxMode.Markup, K.Dollar, '$', 13, false],
      [SyntaxMode.Math, K.MathText, '😀', 15, false],
      [SyntaxMode.Math, K.Dollar, '$', 16, false],
      [SyntaxMode.Markup, K.End, '', 16, false],
    ] as const;
    for (const [mode, kind, text, cursor, newline] of expected) {
      lexer.mode = mode;
      const node = lexer.nextNode();
      expect([node.kind, node.fullText(), lexer.cursor(), lexer.newline]).toEqual([kind, text, cursor, newline]);
    }
  });
});

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
