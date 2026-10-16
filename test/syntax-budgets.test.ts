import { describe, expect, it } from 'vitest';
import { renderToResult, TypletError } from '../src/index.js';
import { SyntaxNode } from '../src/syntax/node.js';
import { LinkedNode, firstExpr } from '../src/syntax/ast.js';
import { parseCode } from '../src/syntax/parser.js';
import { evalExpr } from '../src/eval/code.js';
import { newEngine, withRuleDepth } from '../src/eval/func.js';
import { LIBRARY } from '../src/eval/library.js';
import { Vm } from '../src/eval/vm.js';
import { SyntaxKind as K } from '../src/syntax/kind.js';
import { SourceError } from '../src/eval/diag.js';
import { checkSyntaxDepth } from '../src/eval/syntax-budget.js';
import { evalFormula, evalPreamble } from '../src/eval/index.js';
import { evalCorpusFormula, evalExpression } from './eval-helpers.js';

function failure(source: string, options = {}): TypletError {
  try { renderToResult(source, { output: 'mathml', strict: 'ignore', ...options }); }
  catch (error) { if (!(error instanceof TypletError)) throw error; return error; }
  throw new Error('expected a syntax resource error');
}

describe('bounded expression compatibility', () => {
  it.each([
    ['1 + 2 + 3 + 4', 10],
    ['10 - 3 - 2', 5],
    ['2 + 3 * 4', 14],
    ['false and unknownname', false],
    ['true or unknownname', true],
    ['{ let x = 0; let y = x + 1; let z = y + 2; z }', 3],
  ])('keeps the value of %s', (source, expected) => {
    const result = evalExpression(source);
    expect(result.value?.json).toBe(expected);
    expect(result.diagnostics).toEqual([]);
  });

  it('keeps left-to-right error order', () => {
    expect(evalExpression('unknown_value + unknownname').diagnostics[0]?.message).toBe('unknown variable: unknown_value');
  });

  it('keeps the exact existing function depth boundary', () => {
    const preamble = '#let f(n) = if n == 0 { 0 } else { f(n - 1) }';
    expect(renderToResult('#f(79)', { preamble, output: 'mathml', strict: 'ignore' }).markup).toContain('<mn>0</mn>');
    const error = failure('#f(80)', { preamble });
    expect(error.kind).toBe('eval');
    expect(error.message).toBe('maximum function call depth exceeded');
  });
});

function tree(depth: number): SyntaxNode {
  let node = SyntaxNode.leaf(K.Ident, 'x');
  for (let i = 0; i < depth; i++) node = SyntaxNode.inner(K.Binary, [node]);
  return node;
}
function sourceLimit(body: () => unknown): SourceError {
  try { body(); }
  catch (error) {
    if (!(error instanceof SourceError)) throw error;
    expect(error.diagnostics[0]?.kind).toBe('limit');
    return error;
  }
  throw new Error('expected a source limit');
}

describe('raw syntax depth budget', () => {
  it('counts a root leaf at depth zero', () => {
    expect(checkSyntaxDepth(tree(0))).toBeUndefined();
  });

  it('accepts depth 256 and refuses depth 257', () => {
    expect(checkSyntaxDepth(tree(256))).toBeUndefined();
    expect(sourceLimit(() => checkSyntaxDepth(tree(257))).diagnostics[0]?.span).toEqual({ start: 0, end: 1 });
  });

  it('keeps separate trees independent', () => {
    for (let i = 0; i < 2; i++) expect(checkSyntaxDepth(tree(256))).toBeUndefined();
    sourceLimit(() => checkSyntaxDepth(tree(257)));
    expect(checkSyntaxDepth(tree(256))).toBeUndefined();
  });

  it('does not call recursive node helpers', () => {
    const root = tree(256);
    const forbidden = () => { throw new Error('recursive consumer called'); };
    root.fullText = forbidden;
    root.erroneous = forbidden;
    root.diagnostics = forbidden;
    expect(checkSyntaxDepth(root)).toBeUndefined();
  });

  it('reports UTF-16 offsets and the preamble file', () => {
    const root = SyntaxNode.inner(K.Markup, [SyntaxNode.leaf(K.Text, '😀a'), tree(256)]);
    expect(sourceLimit(() => checkSyntaxDepth(root, 'preamble')).diagnostics[0]?.span).toEqual({ start: 3, end: 4, file: 'preamble' });
  });

  it('guards a direct formula evaluation entry', () => {
    sourceLimit(() => evalFormula(tree(257), false));
  });

  it('guards a direct preamble evaluation entry', () => {
    expect(sourceLimit(() => evalPreamble(tree(257))).diagnostics[0]?.span?.file).toBe('preamble');
  });
});

