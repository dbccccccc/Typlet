import { describe, expect, it } from 'vitest';
import { type RenderOptions, renderToString, TypletError } from '../src/index.js';
import { Args } from '../src/eval/args.js';
import { DEFAULT_LIMITS, callFunc, newEngine, type Func } from '../src/eval/func.js';
import { type Value, NONE, argsEqual, arrayValue, contentValue, dictValue, equal, floatValue, hashEqual, intValue, repr, strValue, toJson } from '../src/eval/value.js';
import { type Content, textElem } from '../src/eval/content.js';
import { compare } from '../src/eval/ops.js';
import { SourceError } from '../src/eval/diag.js';
import { prettyArrayLike, prettyCommaList } from '../src/eval/repr.js';
import { evalExpression } from './eval-helpers.js';
import { ValueBudget, getValueBudget, withValueBudget, withValueContext } from '../src/eval/value-budget.js';

function failure(source: string, options: RenderOptions = {}): TypletError {
  try {
    renderToString(source, { output: 'mathml', strict: 'ignore', ...options });
  } catch (error) {
    if (!(error instanceof TypletError)) throw error;
    return error;
  }
  throw new Error('expected a value budget error, but rendering succeeded');
}

function limit(source: string, maxStringLength: number) {
  const error = failure(source, { maxStringLength });
  expect(error.kind, error.message).toBe('limit');
}

describe('value representation budgets', () => {
  it('bounds implicit array display at the exact representation boundary', () => {
    expect(renderToString('#(1, 2)', { maxStringLength: 6 })).toContain('(1, 2)');
    limit('#(1, 2)', 5);
  });

  it('counts escaping, quotes, indentation, commas and newlines', () => {
    for (const value of [strValue('ab'), strValue('\n'), arrayValue(Array(3).fill(strValue('abcdefghijklmnop')))]) {
      const expected = repr(value);
      withValueBudget(new ValueBudget(expected.length), () => expect(repr(value)).toBe(expected));
      expect(() => withValueBudget(new ValueBudget(expected.length - 1), () => repr(value))).toThrow('string longer than');
    }
  });

  it('bounds content and closure-sink argument representations', () => {
    const options = { preamble: '#let capture(..args) = args', maxStringLength: 10 };
    expect(failure('#capture(1, 2)', options).kind).toBe('limit');
    const value = contentValue(textElem('abc'));
    expect(() => withValueBudget(new ValueBudget(4), () => repr(value))).toThrow('string longer than');
  });
});

describe('value budget context', () => {
  it('allows exactly 100000 visits and refuses the next one', () => {
    const budget = new ValueBudget();
    for (let i = 0; i < 100_000; i++) budget.visit();
    expect(() => budget.visit()).toThrow('Typlet stopped after 100000 value visits');
  });

  it('allows depth 256 and refuses depth 257', () => {
    const budget = new ValueBudget();
    budget.visit(256);
    expect(() => budget.visit(257)).toThrow('value depth of more than 256');
  });

  it('counts the exact UTF-16 string boundary', () => {
    const budget = new ValueBudget(2);
    budget.checkString('😀'.length);
    expect(() => budget.checkString('😀a'.length)).toThrow('string longer than 2 characters');
  });

  it('restores an outer context after a nested context returns', () => {
    const outer = new ValueBudget(3);
    const inner = new ValueBudget(8);
    withValueBudget(outer, () => {
      expect(getValueBudget()).toBe(outer);
      withValueBudget(inner, () => expect(getValueBudget()).toBe(inner));
      expect(getValueBudget()).toBe(outer);
    });
    expect(getValueBudget()).not.toBe(outer);
  });

  it('restores an outer context after a nested exception', () => {
    const outer = new ValueBudget();
    withValueBudget(outer, () => {
      expect(() => withValueBudget(new ValueBudget(), () => { throw new Error('controlled'); })).toThrow('controlled');
      expect(getValueBudget()).toBe(outer);
    });
    expect(getValueBudget()).not.toBe(outer);
  });

  it('shares one engine budget across separate function calls', () => {
    const engine = newEngine();
    const func: Func = { name: 'consume', params: [], call: () => {
      for (let i = 0; i < 60_000; i++) getValueBudget().visit();
      return NONE;
    } };
    callFunc(func, engine, new Args(null, []));
    expect(() => callFunc(func, engine, new Args(null, []))).toThrow();
    expect(engine.calls).toBe(2);
  });

  it('restores a call context after a nested render succeeds or fails', () => {
    const engine = newEngine({ ...DEFAULT_LIMITS, stringLength: 4 });
    const func: Func = { name: 'nested', params: [], call: () => {
      expect(getValueBudget()).toBe(engine.values);
      expect(renderToString('1')).toContain('<mn>1</mn>');
      expect(getValueBudget()).toBe(engine.values);
      expect(() => renderToString('unknownname')).toThrow(TypletError);
      expect(getValueBudget()).toBe(engine.values);
      return NONE;
    } };
    callFunc(func, engine, new Args(null, []));
    expect(engine.calls).toBe(1);
    expect(getValueBudget()).not.toBe(engine.values);
  });

  it('gives each standalone context an independent bounded budget', () => {
    let first: ValueBudget | undefined;
    withValueContext((budget) => { first = budget; expect(getValueBudget()).toBe(budget); });
    withValueContext((budget) => { expect(budget).not.toBe(first); expect(budget.stringLength).toBe(100_000); });
  });
});

