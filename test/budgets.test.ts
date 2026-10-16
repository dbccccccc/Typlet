import { describe, expect, it } from 'vitest';
import { type RenderOptions, TypletError, renderToString } from '../src/index.js';
import { BOUNDED_CASES, BUDGET_CASES, TYPST_LIMIT_CASES } from './budget-cases.mjs';
import { mul } from '../src/eval/ops.js';
import { type Value, arrayValue, intValue } from '../src/eval/value.js';

/** The error a formula fails with. */
function failure(source: string, options: RenderOptions = {}): TypletError {
  try {
    renderToString(source, { ...options, strict: 'ignore' });
  } catch (e) {
    if (!(e instanceof TypletError)) throw e;
    return e;
  }
  throw new Error(`${source} did not fail`);
}

// Formulas from chat, comments or shared links are untrusted: abuse must
// stop with a `limit` error (docs/DESIGN.md §6.6). scripts/check-budgets.mjs checks
// that the built bundle stops each within 50 ms.
describe('budgets', () => {
  it.each(BUDGET_CASES as [string, string, RenderOptions][])('stop %s with a limit error', (_, source, options) => {
    const error = failure(source, options);
    expect(error.kind, error.message).toBe('limit');
  });

  it.each(TYPST_LIMIT_CASES as [string, string, RenderOptions, string, string][])(
    'stop %s with Typst’s error',
    (_, source, options, kind, message) => {
      const error = failure(source, options);
      expect(error.kind).toBe(kind);
      expect(error.message).toBe(message);
    },
  );

  it('stop at the output size', () => {
    const error = failure('x '.repeat(500), { maxOutputSize: 1000 });
    expect(error.kind).toBe('limit');
    expect(error.message).toBe('the output is longer than 1000 characters');
  });

  it('leave room for real formulas', () => {
    // The paired corpus computes `fib(20)` with about 22,000 calls.
    const preamble = '#let fib(n) = if n < 2 { n } else { fib(n - 1) + fib(n - 2) }';
    expect(renderToString('F_20 = #fib(20)', { preamble, output: 'mathml' })).toContain('<mn>6765</mn>');
  });

  it('can be changed', () => {
    expect(() => renderToString('#h(20em)', { maxSize: 10 })).toThrow('Typlet stopped at a size of more than 10em');
    expect(() => renderToString('a b c', { maxElements: 2 })).toThrow('Typlet stopped after 2 elements');
    const preamble = '#let f(n) = if n == 0 { 0 } else { f(n - 1) }';
    expect(() => renderToString('#f(30)', { preamble, maxCalls: 10 })).toThrow('Typlet stopped after 10 function calls');
  });

  it.each(BOUNDED_CASES as [string, string, RenderOptions, string][])('finishes %s', (_, source, options, expected) => {
    expect(renderToString(source, { ...options, output: 'mathml', strict: 'ignore' })).toContain(expected);
  });

  it('counts retained user calls exactly once', () => {
    const options = { preamble: '#let first(x) = x\n#let second(x) = first(x)' };
    expect(failure('#second(2)', { ...options, maxCalls: 1 }).kind).toBe('limit');
    expect(renderToString('#second(2)', { ...options, maxCalls: 2 })).toContain('<mn>2</mn>');
  });

  it('allows strings exactly at their construction limit', () => {
    expect(renderToString('#("ab" * 3)', { maxStringLength: 6 })).toContain('ababab');
    expect(failure('#("ab" * 3)', { maxStringLength: 5 }).kind).toBe('limit');
  });
});

describe('array repetition boundaries', () => {
  it.each(['() * 0', '0 * ()', '() * 3', '3 * ()'])('keeps %s empty', (expression) => {
    expect(renderToString(`#(${expression})`)).toContain('()');
  });

  it.each(['() * -1', '-1 * ()'])('preserves the negative-count error for %s', (expression) => {
    const error = failure(`#(${expression})`);
    expect(error.kind).toBe('eval');
    expect(error.message).toBe('number must be at least zero');
  });

  it.each(['(1, 2) * 0', '0 * (1, 2)'])('makes %s empty', (expression) => {
    expect(renderToString(`#(${expression})`)).toContain('()');
  });

  it.each(['(1, 2) * 3', '3 * (1, 2)'])('retains order, length and values for %s', (expression) => {
    expect(renderToString(`#(${expression})`, { output: 'mathml' }).replace(/<[^>]*>/g, '')).toContain('(1, 2, 1, 2, 1, 2)');
  });

  it.each([
    { items: [], count: 0n }, { items: [], count: 3n },
    { items: [1n], count: 0n }, { items: [1n], count: 2n },
  ])('allocates a distinct result container for $items repeated $count times', ({ items, count }) => {
    const original = arrayValue(items.map(intValue));
    const result = mul(original, intValue(count));
    if (original.type !== 'array' || result.type !== 'array') throw new Error('expected array values');
    expect(result.v).not.toBe(original.v);
    (result.v as Value[]).push(intValue(9n));
    expect(original.v).toHaveLength(items.length);
  });

  it('allows an exact collection limit and rejects the next item', () => {
    const source = '#((1, 2) * 2)';
    expect(renderToString(source, { maxCollectionSize: 4, output: 'mathml' }).replace(/<[^>]*>/g, '')).toContain('(1, 2, 1, 2)');
    const error = failure(source, { maxCollectionSize: 3 });
    expect(error.kind).toBe('limit');
    expect(error.message).toBe('Typlet stopped at a collection of more than 3 items');
  });
});
