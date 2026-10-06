import { describe, expect, it } from 'vitest';
import { type RenderOptions, TypletError, renderToString } from '../src/index.js';
import { BUDGET_CASES, TYPST_LIMIT_CASES } from './budget-cases.mjs';

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
});
