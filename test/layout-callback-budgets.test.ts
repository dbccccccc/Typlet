import { describe, expect, it } from 'vitest';
import { type RenderOptions, renderToResult, TypletError } from '../src/index.js';
import { type Engine, type Func, DEFAULT_LIMITS, newEngine } from '../src/eval/func.js';
import { evalFormula } from '../src/eval/index.js';
import { type Content, textElem } from '../src/eval/content.js';
import { SourceError } from '../src/eval/diag.js';
import { angleCast } from '../src/eval/cast.js';
import { arrayValue, intValue, repr } from '../src/eval/value.js';
import { checkCollectionSize, checkStringLength, withCollectionLimits } from '../src/eval/ops.js';
import { MathContext, layoutInline, layoutNumberedBlock } from '../src/layout/math.js';
import { getLayoutEngine, withLayoutEngine } from '../src/layout/engine.js';
import { equationStyles, resolveEquation } from '../src/ir/resolve.js';
import { parseMath } from '../src/syntax/parser.js';

function failure(source: string, options: RenderOptions = {}): TypletError {
  try { renderToResult(source, { strict: 'ignore', ...options }); }
  catch (error) {
    if (!(error instanceof TypletError)) throw error;
    return error;
  }
  throw new Error('expected a callback budget error, but rendering succeeded');
}

describe.each(['html', 'htmlAndMathml'] as const)('layout callback budgets in %s', (output) => {
  it('shares calls already consumed by formula evaluation', () => {
    expect(failure('cancel(x, angle: #(a => a))', { output, maxCalls: 1 }).kind).toBe('limit');
  });

  it('shares calls between the two cross lines', () => {
    expect(failure('cancel(x, cross: #true, angle: #(a => a))', { output, maxCalls: 2 }).kind).toBe('limit');
  });

  it('keeps the caller representation limit inside a delayed callback', () => {
    expect(failure('cancel(x, angle: #(a => { let text = [#(1, 2)]; a }))', { output, maxStringLength: 5 }).kind).toBe('limit');
  });
});


describe.each(['html', 'htmlAndMathml'] as const)('callback boundaries in %s', (output) => {
  it.each([
    ['cancel(x, angle: #(a => a))', 2, {}],
    ['cancel(x, cross: #true, angle: #(a => a))', 3, {}],
    ['cancel(x, angle: #(a => a)) cancel(y, angle: #(a => a))', 4, {}],
    ['#box[$cancel(x, angle: #(a => a))$]', 3, {}],
    ['cancel(x, angle: #(a => a))', 2, { displayMode: true, preamble: '#set math.equation(numbering: "(1)")' }],
  ] as [string, number, RenderOptions][])('counts each callback once in %s', (source, calls, options) => {
    expect(renderToResult(source, { ...options, output, maxCalls: calls, strict: 'ignore' }).drawnAs).toBe('html');
    expect(failure(source, { ...options, output, maxCalls: calls - 1 }).kind).toBe('limit');
  });

  it('uses the caller string construction limit', () => {
    const source = 'cancel(x, angle: #(a => { let s = "aa" * 3; a }))';
    expect(renderToResult(source, { output, maxStringLength: 6, strict: 'ignore' }).drawnAs).toBe('html');
    expect(failure(source, { output, maxStringLength: 5 }).kind).toBe('limit');
  });

  it('uses the caller collection construction limit', () => {
    const source = 'cancel(x, angle: #(a => { let values = (1, 2, 3); a }))';
    expect(renderToResult(source, { output, maxCollectionSize: 3, strict: 'ignore' }).drawnAs).toBe('html');
    expect(failure(source, { output, maxCollectionSize: 2 }).kind).toBe('limit');
  });
});

