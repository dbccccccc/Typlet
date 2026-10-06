import { describe, expect, it } from 'vitest';
import { renderToString } from '../src/index.js';
import { equationToMathml } from '../src/mathml/index.js';
import { evalFormula } from '../src/eval/index.js';
import { parseMath } from '../src/syntax/parser.js';
import type { SourceDiagnostic } from '../src/eval/diag.js';

/** The MathML inside `<semantics>`, without the annotation. */
function mathml(source: string): string {
  const out = renderToString(source, { output: 'mathml', strict: 'error' });
  return out.replace(/^<span class="typlet"><math><semantics>/, '').replace(/<annotation .*$/, '');
}

// Typst's MathML export drops some decorations, which Typlet keeps in its
// output (docs/DESIGN.md §2.3). The corpus tests compare Typlet's MathML without them
// with Typst's.
describe('decorations Typst’s MathML export drops', () => {
  it('keeps overline and underline as stretched lines', () => {
    expect(mathml('overline(x + y)')).toBe('<mover accent="true"><mrow><mi>𝑥</mi><mo>+</mo><mi>𝑦</mi></mrow><mo stretchy="true">‾</mo></mover>');
    expect(mathml('underline(z)')).toBe('<munder accentunder="true"><mi>𝑧</mi><mo stretchy="true">_</mo></munder>');
  });

  it('keeps cancel as an menclose', () => {
    expect(mathml('cancel(x)')).toBe('<menclose notation="updiagonalstrike"><mi>𝑥</mi></menclose>');
    expect(mathml('cancel(x, inverted: #true)')).toBe('<menclose notation="downdiagonalstrike"><mi>𝑥</mi></menclose>');
    expect(mathml('cancel(x, cross: #true)')).toBe('<menclose notation="updiagonalstrike downdiagonalstrike"><mi>𝑥</mi></menclose>');
  });

  it('keeps hidden content as an mphantom, which keeps its space', () => {
    expect(mathml('#hide[$x y$] + #hide[text]')).toBe(
      '<mrow><mphantom><mi>𝑥</mi><mi>𝑦</mi></mphantom><mo>+</mo><mphantom><mtext>text</mtext></mphantom></mrow>',
    );
  });

  it('keeps text colors', () => {
    expect(mathml('#text(fill: red, $a + b$) c')).toBe(
      '<mrow><mi style="color: #ff4136">𝑎</mi><mo style="color: #ff4136">+</mo><mi style="color: #ff4136">𝑏</mi><mi>𝑐</mi></mrow>',
    );
    // Black is the page's color, as in the HTML.
    expect(mathml('#text(fill: black)[x]')).toBe('<mtext>x</mtext>');
  });

  it('keeps box borders, padding, corners and fills', () => {
    expect(mathml('#box(stroke: 0.5pt + blue, inset: 2pt, fill: yellow, $x$)')).toBe(
      '<span style="background-color: #ffdc00; border: 0.5pt solid #0074d9; display: inline-block; padding: 2pt"><math><mi>𝑥</mi></math></span>',
    );
    expect(mathml('#box(stroke: (bottom: 1pt), radius: 2pt)[t]')).toBe(
      '<span style="border-bottom: 1pt solid currentColor; border-radius: 2pt; display: inline-block">t</span>',
    );
    // A box without decorations stays as Typst exports it.
    expect(mathml('#box($x$)')).toBe('<math><mi>𝑥</mi></math>');
  });

  it('are left out when comparing with Typst', () => {
    const root = parseMath('overline(x) + cancel(y)');
    const { equation } = evalFormula(root, false);
    const warnings: SourceDiagnostic[] = [];
    expect(equationToMathml(equation, warnings)).toBe('<math><mi>𝑥</mi><mo>+</mo><mi>𝑦</mi></math>');
    expect(warnings.map((w) => w.message)).toEqual(['overline was ignored during MathML export', 'cancel was ignored during MathML export']);
  });
});
