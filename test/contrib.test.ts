// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMathInElement, splitAtDelimiters } from '../contrib/auto-render.js';
import { defaultCopyDelimiters, handleCopy, typletReplaceWithSource } from '../contrib/copy-typst.js';
import { TypletMathElement, elementOptions } from '../contrib/element.js';
import { TypletError, renderToString } from '../src/index.js';

/** Lets elements that wait a microtask for their text render. */
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

const NUMBERING = '#set math.equation(numbering: "(1)")';

describe('auto-render', () => {
  describe('splits text at formulas', () => {
    it('with Typst’s rule for display formulas', () => {
      expect(splitAtDelimiters('a $x$ b $ y $ c $ z$')).toEqual([
        { type: 'text', data: 'a ' },
        { type: 'math', data: 'x', rawData: '$x$', display: false },
        { type: 'text', data: ' b ' },
        { type: 'math', data: ' y ', rawData: '$ y $', display: true },
        { type: 'text', data: ' c ' },
        { type: 'math', data: ' z', rawData: '$ z$', display: false },
      ]);
    });

    it('with display formulas over several lines', () => {
      expect(splitAtDelimiters('$\n  x\n$')).toEqual([{ type: 'math', data: '\n  x\n', rawData: '$\n  x\n$', display: true }]);
    });

    it('with escaped dollar signs as text', () => {
      expect(splitAtDelimiters('costs \\$5, or $x$')).toEqual([
        { type: 'text', data: 'costs $5, or ' },
        { type: 'math', data: 'x', rawData: '$x$', display: false },
      ]);
    });

    it('where Typst ends the formula', () => {
      const src = '$#box[$y$] + "$" + \\$$ after';
      expect(splitAtDelimiters(src)).toEqual([
        { type: 'math', data: '#box[$y$] + "$" + \\$', rawData: '$#box[$y$] + "$" + \\$$', display: false },
        { type: 'text', data: ' after' },
      ]);
    });

    it('with long formulas', () => {
      const long = `x${' + x'.repeat(2000)}`;
      expect(splitAtDelimiters(`a $${long}$ b`)).toEqual([
        { type: 'text', data: 'a ' },
        { type: 'math', data: long, rawData: `$${long}$`, display: false },
        { type: 'text', data: ' b' },
      ]);
    });

    it('leaving an unterminated dollar sign as text', () => {
      expect(splitAtDelimiters('price: $5')).toEqual([{ type: 'text', data: 'price: $5' }]);
    });

    it('with Markdown’s delimiters', () => {
      expect(splitAtDelimiters('$$x$$ and $ y $ and $"$"$', 'markdown')).toEqual([
        { type: 'math', data: 'x', rawData: '$$x$$', display: true },
        { type: 'text', data: ' and ' },
        { type: 'math', data: ' y ', rawData: '$ y $', display: false },
        { type: 'text', data: ' and ' },
        { type: 'math', data: '"$"', rawData: '$"$"$', display: false },
      ]);
    });

    it('with delimiters of its own', () => {
      expect(splitAtDelimiters('a \\(x\\) b', [{ left: '\\(', right: '\\)', display: false }])).toEqual([
        { type: 'text', data: 'a ' },
        { type: 'math', data: 'x', rawData: '\\(x\\)', display: false },
        { type: 'text', data: ' b' },
      ]);
    });
  });

  it('renders the formulas in an element', () => {
    document.body.innerHTML = '<p>Let $x^2$ be <b>$ y $</b>.</p><pre>$z$</pre><p class="no">$w$</p>';
    renderMathInElement(document.body, { ignoredClasses: ['no'] });
    const [p, pre, no] = document.body.children;
    expect(p!.querySelectorAll('.typlet')).toHaveLength(2);
    expect(p!.querySelector('b .typlet-display annotation')!.textContent).toBe(' y ');
    expect(p!.textContent).toContain('Let ');
    expect(pre!.textContent).toBe('$z$');
    expect(no!.textContent).toBe('$w$');
  });

  it('joins adjacent text nodes', () => {
    document.body.innerHTML = '<p></p>';
    const p = document.body.firstElementChild!;
    p.append('a $x', ' + y$ b');
    renderMathInElement(p);
    expect(p.querySelector('annotation')!.textContent).toBe('x + y');
    expect(p.textContent!.startsWith('a ')).toBe(true);
  });

  it('leaves rendered formulas alone', () => {
    document.body.innerHTML = '<p>$x$ and $"$"$</p>';
    renderMathInElement(document.body);
    const html = document.body.innerHTML;
    renderMathInElement(document.body);
    expect(document.body.innerHTML).toBe(html);
  });

  it('leaves a formula that fails as text', () => {
    document.body.innerHTML = '<p>a $foo$ b</p>';
    const errorCallback = vi.fn();
    renderMathInElement(document.body, { errorCallback });
    expect(document.body.textContent).toBe('a $foo$ b');
    expect(errorCallback).toHaveBeenCalledOnce();
    expect(errorCallback.mock.calls[0]![1]).toBeInstanceOf(TypletError);
  });

  it('renders the error in place without throwOnError', () => {
    document.body.innerHTML = '<p>a $foo$ b</p>';
    renderMathInElement(document.body, { throwOnError: false });
    expect(document.body.querySelector('.typlet-error')).not.toBeNull();
  });

  it('numbers display equations in order', () => {
    document.body.innerHTML = '<p>$ a $</p><p>$b$</p><p>$ c $</p>';
    renderMathInElement(document.body, { preamble: NUMBERING, output: 'mathml' });
    const numbers = [...document.querySelectorAll('.typlet-display .t:last-child')].map((t) => t.textContent);
    expect(numbers).toEqual(['(1)', '(2)']);
  });
});