describe('representation compatibility and indirect paths', () => {
  it('counts supplementary characters in UTF-16 units', () => {
    withValueBudget(new ValueBudget(4), () => expect(repr(strValue('😀'))).toBe('"😀"'));
    expect(() => withValueBudget(new ValueBudget(3), () => repr(strValue('😀')))).toThrow('string longer than 3');
  });

  it('preserves the 40-item preview and charges its omission marker', () => {
    const value = arrayValue(Array.from({ length: 41 }, (_, i) => intValue(BigInt(i + 1))));
    const expected = repr(value);
    expect(expected).toContain('.. (1 items omitted)');
    expect(expected).not.toContain('41');
    withValueBudget(new ValueBudget(expected.length), () => expect(repr(value)).toBe(expected));
    expect(() => withValueBudget(new ValueBudget(expected.length - 1), () => repr(value))).toThrow('string longer than');
  });

  it('meters content-field wrapping before serializing nested rows', () => {
    const budget = new ValueBudget();
    for (let i = 0; i < 99_998; i++) budget.visit();
    const content = { func: 'mat', rows: [[textElem('a'), textElem('b')]], span: null } as Content;
    expect(() => withValueBudget(budget, () => toJson(contentValue(content)))).toThrow('100000 value visits');
  });

  it('stops wrapping content offsets when the work budget runs out', () => {
    const budget = new ValueBudget();
    for (let i = 0; i < 99_998; i++) budget.visit();
    let readLast = false;
    const hline = [1, 2, 3];
    Object.defineProperty(hline, 2, { get: () => { readLast = true; return 3; } });
    const content = { func: 'mat', rows: [], augment: { hline, vline: [1], stroke: null }, span: null } as Content;
    expect(() => withValueBudget(budget, () => toJson(contentValue(content)))).toThrow('100000 value visits');
    expect(readLast).toBe(false);
  });

  it('does not retain an exhausted budget in a cached preamble or another render', () => {
    const preamble = '#let data = (1, 2)';
    const options = { preamble, maxStringLength: 5 };
    expect(failure('#data', options).kind).toBe('limit');
    for (let i = 0; i < 2; i++) expect(renderToString('#(data == (1, 2))', options)).toContain('true');
  });
});

