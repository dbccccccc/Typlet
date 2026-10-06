import { describe, expect, it } from 'vitest';
import { markEager } from '../scripts/lib/eager.mjs';
import { checkHeaders, ORIGINAL_MARKER, parseHeader } from '../scripts/lib/headers.mjs';
import { brotliSize, checkBudgets } from '../scripts/lib/size.mjs';
import { decodeMappings, encodeMappings } from '../scripts/lib/sourcemap.mjs';

const PORTED = [
  '// Ported from Typst 0.15.1: crates/typst-syntax/src/lexer.rs',
  '// Copyright The Typst Project Developers. Licensed under Apache-2.0.',
  '// Modified for Typlet. See THIRD_PARTY_NOTICES.md.',
  'export const x = 1;',
].join('\n');

const UPSTREAM = '| `src/syntax/` | `crates/typst-syntax/src/lexer.rs` | — | Planned |';

describe('header check', () => {
  it('parses ported and original headers', () => {
    expect(parseHeader(PORTED)).toEqual({
      kind: 'ported',
      project: 'Typst',
      version: '0.15.1',
      upstream: ['crates/typst-syntax/src/lexer.rs'],
    });
    expect(parseHeader(`${ORIGINAL_MARKER}\ncode`)).toEqual({ kind: 'original' });
    expect(parseHeader('export const x = 1;')).toBeNull();
  });

  it('accepts a correct ported file', () => {
    expect(checkHeaders([{ path: 'src/syntax/lexer.ts', text: PORTED }], UPSTREAM, '0.15.1')).toEqual([]);
  });

  it('accepts Windows line endings', () => {
    const text = PORTED.replaceAll('\n', '\r\n');
    expect(checkHeaders([{ path: 'src/syntax/lexer.ts', text }], UPSTREAM, '0.15.1')).toEqual([]);
  });

  it('requires a header in ported directories', () => {
    const problems = checkHeaders([{ path: 'src/layout/run.ts', text: 'code' }], UPSTREAM, '0.15.1');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('missing header');
  });

  it('does not require a header elsewhere', () => {
    expect(checkHeaders([{ path: 'src/html/emit.ts', text: 'code' }], UPSTREAM, '0.15.1')).toEqual([]);
  });

  it('rejects ports of another Typst version', () => {
    const text = PORTED.replace('0.15.1', '0.14.2');
    expect(checkHeaders([{ path: 'src/syntax/lexer.ts', text }], UPSTREAM, '0.15.1')[0]).toContain('0.14.2');
  });

  it('rejects upstream files missing from docs/UPSTREAM.md', () => {
    const text = PORTED.replace('lexer.rs', 'parser.rs');
    expect(checkHeaders([{ path: 'src/syntax/parser.ts', text }], UPSTREAM, '0.15.1')[0]).toContain('not listed');
  });

  it('accepts several upstream files and checks each one', () => {
    const text = PORTED.replace('lexer.rs', 'lexer.rs, crates/typst-syntax/src/parser.rs');
    expect(parseHeader(text)).toMatchObject({
      upstream: ['crates/typst-syntax/src/lexer.rs', 'crates/typst-syntax/src/parser.rs'],
    });
    const problems = checkHeaders([{ path: 'src/syntax/lexer.ts', text }], UPSTREAM, '0.15.1');
    expect(problems).toEqual([
      'src/syntax/lexer.ts: upstream file crates/typst-syntax/src/parser.rs is not listed in docs/UPSTREAM.md',
    ]);
  });

  it('accepts ports from codex, checked against its own version', () => {
    const text = PORTED.replace('Typst 0.15.1: crates/typst-syntax/src/lexer.rs', 'codex 0.3.0: src/styling.rs');
    const upstream = `${UPSTREAM}\n| \`src/utils/styling.ts\` | codex 0.3.0, \`src/styling.rs\` | 0.3.0 | Ported |`;
    expect(parseHeader(text)).toMatchObject({ project: 'codex', version: '0.3.0', upstream: ['src/styling.rs'] });
    expect(checkHeaders([{ path: 'src/utils/styling.ts', text }], upstream, '0.15.1', '0.3.0')).toEqual([]);
    expect(checkHeaders([{ path: 'src/utils/styling.ts', text }], upstream, '0.15.1', '0.4.0')[0]).toContain(
      'ported from codex 0.3.0, but Typlet targets 0.4.0',
    );
    const wrongPath = text.replace('src/styling.rs', 'crates/typst-syntax/src/lexer.rs');
    expect(checkHeaders([{ path: 'src/utils/styling.ts', text: wrongPath }], upstream, '0.15.1')[0]).toContain(
      'codex paths start with src/',
    );
  });

  it('rejects malformed port headers anywhere', () => {
    const text = '// Ported from typst lexer.rs\ncode';
    expect(checkHeaders([{ path: 'src/html/x.ts', text }], UPSTREAM, '0.15.1')[0]).toContain('malformed');
  });

  it('skips test files', () => {
    expect(checkHeaders([{ path: 'src/syntax/lexer.test.ts', text: 'code' }], UPSTREAM, '0.15.1')).toEqual([]);
  });
});