describe('copy-typst', () => {
  const fragmentOf = (html: string) => {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content;
  };

  it.each(['htmlAndMathml', 'html', 'mathml'] as const)('replaces %s formulas with their source', (output) => {
    const inline = renderToString('x^2 < "a"', { output });
    const display = renderToString('sum_i i', { output, displayMode: true });
    const fragment = fragmentOf(`<p>Let ${inline} and</p>${display}`);
    expect(typletReplaceWithSource(fragment).textContent).toBe('Let $x^2 < "a"$ and$ sum_i i $');
  });

  it.each(['htmlAndMathml', 'html', 'mathml'] as const)('leaves out the number of a numbered %s equation', (output) => {
    const display = renderToString('a + b', { output, displayMode: true, preamble: NUMBERING });
    expect(typletReplaceWithSource(fragmentOf(display)).textContent).toBe('$ a + b $');
  });

  it('takes delimiters of its own', () => {
    const fragment = fragmentOf(renderToString('x', { displayMode: true }));
    const delimiters = { ...defaultCopyDelimiters, display: ['$$', '$$'] as const };
    expect(typletReplaceWithSource(fragment, delimiters).textContent).toBe('$$x$$');
  });

  it('puts a selection’s formulas on the clipboard as source', () => {
    document.body.innerHTML = `<p id="p">Let ${renderToString('x^2')} be big.</p>`;
    const p = document.getElementById('p')!;
    // A selection from inside the formula to the end grows to hold all of it.
    const range = document.createRange();
    range.setStart(p.querySelector('.typlet-html')!, 0);
    range.setEnd(p.lastChild!, 3);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const data = new Map<string, string>();
    const event = {
      target: p,
      clipboardData: { setData: (type: string, value: string) => data.set(type, value) },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;
    handleCopy(event);
    expect(data.get('text/plain')).toBe('$x^2$ be');
    expect(data.get('text/html')).toContain('class="typlet"');
    expect(event.preventDefault).toHaveBeenCalled();
  });
});

describe('<typlet-math>', () => {
  beforeEach(() => {
    for (const key of Object.keys(elementOptions)) delete elementOptions[key as keyof typeof elementOptions];
  });

  it('renders its text', async () => {
    document.body.innerHTML = '<typlet-math>x^2</typlet-math><typlet-math display output="mathml">y</typlet-math>';
    await tick();
    const [inline, display] = document.querySelectorAll('typlet-math');
    expect(inline).toBeInstanceOf(TypletMathElement);
    expect(inline!.querySelector('.typlet annotation')!.textContent).toBe('x^2');
    expect(display!.querySelector('.typlet-display math[display="block"]')).not.toBeNull();
    expect(display!.querySelector('.typlet-html')).toBeNull();
  });

  it('renders a new source', async () => {
    document.body.innerHTML = '<typlet-math source="a"></typlet-math>';
    await tick();
    const element = document.querySelector('typlet-math') as TypletMathElement;
    expect(element.querySelector('annotation')!.textContent).toBe('a');
    element.source = 'b + c';
    expect(element.querySelector('annotation')!.textContent).toBe('b + c');
    element.setAttribute('display', '');
    expect(element.querySelector('.typlet-display')).not.toBeNull();
  });

  it('shows an invalid formula’s source in the error color', async () => {
    document.body.innerHTML = '<typlet-math>foo</typlet-math>';
    await tick();
    expect(document.querySelector('typlet-math .typlet-error')!.textContent).toBe('foo');
  });

  it('uses the shared options', async () => {
    elementOptions.preamble = '#let RR = $bb(R)$';
    document.body.innerHTML = '<typlet-math>RR</typlet-math>';
    await tick();
    expect(document.querySelector('typlet-math math')!.textContent).toContain('ℝ');
  });
});
