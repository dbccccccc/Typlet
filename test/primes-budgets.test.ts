import { afterEach, describe, expect, it } from 'vitest';
import { type Output, type RenderOptions, TypletError, renderToResult } from '../src/index.js';
import { ElementBudget, SourceError, setElementLimit, unsupported } from '../src/eval/diag.js';
import { type Content, textElem } from '../src/eval/content.js';
import { MathResolver, equationStyles } from '../src/ir/resolve.js';
import { ExpansionBudget, getExpansionBudget, withExpansionBudget } from '../src/eval/expansion-budget.js';
import { type StyleChain } from '../src/eval/styles.js';
import { type MathItem, primesItem, properties } from '../src/ir/item.js';
import { MathContext, layoutBlock, layoutInline, layoutNumberedBlock } from '../src/layout/math.js';
import { layoutPrimes } from '../src/layout/scripts.js';
import { convertMathToNodes } from '../src/mathml/mathml.js';
import { renderWithFallback } from '../src/render.js';

function failure(source: string, options: RenderOptions = {}): TypletError {
  try {
    renderToResult(source, { strict: 'ignore', ...options });
  } catch (error) {
    if (!(error instanceof TypletError)) throw error;
    return error;
  }
  throw new Error('expected a prime expansion limit, but rendering succeeded');
}


afterEach(() => setElementLimit(10_000));


function sourceLimit(body: () => unknown): SourceError {
  try { body(); }
  catch (error) {
    if (!(error instanceof SourceError)) throw error;
    expect(error.diagnostics[0]?.kind).toBe('limit');
    return error;
  }
  throw new Error('expected a source limit');
}

const outputs: Output[] = ['html', 'htmlAndMathml', 'mathml'];

describe.each(outputs)('prime expansion in %s', (output) => {
  it('allows a full expansion in each independent output stage', () => {
    for (const maxElements of [5, 6, 9]) {
      const result = renderToResult('primes(#5)', { output, maxElements, strict: 'ignore' });
      expect(result.drawnAs).toBe(output === 'mathml' ? 'mathml' : 'html');
    }
  });

  it.each([true, false])('bounds one expansion with throwOnError=%s', (throwOnError) => {
    const options = { output, throwOnError, maxElements: 4 };
    if (throwOnError) {
      const error = failure('primes(#5)', options);
      expect(error.kind).toBe('limit');
      expect(error.span).not.toBeNull();
    } else {
      const result = renderToResult('primes(#5)', options);
      expect(result.drawnAs).toBe('error');
      expect(result.warnings).toEqual([]);
    }
  });

  it.each([true, false])('bounds cumulative expansion with throwOnError=%s', (throwOnError) => {
    const options = { output, throwOnError, maxElements: 9 };
    if (throwOnError) expect(failure('primes(#5) primes(#5)', options).kind).toBe('limit');
    else expect(renderToResult('primes(#5) primes(#5)', options).drawnAs).toBe('error');
  });

  it('includes ordinary content in the remaining element allowance', () => {
    expect(failure('a primes(#5)', { output, maxElements: 6 }).kind).toBe('limit');
  });
});


describe('bulk element budgets', () => {
  it('allows exactly the limit across consume and visit', () => {
    const budget = new ElementBudget(5);
    budget.consume(0, null);
    budget.consume(3, null);
    budget.visit(null);
    budget.consume(1, null);
    expect(sourceLimit(() => budget.visit(null)).diagnostics[0]?.message).toBe('Typlet stopped after 5 elements');
  });

  it('does not consume any part of a rejected batch', () => {
    const budget = new ElementBudget(5);
    budget.consume(3, null);
    sourceLimit(() => budget.consume(3, null));
    budget.consume(2, null);
    sourceLimit(() => budget.visit(null));
  });

  it.each([-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid count %s atomically', (count) => {
    const budget = new ElementBudget(2);
    budget.visit(null);
    sourceLimit(() => budget.consume(count, { start: 2, end: 4 }));
    budget.visit(null);
    sourceLimit(() => budget.visit(null));
  });

  it('rejects an unsafe cumulative count before changing it', () => {
    const budget = new ElementBudget(Infinity);
    budget.consume(Number.MAX_SAFE_INTEGER, null);
    sourceLimit(() => budget.visit(null));
    budget.consume(0, null);
  });
});

