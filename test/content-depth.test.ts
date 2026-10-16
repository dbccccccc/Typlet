import { describe, expect, it } from 'vitest';
import { renderToResult } from '../src/index.js';
import * as mathml from '../src/mathml.js';
import { checkContentDepth, checkContentExpansion, DepthBudget } from '../src/eval/content-budget.js';
import { type Content, spaceElem, symbolElem, textElem } from '../src/eval/content.js';
import { ElementBudget, SourceError } from '../src/eval/diag.js';
import { newEngine, withRuleDepth } from '../src/eval/func.js';

function roots(depth: number, leaf: Content = textElem('x')): Content {
  let content = leaf;
  for (let i = 0; i < depth; i++) content = { func: 'root', radicand: content, span: { start: 0, end: 1 } };
  return content;
}
function sourceLimit(body: () => unknown) {
  try { body(); }
  catch (error) {
    if (!(error instanceof SourceError)) throw error;
    expect(error.diagnostics[0]?.kind).toBe('limit');
    return error;
  }
  throw new Error('expected a controlled content limit');
}

describe('runtime content preflight', () => {
  it.each([textElem('x'), symbolElem('x'), spaceElem()])('checks the exact depth of a $func leaf', (leaf) => {
    expect(checkContentDepth(roots(256, leaf))).toBeUndefined();
    expect(sourceLimit(() => checkContentDepth(roots(257, leaf))).diagnostics[0]?.message).toContain('content depth');
  });

  it.each([textElem('x'), symbolElem('x'), spaceElem()])('counts every occurrence of a shared $func leaf', (leaf) => {
    const children = Array(99_999).fill(leaf);
    const root: Content = { func: 'sequence', children, span: null };
    expect(checkContentDepth(root)).toBeUndefined();
    children.push(leaf);
    expect(sourceLimit(() => checkContentDepth(root)).diagnostics[0]?.message).toBe('Typlet stopped after 100000 content visits');
    sourceLimit(() => checkContentDepth({ func: 'sequence', children: [leaf, roots(256, leaf)], span: null }));
  });

  it('charges every repeated space during content expansion', () => {
    const leaf = spaceElem();
    const root: Content = { func: 'sequence', children: [leaf, leaf], span: null };
    expect(checkContentExpansion(root, new ElementBudget(3))).toBeUndefined();
    expect(sourceLimit(() => checkContentExpansion(root, new ElementBudget(2))).diagnostics[0]?.message).toBe('Typlet stopped after 2 elements');
  });

  it('rechecks a shared subtree when reached at greater depth', () => {
    const shared = roots(128);
    sourceLimit(() => checkContentDepth({ func: 'sequence', children: [shared, roots(128, shared)], span: null }));
  });

  it('checks content held by style properties', () => {
    sourceLimit(() => checkContentDepth({ func: 'styled', child: textElem('x'), styles: [{ elem: 'equation', field: 'supplement', value: roots(256) }], span: null }));
  });

  it('uses independent traversals after a rejection', () => {
    sourceLimit(() => checkContentDepth(roots(257)));
    expect(checkContentDepth({ func: 'sequence', children: Array(100).fill(roots(8)), span: null })).toBeUndefined();
  });
});

describe('rendering depth lifetime', () => {
  it('accepts exactly 256 active steps and restores after the next fails', () => {
    const budget = new DepthBudget();
    const descend = (n: number): number => budget.withDepth(null, () => n === 0 ? 1 : descend(n - 1));
    expect(descend(255)).toBe(1);
    sourceLimit(() => descend(256));
    expect(descend(255)).toBe(1);
  });
});

describe('rule depth lifetime', () => {
  it('restores the counter after a nested rejection', () => {
    const engine = newEngine();
    engine.ruleDepth = 255;
    sourceLimit(() => withRuleDepth(engine, null, () => withRuleDepth(engine, null, () => undefined)));
    expect(engine.ruleDepth).toBe(255);
    engine.ruleDepth = 0;
    expect(withRuleDepth(engine, null, () => engine.ruleDepth)).toBe(1);
    expect(engine.ruleDepth).toBe(0);
  });
});

for (const [name, render, outputs] of [
  ['full', renderToResult, ['html', 'htmlAndMathml', 'mathml']],
  ['mathml', mathml.renderToResult, ['mathml']],
] as const) {
  describe(`${name} ordinary retained structures`, () => {
    it('preserves rule order, labels and conditional return flow', () => {
      for (const output of outputs) {
        const source = '#{ set text(fill: red); set text(fill: blue); $x$ }';
        const result = render(source, { output, strict: 'ignore' });
        expect(result.drawnAs).toBe(output === 'mathml' ? 'mathml' : 'html');
        expect(result.markup).toContain('#0074d9');
        expect(result.warnings).toEqual([]);
        const macro = render('#f(true)', { output, preamble: '#let f(c) = { set text(fill: blue); if c { return $x$ }; $y$ }', strict: 'ignore' });
        expect(macro.drawnAs).toBe(output === 'mathml' ? 'mathml' : 'html');
        expect(macro.warnings).toEqual([]);
        expect(render('#[$x$ <one>]', { output, strict: 'ignore' }).warnings).toEqual([]);
      }
    });

    it('keeps ordinary inherited box, attachment and annotation content', () => {
      for (const output of outputs) {
        for (const [source, preamble] of [
          ['#box()', '#set box([ok])'],
          ['attach(x)', '#set math.attach(t: [y])'],
          ['overbrace(x)', '#set math.overbrace([n])'],
        ]) {
          const result = render(source!, { output, preamble, strict: 'ignore' });
          expect(result.drawnAs).toBe(output === 'mathml' ? 'mathml' : 'html');
        }
      }
    });

    it('keeps ordinary generated content in bodies, boxes and numbers', () => {
      const preamble = '#let wrap(c) = math.sqrt(c)\n#let x0 = $x$\n' + Array.from({ length: 16 }, (_, i) => `#let x${i + 1} = wrap(x${i})`).join('\n');
      for (const output of outputs) {
        const result = render('#box[$#x16$]', { output, preamble: preamble + '\n#set math.equation(numbering: n => [$#x16$])', displayMode: true, strict: 'ignore' });
        expect(result.drawnAs).toBe(output === 'mathml' ? 'mathml' : 'html');
        expect(result.number).toBe('');
      }
    });
  });
}