describe('value comparison budgets', () => {
  it('preserves equality for a small shared array DAG', () => {
    const shared = (leaf: Value) => {
      let value = leaf;
      for (let i = 0; i < 8; i++) value = arrayValue([value, value]);
      return value;
    };
    const left = shared(intValue(1n));
    const right = shared(intValue(1n));
    expect(equal(left, right)).toBe(true);
    expect(hashEqual(left, right)).toBe(true);
  });

  it('finds a differing last leaf after a small shared array DAG', () => {
    let left = arrayValue([intValue(1n), intValue(2n)]);
    for (let i = 0; i < 8; i++) left = arrayValue([left, left]);
    const changeLast = (value: Value): Value => value.type === 'array'
      ? arrayValue([...value.v.slice(0, -1), changeLast(value.v.at(-1)!)])
      : intValue(3n);
    const right = changeLast(left);
    expect(equal(left, right)).toBe(false);
    expect(hashEqual(left, right)).toBe(false);
  });

  it('keeps NaN arrays unequal even when they share the same reference', () => {
    const value = arrayValue([floatValue(NaN)]);
    expect(equal(value, value)).toBe(false);
    expect(hashEqual(value, value)).toBe(true);
  });

  it('keeps ordinary and hash rules separate for captured negative zero', () => {
    const result = evalExpression('{ let make(x) = () => x; let a = (0.0,); let b = (-0.0,); (a, make(a)) == (b, make(b)) }');
    expect(result.value).toMatchObject({ type: 'bool', json: false });
    expect(result.diagnostics).toEqual([]);
  });

  it('observes input changes in a later comparison', () => {
    const items = [intValue(1n)];
    const left = arrayValue(items);
    const right = arrayValue([intValue(1n)]);
    expect(equal(left, right)).toBe(true);
    items[0] = intValue(2n);
    expect(equal(left, right)).toBe(false);
  });

  it('shares the work budget across top-level comparisons', () => {
    const budget = new ValueBudget();
    for (let i = 0; i < 99_996; i++) budget.visit();
    const left = arrayValue([intValue(1n)]);
    const right = arrayValue([intValue(1n)]);
    withValueBudget(budget, () => {
      expect(equal(left, right)).toBe(true);
      expect(equal(left, right)).toBe(true);
      expect(() => equal(left, right)).toThrow('100000 value visits');
    });
  });

  it('does not charge hash-to-normal forwarding as another value visit', () => {
    const budget = new ValueBudget();
    for (let i = 0; i < 99_999; i++) budget.visit();
    withValueBudget(budget, () => expect(hashEqual(intValue(1n), intValue(1n))).toBe(true));
    expect(() => budget.visit()).toThrow('100000 value visits');
  });

  it('preserves named-argument dictionary equality and raw hash order', () => {
    const make = (names: string[]) => new Args(null, names.map((name) => ({ span: null, name, value: intValue(name === 'a' ? 1n : 2n), valueSpan: null })));
    const left = make(['a', 'b']);
    const right = make(['b', 'a']);
    expect(argsEqual(left, right)).toBe(true);
    expect(hashEqual({ type: 'arguments', v: left }, { type: 'arguments', v: right })).toBe(false);
  });

  it('preserves JSON numeric equivalence inside content', () => {
    const content = (value: ReturnType<typeof floatValue>) => contentValue({ func: 'equation', supplement: value, span: null } as Content);
    expect(equal(content(floatValue(NaN)), content(floatValue(Infinity)))).toBe(true);
    expect(equal(content(floatValue(-0)), content(floatValue(0)))).toBe(true);
    expect(equal(content(intValue(9007199254740992n)), content(intValue(9007199254740993n)))).toBe(true);
  });

  it('preserves JSON key order inside content while dictionaries ignore it', () => {
    const left = dictValue(new Map([['a', intValue(1n)], ['b', intValue(2n)]]));
    const right = dictValue(new Map([['b', intValue(2n)], ['a', intValue(1n)]]));
    expect(equal(left, right)).toBe(true);
    const wrap = (value: typeof left) => contentValue({ func: 'equation', supplement: value, span: null } as Content);
    expect(equal(wrap(left), wrap(right))).toBe(false);
  });

  it('meters array ordering with the same active work budget', () => {
    const budget = new ValueBudget();
    for (let i = 0; i < 99_999; i++) budget.visit();
    expect(() => withValueBudget(budget, () => compare(arrayValue([intValue(1n)]), arrayValue([intValue(1n)]))))
      .toThrow('100000 value visits');
    expect(compare(arrayValue([intValue(1n)]), arrayValue([intValue(2n)]))).toBeLessThan(0);
  });

});