describe('iterative syntax traversal', () => {
  it('reads and converts a deep raw tree without recursive text traversal', () => {
    const root = tree(300);
    expect(root.fullText()).toBe('x');
    expect(root.erroneous()).toBe(false);
    expect(root.diagnostics()).toEqual([]);
    root.convertToError('converted');
    expect(root.fullText()).toBe('x');
    expect(root.children).toEqual([]);
    expect(root.erroneous()).toBe(true);
  });

  it('keeps warning and error order with absolute UTF-16 offsets', () => {
    const first = SyntaxNode.leaf(K.Text, '😀');
    first.warn('first');
    const error = SyntaxNode.error('nested error', 'x').withHints(['nested hint']);
    let deep = error;
    for (let i = 0; i < 300; i++) deep = SyntaxNode.inner(K.Binary, [deep]);
    deep.warnAt([0, 1], 'nested warning');
    const last = SyntaxNode.error('last error', 'y');
    last.warn('last warning');
    const root = SyntaxNode.inner(K.Markup, [first, deep, last]);
    root.warn('root');
    expect(root.fullText()).toBe('😀xy');
    expect(root.erroneous()).toBe(true);
    expect(root.diagnostics(7)).toEqual([
      { severity: 'warning', message: 'root', hints: [], start: 7, end: 11 },
      { severity: 'warning', message: 'first', hints: [], start: 7, end: 9 },
      { severity: 'warning', message: 'nested warning', hints: [], start: 9, end: 10 },
      { severity: 'error', message: 'nested error', hints: ['nested hint'], start: 9, end: 10 },
      { severity: 'warning', message: 'last warning', hints: [], start: 10, end: 11 },
      { severity: 'error', message: 'last error', hints: [], start: 10, end: 11 },
    ]);
  });

  it('clones deep syntax nodes and metadata containers independently', () => {
    const leaf = SyntaxNode.error('original', 'x').withHints(['error hint']);
    leaf.warn('warning');
    leaf.hint('warning hint');
    let root = leaf;
    for (let i = 0; i < 300; i++) root = SyntaxNode.inner(K.Binary, [root]);
    const clone = root.deepClone();
    expect(clone.fullText()).toBe('x');
    expect(clone.diagnostics()).toEqual(root.diagnostics());
    expect(clone).not.toBe(root);
    let original = root;
    let copied = clone;
    for (let i = 0; i < 300; i++) {
      expect(copied.children).not.toBe(original.children);
      original = original.children[0]!;
      copied = copied.children[0]!;
      expect(copied).not.toBe(original);
    }
    expect(copied.error).not.toBe(original.error);
    expect(copied.error!.hints).not.toBe(original.error!.hints);
    expect(copied.warnings).not.toBe(original.warnings);
    expect(copied.warnings![0]).not.toBe(original.warnings![0]);
    expect(copied.warnings![0]!.hints).not.toBe(original.warnings![0]!.hints);
    copied.text = 'y';
    copied.error!.message = 'changed';
    copied.error!.hints.push({ message: 'copy error hint' });
    copied.warnings![0]!.hints.push({ message: 'copy warning hint' });
    copied.warnings!.push({ message: 'copy warning', hints: [] });
    clone.children.push(SyntaxNode.leaf(K.Text, 'z'));
    expect(root.fullText()).toBe('x');
    expect(root.children).toHaveLength(1);
    expect(original.error).toEqual({ message: 'original', hints: [{ message: 'error hint' }] });
    expect(original.warnings).toEqual([{ message: 'warning', hints: [{ message: 'warning hint' }] }]);
  });
});