const styles = equationStyles(false);
function cancelItem(func: Func, cross = false) {
  const content: Content = { func: 'cancel', body: textElem('x'), angle: { func }, cross, span: { start: 0, end: 1 } };
  return resolveEquation(content, styles, []);
}
function angleCallback(action: (engine: Engine) => void): Func {
  return { name: 'controlled-angle', params: [], call(engine, args) {
    const angle = args.expect('angle', angleCast);
    action(engine);
    return { type: 'angle', v: angle };
  } };
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

describe('layout engine lifetime', () => {
  it('retains the actual evaluation engine for layout', () => {
    const evaluated = evalFormula(parseMath('cancel(x, angle: #(a => a))'), false);
    expect(evaluated.engine.calls).toBe(1);
    withLayoutEngine(evaluated.engine, evaluated.warnings, () => layoutInline(resolveEquation(evaluated.equation.body, styles, []), [], styles));
    expect(evaluated.engine.calls).toBe(2);
  });

  it('keeps independent renders and cached preambles independent', () => {
    const options = { preamble: '#let angle(a) = a', maxCalls: 2, strict: 'ignore' as const };
    for (let i = 0; i < 2; i++) expect(renderToResult('cancel(x, angle: #angle)', options).drawnAs).toBe('html');
    expect(failure('cancel(x, angle: #angle)', { ...options, maxCalls: 1 }).kind).toBe('limit');
    expect(renderToResult('cancel(x, angle: #angle)', options).drawnAs).toBe('html');
  });

  it('does not execute an ignored angle callback in MathML', () => {
    expect(renderToResult('cancel(x, angle: #(a => unknownname))', { output: 'mathml', maxCalls: 1, strict: 'ignore' }).drawnAs).toBe('mathml');
  });

  it('keeps callback warnings once and after prior evaluation warnings', () => {
    const result = renderToResult('gt.tri + cancel(x, cross: #true, angle: #(a => { let t = sym.lt.tri; a }))', { strict: 'ignore' });
    expect(result.warnings.map((warning) => warning.message)).toEqual([
      '`gt.tri` is deprecated, use `gt.closed` instead',
      '`lt.tri` is deprecated, use `lt.closed` instead',
    ]);
    expect(result.warnings.map((warning) => warning.kind)).toEqual(['deprecation', 'deprecation']);
  });

  it('has one bounded default engine per direct context', () => {
    const first = new MathContext([], 'start');
    const second = new MathContext([], 'start');
    expect(first.engine).not.toBe(second.engine);
    expect(first.engine.limits).toEqual(DEFAULT_LIMITS);
    const calls: number[] = [];
    const func = angleCallback((engine) => { expect(engine).toBe(first.engine); calls.push(engine.calls); });
    first.layoutIntoFragment(cancelItem(func, true), styles);
    expect(calls).toEqual([1, 2]);
    expect(first.engine.calls).toBe(2);
  });

  it('activates a held direct-context engine around nested boxes', () => {
    const engine = newEngine({ ...DEFAULT_LIMITS, calls: 1 });
    const func = angleCallback((seen) => expect(seen).toBe(engine));
    const cancel: Content = { func: 'cancel', body: textElem('x'), angle: { func }, span: null };
    const box: Content = { func: 'box', body: { func: 'equation', body: cancel, span: null }, span: null };
    const item = resolveEquation({ func: 'sequence', children: [box, box], span: null }, styles, []);
    const ctx = withLayoutEngine(engine, [], () => new MathContext([], 'start'));
    sourceLimit(() => ctx.layoutIntoFragments(item, styles));
    expect(engine.calls).toBe(2);
  });

  it('shares the same engine with an equation in a number', () => {
    const engine = newEngine({ ...DEFAULT_LIMITS, calls: 1 });
    const func = angleCallback((seen) => expect(seen).toBe(engine));
    const number: Content = { func: 'equation', body: { func: 'cancel', body: textElem('x'), angle: { func }, span: null }, span: null };
    withLayoutEngine(engine, [], () => sourceLimit(() => layoutNumberedBlock(cancelItem(func), [], styles, number)));
    expect(engine.calls).toBe(2);
  });

  it('keeps cumulative value visits across cross callbacks', () => {
    const engine = newEngine();
    for (let i = 0; i < 99_997; i++) engine.values.visit();
    const func = angleCallback((seen) => { expect(seen).toBe(engine); repr(arrayValue([intValue(1n)])); });
    withLayoutEngine(engine, [], () => sourceLimit(() => layoutInline(cancelItem(func, true), [], styles)));
    expect(engine.calls).toBe(2);
  });

  it('restores engine and construction limits after nested render success and output failure', () => {
    const engine = newEngine({ ...DEFAULT_LIMITS, collectionSize: 2, stringLength: 5 });
    const func = angleCallback((seen) => {
      expect(seen).toBe(engine);
      expect(getLayoutEngine()).toBe(engine);
      expect(renderToResult('cancel(x, angle: #(a => a))', { maxCalls: 2, maxCollectionSize: 10, maxStringLength: 20, strict: 'ignore' }).drawnAs).toBe('html');
      expect(getLayoutEngine()).toBe(engine);
      expect(failure('cancel(x, angle: #(a => a))', { maxCalls: 1, maxCollectionSize: 10, maxStringLength: 20 }).kind).toBe('limit');
      expect(getLayoutEngine()).toBe(engine);
      checkCollectionSize(2);
      checkStringLength(5);
      expect(() => checkCollectionSize(3)).toThrow('more than 2 items');
      expect(() => checkStringLength(6)).toThrow('longer than 5 characters');
    });
    withLayoutEngine(engine, [], () => expect(layoutInline(cancelItem(func), [], styles)).toHaveLength(1));
    expect(getLayoutEngine()).not.toBe(engine);
    expect(engine.calls).toBe(1);
  });

  it('restores collection scopes when a callback throws', () => {
    withCollectionLimits(2, 3, () => {
      expect(() => withCollectionLimits(5, 6, () => { throw new Error('controlled'); })).toThrow('controlled');
      checkCollectionSize(2);
      checkStringLength(3);
      expect(() => checkCollectionSize(3)).toThrow('more than 2 items');
      expect(() => checkStringLength(4)).toThrow('longer than 3 characters');
    });
  });
});