describe('size check', () => {
  it('compares brotli sizes with budgets', () => {
    expect(checkBudgets({ a: 100, b: 100, c: 100 }, { a: 50, b: 150, c: null })).toEqual([
      { file: 'a', limit: 100, size: 50, ok: true },
      { file: 'b', limit: 100, size: 150, ok: false },
      { file: 'c', limit: 100, size: null, ok: false },
    ]);
  });

  it('compresses repetitive input well', () => {
    expect(brotliSize(Buffer.from('typlet '.repeat(1000)))).toBeLessThan(100);
  });
});

describe('source map mappings', () => {
  it('decodes segments with absolute fields', () => {
    // The second line's fields continue from the first's, but its column starts over.
    expect(decodeMappings('AAAA,IAAMA;;EACD,gCAAC')).toEqual([
      [
        [0, 0, 0, 0],
        [4, 0, 0, 6, 0],
      ],
      [],
      [
        [2, 0, 1, 5],
        [34, 0, 1, 6],
      ],
    ]);
  });

  it('encodes what it decodes', () => {
    const lines = [[[0, 0, 0, 0], [7, 0, 0, 12, 0], [40, 1, 300, 2, 5]], [], [[3, 0, 2, 0], [1000, 2, 0, 70000, 1]], [[5]]];
    expect(decodeMappings(encodeMappings(lines))).toEqual(lines);
    const mappings = 'AAAA,IAAMA;;EACD,gCAAC,2/BAAnB;A';
    expect(encodeMappings(decodeMappings(mappings))).toBe(mappings);
  });
});

describe('eager marking', () => {
  // A bundle as esbuild prints one, and the ranges V8 reports for its functions.
  const CODE = [
    'var table = { a: 1 };',
    'function first(a) {',
    '  return [a].map((x) => x + 1);',
    '}',
    'async function second(a) {',
    '  return a;',
    '}',
    'var third = function(a) {',
    '  return a;',
    '};',
    'var Klass = class {',
    '  method(a) {',
    '    return a;',
    '  }',
    '};',
    'function unused() {',
    '  return 0;',
    '}',
    '',
  ].join('\n');
  const range = (text: string) => ({ start: CODE.indexOf(text), end: CODE.indexOf(text) + text.length });
  const RANGES = [
    range('function first(a) {\n  return [a].map((x) => x + 1);\n}'),
    range('(x) => x + 1'),
    range('async function second(a) {\n  return a;\n}'),
    range('function(a) {\n  return a;\n}'),
    range('method(a) {\n    return a;\n  }'),
  ];

  it('puts called functions in parentheses, and declarations first', () => {
    const { code, counts } = markEager(CODE, null, RANGES);
    expect(code.split('\n')).toEqual([
      'var first = (function(a) {',
      '  return [a].map(((x) => x + 1));',
      '});',
      'var second = (async function(a) {',
      '  return a;',
      '});',
      'var table = { a: 1 };',
      'var third = (function(a) {',
      '  return a;',
      '});',
      'var Klass = class {',
      '  method(a) {',
      '    return a;',
      '  }',
      '};',
      'function unused() {',
      '  return 0;',
      '}',
      '',
    ]);
    expect(counts).toEqual({ declarations: 2, expressions: 2, unmarked: 1 });
  });

  it('keeps what the bundle does', () => {
    const run = (code: string) => new Function(`${code}; return [first(1), third(2), new Klass().method(3), unused()];`)();
    expect(run(markEager(CODE, null, RANGES).code)).toEqual(run(CODE));
  });

  it('leaves nested declarations and exported functions alone', () => {
    const code = ['function outer() {', '  function inner() {', '    return 1;', '  }', '  return inner();', '}', 'export default function() {', '  return 2;', '}', ''].join('\n');
    const inner = '  function inner() {\n    return 1;\n  }'.trimStart();
    const exported = 'function() {\n  return 2;\n}';
    const ranges = [inner, exported].map((text) => ({ start: code.indexOf(text), end: code.indexOf(text) + text.length }));
    expect(markEager(code, null, ranges)).toMatchObject({ code, counts: { declarations: 0, expressions: 0, unmarked: 2 } });
  });

  it('updates the source map', () => {
    // One segment at the start of each line, and segments at the name and
    // the parameters of `first`, and around the arrow function.
    const lines = CODE.split('\n').map((_, line) => [[0, 0, line, 0]]);
    lines[1]!.push([9, 0, 1, 9], [14, 0, 1, 14]);
    lines[2]!.push([17, 0, 2, 17], [29, 0, 2, 29]);
    const { map } = markEager(CODE, { version: 3, sources: ['a.ts'], mappings: encodeMappings(lines) }, RANGES);
    const marked = decodeMappings(map!.mappings);
    // `var first = (function(a) {`: the name is at 4 and the parameters at 21.
    expect(marked[0]).toEqual([[0, 0, 1, 0], [4, 0, 1, 9], [21, 0, 1, 14]]);
    // `  return [a].map(((x) => x + 1));`
    expect(marked[1]).toEqual([[0, 0, 2, 0], [18, 0, 2, 17], [31, 0, 2, 29]]);
    // The first line of the bundle comes after the two declarations.
    expect(marked[6]).toEqual([[0, 0, 0, 0]]);
    expect(marked[7]).toEqual([[0, 0, 7, 0]]);
  });
});
