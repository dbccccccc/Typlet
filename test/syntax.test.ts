// Checks Typlet's parser against typst-syntax: every formula in the corpus must
// produce the same syntax tree as the oracle's `cst` fixture (docs/DESIGN.md §5.3).

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SyntaxKind, type SyntaxNode, parse, parseCode, parseMath } from '../src/syntax/index.js';
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

describe('the parser follows an else-if chain without recursion', () => {
  // typst-syntax parses each `else if` by recursion, and its depth check
  // doesn't count them. The recursive parser overflowed V8's stack at 6,500
  // to 8,300 branches, depending on what the JIT had compiled; the chain is
  // parsed in a loop, and must give the tree the recursion gave.
  const branches = 10000;
  const code = 'if false{}else '.repeat(branches) + '{}';

  /** The conditionals from the outermost in, each the last child of the one before. */
  function chain(root: SyntaxNode): SyntaxNode[] {
    const out: SyntaxNode[] = [];
    for (let node: SyntaxNode | undefined = root.children.find((c) => c.kind === SyntaxKind.Conditional); node; ) {
      out.push(node);
      const last: SyntaxNode | undefined = node.children.at(-1);
      node = last?.kind === SyntaxKind.Conditional ? last : undefined;
    }
    return out;
  }

  it.each([
    ['code', () => parseCode(code), code],
    ['math', () => parseMath(`#{${code}}`), `#{${code}}`],
  ] as const)('in %s', (_, parseChain, source) => {
    const root = parseChain();
    expect(root.erroneous()).toBe(false);
    expect(root.fullText()).toBe(source);
    const conditionals = [...root.walk()].filter(({ node }) => node.kind === SyntaxKind.Conditional);
    expect(conditionals).toHaveLength(branches);
    // Each `else if` is the else branch of the conditional before it, as
    // the recursion nests them, and the chain ends in the plain else block.
    const start = root.kind === SyntaxKind.Code ? root : [...root.walk()].find(({ node }) => node.kind === SyntaxKind.Code)!.node;
    const nested = chain(start);
    expect(nested).toHaveLength(branches);
    expect(nested.at(-1)!.children.at(-1)!.kind).toBe(SyntaxKind.CodeBlock);
    expect(nested.every((node) => node.children[0]!.kind === SyntaxKind.If)).toBe(true);
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
