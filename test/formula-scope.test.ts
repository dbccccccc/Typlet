import { describe, expect, it } from 'vitest';
import { parse, renderToResult, TypletError } from '../src/index.js';
import * as mathml from '../src/mathml.js';
import { evalExpression } from './eval-helpers.js';

const removed = [
  '#for i in (1, 2) [#i]', '#while false [x]',
  '#{ let a = 1; a = 2 }', '#{ let a = 1; a += 2 }',
  '#{ let d = (a: 1); d.a = 2 }', '#{ let a = (1,); a.at(0) = 2 }',
  '#{ let a = 1; let b = 2; (a, b) = (b, a) }',
  '#std.calc.sin(30deg)', '#std.int(2)', 'std.range(3)',
  '#calc.sin(30deg)', '#range(3)', '#(1, 2).map(x => x)',
  '#(a: 1).keys()', '#"abc".len()', '#(5).signum()',
  '#int("42")', '#str(2)', '#float.inf', '#type(1)', '#repr((1, 2))',
  '#arguments(1, 2)', '#upper("abc")', '#{ let f(x) = x; f.with(1)() }',
];

for (const [name, render, outputs] of [
  ['full', renderToResult, ['html', 'htmlAndMathml', 'mathml']],
  ['mathml', mathml.renderToResult, ['mathml']],
] as const) {
  describe(`${name} retained formula scope`, () => {
    it.each(removed)('parses and refuses %s with source spans and fallback', (source) => {
      expect(parse(source).erroneous()).toBe(false);
      for (const output of outputs) {
        let observed: unknown;
        try { render(source, { output, strict: 'ignore' }); }
        catch (error) { observed = error; }
        expect(observed).toBeInstanceOf(TypletError);
        const error = observed as TypletError;
        expect(error.kind).toBe('unsupported');
        expect(error.span).not.toBeNull();
        expect(error.span!.start).toBeGreaterThanOrEqual(0);
        expect(error.span!.end).toBeLessThanOrEqual(source.length);
        expect(render(source, { output, fallback: () => '<svg></svg>' })).toMatchObject({ drawnAs: 'fallback', markup: '<svg></svg>' });
        expect(render(source, { output, throwOnError: false })).toMatchObject({ drawnAs: 'error' });
      }
    });

    it('retains macros, defaults, named arguments, sinks, destructuring and numbering', () => {
      const preamble = '#let norm(x, power: 2, ..rest) = $lr(|| #x ||)^#power$\n#let (a, b) = ("u", "v")\n#let opts = (power: 3)\n#show math.equation.where(block: true): set text(fill: blue)\n#set math.equation(numbering: n => [Eq. #n])';
      const result = render('norm(a, ..#opts) + norm(b) + vec(..#("a", "b"))', { preamble, displayMode: true, strict: 'ignore' });
      expect(result.drawnAs).toBe(name === 'mathml' ? 'mathml' : 'html');
      expect(result.number).toBe('Eq. 1');
      expect(result.warnings).toEqual([]);
    });
  });
}

describe('retained basic values and collections', () => {
  it.each([
    ['{ let (a, b, ..rest) = (1, 2, 3); a + b }', 3],
    ['{ let (a: x, ..rest) = (a: 1, b: 2); x + rest.b }', 3],
    ['{ let f(a, b: 2) = a + b; f(1, b: 3) }', 4],
    ['{ let f(a, ..rest) = if rest.flag { a } else { 0 }; f(3, flag: true) }', 3],
    ['{ let a = (1, 2); (..a, 3) + (4,) }', [1, 2, 3, 4]],
    ['{ let a = (a: 1); (..a, b: 2) + (a: 3) }', { a: 3, b: 2 }],
    ['{ let f(n) = if n == 0 { return 1 }; f(0) }', 1],
  ])('keeps the v0.1.1 value of %s', (source, value) => {
    const result = evalExpression(source as string);
    expect(result.diagnostics).toEqual([]);
    expect(result.value?.json).toEqual(value);
  });
});