describe('IR prime preflight', () => {
  const styles = equationStyles(false);
  const primes = (count: number): Content => ({ func: 'primes', count, span: { start: 0, end: 10 } });

  it('accepts an exactly full custom expansion', () => {
    setElementLimit(5);
    const item = new MathResolver([]).resolveIntoItem(primes(5), styles);
    expect(item).toMatchObject({ type: 'component', kind: { tag: 'primes', count: 5 } });
  });

  it('shares the resolver allowance across separately valid expansions', () => {
    setElementLimit(9);
    const resolver = new MathResolver([]);
    resolver.resolveIntoItem(primes(5), styles);
    sourceLimit(() => resolver.resolveIntoItem(primes(5), styles));
  });

  it('checks the output lower bound before emitting an item', () => {
    const resolver = new MathResolver([], 'html', 4);
    sourceLimit(() => resolver.resolveIntoItem(primes(5), styles));
    expect(resolver.items).toEqual([]);
  });

  it('keeps ordinary content in the shared realization budget', () => {
    setElementLimit(6);
    const content: Content = { func: 'sequence', children: [textElem('a'), primes(5)], span: null };
    sourceLimit(() => new MathResolver([]).resolveIntoItem(content, styles));
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid internal prime counts %s', (count) => {
    sourceLimit(() => new MathResolver([]).resolveIntoItem(primes(count), styles));
  });
});


describe('output expansion context', () => {
  it('checks output and element limits atomically', () => {
    for (const budget of [new ExpansionBudget(5, 9), new ExpansionBudget(9, 5)]) {
      budget.consume(3, null);
      sourceLimit(() => budget.consume(3, null));
      budget.consume(2, null);
      sourceLimit(() => budget.visit(null));
    }
  });

  it('restores nested scopes after a return and an exception', () => {
    const outer = new ExpansionBudget(9, 20);
    const inner = new ExpansionBudget(4, 10);
    withExpansionBudget(outer, () => {
      expect(getExpansionBudget()).toBe(outer);
      withExpansionBudget(inner, () => expect(getExpansionBudget()).toBe(inner));
      expect(getExpansionBudget()).toBe(outer);
      expect(() => withExpansionBudget(inner, () => { throw new Error('controlled'); })).toThrow('controlled');
      expect(getExpansionBudget()).toBe(outer);
    });
    expect(getExpansionBudget()).not.toBe(outer);
  });

  it('gives independent standalone contexts bounded default budgets', () => {
    const first = new MathContext([], 'start');
    const second = new MathContext([], 'start');
    expect(first.expansion).not.toBe(second.expansion);
    expect(first.expansion.max).toBe(10_000);
    expect(first.expansion.maxOutputSize).toBe(1_000_000);
  });

  it('does not inherit consumption from an earlier render', () => {
    for (let i = 0; i < 2; i++) {
      expect(renderToResult('primes(#5)', { maxElements: 5, strict: 'ignore' }).drawnAs).toBe('html');
    }
  });

  it('restores an outer output budget after nested renders succeed or fail', () => {
    const result = renderWithFallback('primes(#5)', { maxElements: 5, strict: 'ignore' }, 'html', {
      draw() {
        const outer = getExpansionBudget();
        outer.consume(2, null);
        expect(renderToResult('primes(#5)', { maxElements: 5, strict: 'ignore' }).drawnAs).toBe('html');
        expect(getExpansionBudget()).toBe(outer);
        expect(failure('primes(#6)', { maxElements: 5 }).kind).toBe('limit');
        expect(getExpansionBudget()).toBe(outer);
        expect(failure('#box[$primes(#5)$] #box[$primes(#5)$]', { maxElements: 9 }).kind).toBe('limit');
        expect(getExpansionBudget()).toBe(outer);
        outer.consume(3, null);
        return '<span>outer</span>';
      },
    });
    expect(result).toMatchObject({ drawnAs: 'html' });
  });

  it('uses a fresh MathML allowance after an unsupported HTML draw', () => {
    const result = renderWithFallback('primes(#5)', { maxElements: 5, strict: 'ignore' }, 'html', {
      draw() {
        getExpansionBudget().consume(5, null);
        unsupported(null, 'a controlled backend');
      },
    });
    expect(result).toMatchObject({ drawnAs: 'mathml' });
  });

  it.each(['html', 'htmlAndMathml'] as const)('keeps a fresh MathML allowance on real %s fallback', (output) => {
    const result = renderToResult('primes(#5) #left', { output, maxElements: 9, strict: 'ignore' });
    expect(result.drawnAs).toBe('mathml');
    expect(result.warnings.map((warning) => warning.kind)).toEqual(['fallback']);
  });

  it('does not turn a resource rejection into fallback', () => {
    let fallbackCalls = 0;
    expect(failure('primes(#6)', { maxElements: 5, fallback: () => { fallbackCalls++; return 'fallback'; } }).kind).toBe('limit');
    expect(fallbackCalls).toBe(0);
  });

  it('forwards a tight output bound through target-dependent resolution', () => {
    const error = failure('#strong[$primes(#5)$]', { output: 'html', maxOutputSize: 4 });
    expect(error.kind).toBe('limit');
    expect(error.span).not.toBeNull();
  });
});