describe('representation formatting boundaries', () => {
  it('preserves Unicode and whitespace dictionary keys at the exact string boundary', () => {
    const value = dictValue(new Map([
      ['é', intValue(1n)], ['two words', intValue(2n)], ['😀', intValue(3n)], ['\t', intValue(4n)],
    ]));
    const expected = '(é: 1, "two words": 2, "😀": 3, "\\t": 4)';
    withValueBudget(new ValueBudget(expected.length), () => expect(repr(value)).toBe(expected));
    expect(() => withValueBudget(new ValueBudget(expected.length - 1), () => repr(value))).toThrow('string longer than');
  });

  it('counts multiline dictionary formatting before returning the string', () => {
    const value = dictValue(new Map([
      [' spaced ', strValue('a'.repeat(51))], ['é', arrayValue([intValue(1n), intValue(2n)])],
    ]));
    const expected = '(\n  " spaced ": "' + 'a'.repeat(51) + '",\n  é: (1, 2),\n)';
    withValueBudget(new ValueBudget(expected.length), () => expect(repr(value)).toBe(expected));
    expect(() => withValueBudget(new ValueBudget(expected.length - 1), () => repr(value))).toThrow('string longer than');
  });

  it('checks accumulated dictionary fields before reading the next value', () => {
    let readLast = false;
    const last: Value = { type: 'int', get v() { readLast = true; return 3n; } };
    const value = dictValue(new Map([['a', intValue(1n)], ['b', intValue(2n)], ['c', last]]));
    expect(() => withValueBudget(new ValueBudget(9), () => repr(value))).toThrow('string longer than 9');
    expect(readLast).toBe(false);
  });

  it('preserves dictionary insertion order and the 40-pair omission marker', () => {
    const value = dictValue(new Map(Array.from({ length: 41 }, (_, i) => [`key${i + 1}`, intValue(BigInt(i + 1))])));
    const expected = '(\n  ' + Array.from({ length: 40 }, (_, i) => `key${i + 1}: ${i + 1},\n  `).join('') + '.. (1 pairs omitted),\n)';
    withValueBudget(new ValueBudget(expected.length), () => expect(repr(value)).toBe(expected));
    expect(() => withValueBudget(new ValueBudget(expected.length - 1), () => repr(value))).toThrow('string longer than');
  });

  it.each([
    [['a'.repeat(50)], 'a'.repeat(50)],
    [['é'.repeat(25)], 'é'.repeat(25)],
    [['é'.repeat(26)], 'é'.repeat(26) + ',\n'],
    [['😀'.repeat(12) + 'ab'], '😀'.repeat(12) + 'ab'],
    [['😀'.repeat(13)], '😀'.repeat(13) + ',\n'],
    [['é'.repeat(24), 'x'], 'é'.repeat(24) + ',\nx,\n'],
  ])('keeps the 50-byte line boundary for %j', (pieces, expected) => {
    expect(prettyCommaList(pieces, false)).toBe(expected);
  });

  it.each([
    ['alpha\n\nbeta', '(\n  alpha\n  \n  beta\n)'],
    ['alpha\n', '(\n  alpha\n)'],
    ['alpha\n\n', '(\n  alpha\n  \n)'],
  ])('preserves embedded and trailing lines in %j', (piece, expected) => {
    withValueBudget(new ValueBudget(expected.length), () => expect(prettyArrayLike([piece], false)).toBe(expected));
    expect(() => withValueBudget(new ValueBudget(expected.length - 1), () => prettyArrayLike([piece], false)))
      .toThrow('string longer than');
  });

  it('counts every separator and line in a wide comma list', () => {
    const piece = 'a'.repeat(51);
    const expected = piece + ',\nb,\n';
    withValueBudget(new ValueBudget(expected.length), () => expect(prettyCommaList([piece, 'b'], false)).toBe(expected));
    expect(() => withValueBudget(new ValueBudget(expected.length - 1), () => prettyCommaList([piece, 'b'], false)))
      .toThrow('string longer than');
  });

  it('counts indentation and blank lines in a wide array representation', () => {
    const piece = 'a'.repeat(51);
    const expected = '(\n  ' + piece + ',\n  b\n  \n  c,\n)';
    withValueBudget(new ValueBudget(expected.length), () => expect(prettyArrayLike([piece, 'b\n\nc'], false)).toBe(expected));
    expect(() => withValueBudget(new ValueBudget(expected.length - 1), () => prettyArrayLike([piece, 'b\n\nc'], false)))
      .toThrow('string longer than');
  });

  it('preserves trimming in wide comma lists', () => {
    const piece = 'a'.repeat(51);
    expect(prettyCommaList([' ' + piece + ' ', ' b \n'], false)).toBe(piece + ',\nb,\n');
  });
});