const flat = Array(300).fill('1').join('+');
describe('syntax budget entry points', () => {
  it('keeps existing parser-depth syntax errors', () => {
    const error = failure('('.repeat(300) + 'x' + ')'.repeat(300));
    expect(error.kind).toBe('syntax');
    expect(error.message).toBe('maximum parsing depth exceeded');
  });

  it('keeps malformed flat-chain diagnostics', () => {
    const result = evalExpression(flat + '+');
    expect(result.value).toBeNull();
    expect(result.diagnostics).toEqual([{ severity: 'error', message: 'expected expression' }]);
  });

  it('converts formula rejection to a typed public error', () => {
    const source = '#(' + flat + ')';
    const error = failure(source);
    expect(error.kind).toBe('limit');
    expect(error.span?.start).toBeGreaterThanOrEqual(0);
    expect(error.span?.end).toBeLessThanOrEqual(source.length);
    expect(error.diagnostics[0]?.in).toBe('formula');
  });

  it('checks formula depth before evaluating a failing preamble', () => {
    const error = failure('#(' + flat + ')', { preamble: '#let x = unknown_value' });
    expect(error.kind).toBe('limit');
    expect(error.diagnostics[0]?.in).toBe('formula');
  });

  it('renders a rejected tree when throwing is disabled', () => {
    const result = renderToResult('#(' + flat + ')', { throwOnError: false, strict: 'ignore' });
    expect(result.drawnAs).toBe('error');
    expect(result.markup).toContain('typlet-error');
    expect(result.markup).toContain('syntax tree depth');
  });

  it('marks cached preamble failures as preamble diagnostics', () => {
    const preamble = '#let value = ' + flat;
    for (let i = 0; i < 2; i++) {
      const error = failure('x', { preamble });
      expect(error.kind).toBe('limit');
      expect(error.diagnostics[0]?.in).toBe('preamble');
      expect(error.span?.end).toBeLessThanOrEqual(preamble.length);
    }
  });

  it('refuses deep valid expression trees in the direct helper', () => {
    const result = evalExpression(flat);
    expect(result.value).toBeNull();
    expect(result.diagnostics[0]?.message).toContain('syntax tree depth');
  });

  it('refuses deep valid corpus-helper preambles', () => {
    expect(sourceLimit(() => evalCorpusFormula({ id: 'depth', src: 'x', display: false, preamble: '#let value = ' + flat })).diagnostics[0]?.span?.file).toBe('preamble');
  });

  it('can reject a deep branch before short-circuit evaluation', () => {
    expect(failure('#(false and (' + flat + '))').kind).toBe('limit');
  });

  it('starts the next render normally after a rejection', () => {
    expect(failure('#(' + flat + ')').kind).toBe('limit');
    expect(renderToResult('#(1 + 2)', { strict: 'ignore' }).markup).toContain('<mn>3</mn>');
  });
});

describe('active evaluation depth', () => {
  const expression = (source: string, file?: 'preamble') => firstExpr(new LinkedNode(parseCode(source), 0, file));

  it('restores the engine counter after success and evaluation errors', () => {
    const engine = newEngine();
    const vm = new Vm(engine, LIBRARY);
    expect(engine.evalDepth).toBe(0);
    expect(evalExpr(vm, expression('1 + 2'))).toEqual({ type: 'int', v: 3n });
    expect(engine.evalDepth).toBe(0);
    expect(() => evalExpr(vm, expression('unknown_value'))).toThrow(SourceError);
    expect(engine.evalDepth).toBe(0);
    expect(evalExpr(vm, expression('4'))).toEqual({ type: 'int', v: 4n });
  });

  it('allows 512 active expressions and restores the caller after rejection', () => {
    const engine = newEngine();
    const vm = new Vm(engine, LIBRARY);
    engine.evalDepth = 510;
    expect(evalExpr(vm, expression('(1)'))).toEqual({ type: 'int', v: 1n });
    expect(engine.evalDepth).toBe(510);
    engine.evalDepth = 511;
    const error = sourceLimit(() => evalExpr(vm, expression('(1)', 'preamble')));
    expect(error.diagnostics[0]?.message).toBe('Typlet stopped at an evaluation depth of more than 512');
    expect(error.diagnostics[0]?.span).toEqual({ start: 1, end: 2, file: 'preamble' });
    expect(engine.evalDepth).toBe(511);
    engine.evalDepth = 0;
    expect(evalExpr(vm, expression('4'))).toEqual({ type: 'int', v: 4n });
    expect(engine.evalDepth).toBe(0);
  });

  it('counts rule tails and expressions in the same active stack', () => {
    const engine = newEngine();
    const vm = new Vm(engine, LIBRARY);
    engine.evalDepth = 511;
    sourceLimit(() => withRuleDepth(engine, null, () => evalExpr(vm, expression('1'))));
    expect(engine.evalDepth).toBe(511);
    expect(engine.ruleDepth).toBe(0);
    engine.evalDepth = 512;
    let called = false;
    sourceLimit(() => withRuleDepth(engine, null, () => { called = true; }));
    expect(called).toBe(false);
    expect(engine.ruleDepth).toBe(0);
    engine.ruleDepth = 256;
    expect(sourceLimit(() => withRuleDepth(engine, null, () => {})).diagnostics[0]?.message).toBe('Typlet stopped at a rule depth of more than 256');
  });
});
