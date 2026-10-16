import { describe, expect, it } from 'vitest';
import { type RenderOptions, renderToString, TypletError } from '../src/index.js';
import { Args } from '../src/eval/args.js';
import { appendCollection, insertDict, setCollectionLimits } from '../src/eval/ops.js';
import { intValue } from '../src/eval/value.js';

function success(source: string, maxCollectionSize: number, expected: string, options: RenderOptions = {}) {
  const markup = renderToString(source, { ...options, maxCollectionSize, output: 'mathml', strict: 'ignore' });
  const actual = expected.startsWith('<') ? markup : markup.replace(/<annotation[\s\S]*?<\/annotation>/g, '').replace(/<[^>]*>/g, '');
  expect(actual).toContain(expected);
}

function limit(source: string, maxCollectionSize: number, options: RenderOptions = {}) {
  let observed: unknown;
  try { renderToString(source, { ...options, maxCollectionSize, output: 'mathml', strict: 'ignore' }); }
  catch (error) { observed = error; }
  expect(observed).toBeInstanceOf(TypletError);
  const error = observed as TypletError;
  expect(error.kind, error.message).toBe('limit');
  expect(error.message).toBe(`Typlet stopped at a collection of more than ${maxCollectionSize} items`);
  expect(error.span).not.toBeNull();
}

const capture = '#let capture(..args) = args';

describe('array construction budgets', () => {
  it.each([
    ['#(1, 2)', 2, '(1, 2)'],
    ['#(0, ..(1, 2))', 3, '(0, 1, 2)'],
    ['#((1, 2), (3, 4))', 2, '((1, 2), (3, 4))'],
  ] as const)('checks literal and accumulated spread growth in %s', (source, size, expected) => {
    success(source, size, expected);
    limit(source, size - 1);
  });

  it('accepts none and empty array spreads', () => {
    success('#(..none, ..())', 1, '()');
  });

  it('does not modify the source of a spread', () => {
    success('#{ let a = (1,); let b = (..a, 2); a }', 2, '(1,)');
  });
});

describe('dictionary construction budgets', () => {
  it.each(['#(a: 1, b: 2)', '#("a": 1, "b": 2)', '#(a: 1, ..(b: 2))', '#((a: 1) + (b: 2))'])
    ('checks new keys before growing %s', (source) => {
      success(source, 2, '(a: 1, b: 2)');
      limit(source, 1);
    });

  it.each(['#("a" + "": 1, "a" + "": 2).a', '#(a: 1, ..(a: 2)).a', '#((a: 1) + (a: 2)).a'])
    ('allows overwrites at the exact key limit in %s', (source) => success(source, 1, '<mn>2</mn>'));

  it('accepts none and empty dictionary spreads', () => {
    success('#(: ..none, ..(:))', 1, '(:)');
  });

  it('retains key order, right values and the original input', () => {
    success('#{ let a = (a: 1, b: 2); let b = a + (b: 3, c: 4); (a, b) }', 3, '((a: 1, b: 2), (a: 1, b: 3, c: 4))');
  });
});