const styles = equationStyles(false);
const backendCalls: [string, (item: MathItem, styles: StyleChain) => unknown][] = [
  ['MathML', (item, styles) => convertMathToNodes(item, false, [], undefined, undefined, styles)],
  ['inline layout', (item, styles) => layoutInline(item, [], styles)],
  ['block layout', (item, styles) => layoutBlock(item, [], styles)],
  ['numbered layout', (item, styles) => layoutNumberedBlock(item, [], styles, textElem('1'))],
  ['direct fragments', (item, styles) => new MathContext([], 'start').layoutIntoFragments(item, styles)],
  ['direct fragment', (item, styles) => new MathContext([], 'start').layoutIntoFragment(item, styles)],
];

describe.each(backendCalls)('direct %s expansion', (name, draw) => {
  it('accepts an exact allowance and rejects the next expansion unit', () => {
    // Numbered layout also expands the one character in its equation number.
    const numberUnits = name === 'numbered layout' ? 1 : 0;
    withExpansionBudget(new ExpansionBudget(5 + numberUnits), () => expect(draw(primesItem(5, styles), styles)).toBeDefined());
    withExpansionBudget(new ExpansionBudget(4 + numberUnits), () => sourceLimit(() => draw(primesItem(5, styles), styles)));
  });

  it('checks the output-character lower bound before allocating', () => {
    const budget = new ExpansionBudget(10, 4);
    withExpansionBudget(budget, () => sourceLimit(() => draw(primesItem(5, styles), styles)));
    budget.consume(4, null);
  });

  it('shares one active allowance across separate backend calls', () => {
    withExpansionBudget(new ExpansionBudget(9), () => {
      expect(draw(primesItem(5, styles), styles)).toBeDefined();
      sourceLimit(() => draw(primesItem(5, styles), styles));
    });
  });
});

function primeBoxes(): MathItem {
  const box: Content = { func: 'box', body: { func: 'equation', body: { func: 'primes', count: 5, span: null }, span: null }, span: null };
  return new MathResolver([], 'html').resolveIntoItem({ func: 'sequence', children: [box, box], span: null }, styles);
}

describe('nested prime expansion', () => {
  it.each(backendCalls)('shares an output allowance across boxes in %s', (name, draw) => {
    const item = primeBoxes();
    withExpansionBudget(new ExpansionBudget(9), () => sourceLimit(() => draw(item, styles)));
    withExpansionBudget(new ExpansionBudget(name === 'numbered layout' ? 11 : 10), () => expect(draw(primeBoxes(), styles)).toBeDefined());
  });

  it.each(['fragment', 'fragments'])('activates a direct context held budget around box %s', (method) => {
    const ctx = withExpansionBudget(new ExpansionBudget(9), () => new MathContext([], 'start'));
    const item = primeBoxes();
    if (method === 'fragment') sourceLimit(() => ctx.layoutIntoFragment(item, styles));
    else sourceLimit(() => ctx.layoutIntoFragments(item, styles));
  });

  it('protects layoutPrimes itself before constructing a frame', () => {
    const ctx = withExpansionBudget(new ExpansionBudget(4), () => new MathContext([], 'start'));
    sourceLimit(() => layoutPrimes(5, ctx, styles, properties(styles, null, null)));
    expect(ctx.fragments).toEqual([]);
  });

  it('shares a numbered layout allowance with equations in its number', () => {
    const number: Content = { func: 'equation', body: { func: 'primes', count: 5, span: null }, span: null };
    withExpansionBudget(new ExpansionBudget(9), () => sourceLimit(() => layoutNumberedBlock(primesItem(5, styles), [], styles, number)));
    withExpansionBudget(new ExpansionBudget(10), () => expect(layoutNumberedBlock(primesItem(5, styles), [], styles, number).equation).toBeDefined());
  });
});

describe.each(outputs)('normal prime counts in %s', (output) => {
  it.each(Array.from({ length: 9 }, (_, count) => count))('preserves count %s alone and attached', (count) => {
    const expected = count === 0 ? '' : count <= 4 ? ['′', '″', '‴', '⁗'][count - 1]! : '′'.repeat(count);
    for (const source of [`primes(#${count})`, `x^primes(#${count})`]) {
      const result = renderToResult(source, { output, strict: 'ignore' });
      expect(result.drawnAs).toBe(output === 'mathml' ? 'mathml' : 'html');
      if (output !== 'html' && count > 0) expect(result.markup).toContain(expected);
    }
  });
});
