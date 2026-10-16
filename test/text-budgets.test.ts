import { describe, expect, it } from 'vitest';
import { renderToResult, renderToString, TypletError } from '../src/index.js';
import { textElem } from '../src/eval/content.js';
import { checkContentExpansion } from '../src/eval/content-budget.js';
import { SourceError, withElementLimit } from '../src/eval/diag.js';
import { ExpansionBudget, withExpansionBudget } from '../src/eval/expansion-budget.js';
import { equationStyles, MathResolver } from '../src/ir/resolve.js';
import { shapeText } from '../src/layout/inline.js';

describe('text expansion preflight', () => {
  const styles = equationStyles(false);

  it('counts every occurrence of a shared subtree before IR allocation', () => {
    const child = textElem('abc');
    const content = { func: 'sequence' as const, children: [child, child], span: null };
    expect(() => checkContentExpansion(content, new ExpansionBudget(9))).not.toThrow();
    expect(() => checkContentExpansion(content, new ExpansionBudget(8))).toThrow(SourceError);
  });

  it('bounds text cumulatively before creating IR items', () => {
    withElementLimit(6, () => {
      const resolver = new MathResolver([]);
      resolver.resolveIntoItem(textElem('abc'), styles);
      resolver.resolveIntoItem(textElem('abc'), styles);
      expect(() => resolver.resolveIntoItem(textElem('x'), styles)).toThrow(SourceError);
      expect(resolver.items).toEqual([]);
    });
  });

  it('checks the output allowance before styling text', () => {
    const resolver = new MathResolver([], 'html', 2);
    expect(() => resolver.resolveIntoItem(textElem('abc'), styles)).toThrow(SourceError);
    expect(resolver.items).toEqual([]);
  });

  it('bounds cumulative glyph shaping, including independent text runs', () => {
    withExpansionBudget(new ExpansionBudget(6), () => {
      expect(shapeText('abc', styles, null).glyphs).toHaveLength(3);
      expect(shapeText('abc', styles, null).glyphs).toHaveLength(3);
      expect(() => shapeText('x', styles, null)).toThrow(SourceError);
    });
  });

  for (const output of ['html', 'htmlAndMathml', 'mathml'] as const) {
    it(`does not charge unrendered equation reference metadata in ${output}`, () => {
      const source = '#math.equation(block: false, supplement: [#("x" * 1000)], $y$)';
      const result = renderToResult(source, { output, maxElements: 100, strict: 'ignore' });
      expect(result.drawnAs).toBe(output === 'mathml' ? 'mathml' : 'html');
    });

    it.each(['#([abc] * 8)', '#([123] * 8)', '#box[#([abc] * 8)]', '#strong[#([abc] * 8)]', Array(4).fill('#box[$x x x$]').join(' ')])(
      `bounds repeated text in ${output}: %s`, (source) => {
        const options = { output, maxElements: 20, strict: 'ignore' as const };
        expect(() => renderToString(source, options)).toThrow(TypletError);
        expect(renderToResult(source, { ...options, throwOnError: false }).drawnAs).toBe('error');
        expect(renderToResult('x', options).drawnAs).toBe(output === 'mathml' ? 'mathml' : 'html');
      },
    );

    it(`keeps bounded text and custom numbering in ${output}`, () => {
      const result = renderToResult('#([abc] * 2)', { output, strict: 'ignore' });
      expect(result.drawnAs).toBe(output === 'mathml' ? 'mathml' : 'html');
      expect(renderToResult('x', { output, displayMode: true, preamble: '#set math.equation(numbering: n => [ #n ])' }).number).toBe(' 1 ');
    });
  }
});