describe('computed argument budgets', () => {
  it.each([
    ['#capture(..(1, 2), ..(3,))', 2],
    ['#capture(..(a: 1), ..(b: 2))', 1],
    ['#capture(..capture(1, 2), ..capture(3))', 2],
    ['#capture(..(1, 2), 3)', 2],
    ['#capture(..(a: 1), b: 2)', 1],
    ['#capture(0, ..(a: 1), 2)', 2],
  ] as const)('checks generated argument growth in %s', (source, maximum) => limit(source, maximum, { preamble: capture }));

  it('keeps raw duplicate named arguments while taking the last value', () => {
    success('#capture(..(a: 1), ..(a: 2)).a', 2, '<mn>2</mn>', { preamble: capture });
    limit('#capture(..(a: 1), ..(a: 2))', 1, { preamble: capture });
  });

  it.each(['none', '()', '(:)', 'capture()'])('does not charge an empty %s spread', (empty) => {
    success(`#fixed(1, 2, 3, ..${empty})`, 1, '<mn>6</mn>', {
      preamble: capture + '\n#let fixed(a, b, c) = a + b + c',
    });
  });

  it('checks arguments addition and preserves named overrides', () => {
    success('#(capture(1, a: 1) + capture(a: 2)).a', 2, '<mn>2</mn>', { preamble: capture });
    limit('#(capture(1, a: 1) + capture(2, b: 2))', 3, { preamble: capture });
  });

  it('checks a closure sink after consuming fixed parameters', () => {
    const preamble = '#let f(a, ..r) = r';
    success('#f(0, 1, 2)', 2, '(1, 2)', { preamble });
    limit('#f(0, 1, 2, 3)', 2, { preamble });
  });

  it('checks a mixed named and positional closure sink', () => {
    const preamble = '#let f(a, ..r) = r';
    success('#f(0, 1, b: 2)', 2, '(b: 2, 1)', { preamble });
    limit('#f(0, 1, b: 2, c: 3)', 2, { preamble });
  });

  it('allows fixed syntax parameters at a low collection budget', () => {
    success('#fixed(1, 2, 3)', 1, '<mn>6</mn>', { preamble: '#let fixed(a, b, c) = a + b + c' });
  });

  it('retains internal named conversion by unique key count', () => {
    const args = new Args(null, [
      { span: null, name: 'a', value: intValue(1n), valueSpan: null },
      { span: null, name: 'a', value: intValue(2n), valueSpan: null },
    ]);
    setCollectionLimits(1, 100_000);
    try {
      const converted = args.toNamed();
      if (converted.type !== 'dictionary') throw new Error('expected dictionary');
      expect([...converted.v]).toEqual([['a', intValue(2n)]]);
      expect(args.items).toHaveLength(2);
    } finally { setCollectionLimits(10_000, 100_000); }
  });

  it('checks fixed math arguments appended after a spread', () => {
    success('capture(..#(1, 2), 3)', 3, '(1, 2, [3])', { preamble: capture });
    limit('capture(..#(1, 2), 3)', 2, { preamble: capture });
  });

  it('returns controlled error markup when throwing is disabled', () => {
    expect(renderToString('#(1, 2)', { maxCollectionSize: 1, throwOnError: false })).toContain('typlet-error');
  });
});

describe('bounded builder helpers', () => {
  it('rejects a known array length before appending any of its items', () => {
    setCollectionLimits(2, 100_000);
    const target = [1];
    try {
      expect(() => appendCollection(target, [2, 3])).toThrow('Typlet stopped at a collection of more than 2 items');
      expect(target).toEqual([1]);
    } finally {
      setCollectionLimits(10_000, 100_000);
    }
  });

  it('stops consuming an iterable at the rejected item and closes it', () => {
    setCollectionLimits(2, 100_000);
    const target: number[] = [];
    const consumed: number[] = [];
    let closed = false;
    function* input() {
      try {
        for (const item of [1, 2, 3, 4]) { consumed.push(item); yield item; }
      } finally {
        closed = true;
      }
    }
    try {
      expect(() => appendCollection(target, input())).toThrow('Typlet stopped at a collection of more than 2 items');
      expect(target).toEqual([1, 2]);
      expect(consumed).toEqual([1, 2, 3]);
      expect(closed).toBe(true);
    } finally {
      setCollectionLimits(10_000, 100_000);
    }
  });

  it('checks new map keys before writing and allows a full-map overwrite', () => {
    setCollectionLimits(1, 100_000);
    const target = new Map([['a', 1]]);
    try {
      insertDict(target, 'a', 2);
      expect(target.get('a')).toBe(2);
      expect(() => insertDict(target, 'b', 3)).toThrow('Typlet stopped at a collection of more than 1 items');
      expect([...target]).toEqual([['a', 2]]);
    } finally {
      setCollectionLimits(10_000, 100_000);
    }
  });
});

describe('computed math row boundaries', () => {
  const preamble = '#let first = (1, 2)\n#let second = (3, 4)\n#let one = (3,)\n#let lastval = 4\n#let rowcheck(a, b) = (a, b)';

  it('checks fixed and computed row lengths independently', () => {
    success('rowcheck(1, 2; ..second)', 2, '(([1], [2]), (3, 4))', { preamble });
    limit('rowcheck(1, 2; ..second)', 1, { preamble });
  });

  it('preserves two full spread rows in order', () => {
    success('rowcheck(..first; ..second)', 2, '((1, 2), (3, 4))', { preamble });
  });

  it('checks spread then fixed items against the current row only', () => {
    success('rowcheck(..first; ..one, lastval)', 2, '((1, 2), (3, 4))', { preamble });
    limit('rowcheck(..first; ..one, lastval, lastval)', 2, { preamble });
  });

  it('still checks the final grouped argument count', () => {
    limit('rowcheck(..one; ..one; ..one)', 2, { preamble });
  });
});
