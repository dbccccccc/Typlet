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


describe('clipboard fragment serialization', () => {
  const fragmentOf = (html: string) => {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content;
  };
  const copy = (element: Element, range?: Range) => {
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(element);
    }
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const data = new Map<string, string>();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: (type: string, value: string) => data.set(type, value) } });
    element.dispatchEvent(event);
    return { event, data };
  };

  it('preserves literal tags and entities beside a formula', () => {
    document.body.innerHTML = '<p></p>';
    const p = document.body.firstElementChild!;
    p.append('<em>text</em> &amp; ', fragmentOf(renderToString('x')), ' after');
    const original = p.innerHTML;
    const { event, data } = copy(p);
    expect(event.defaultPrevented).toBe(true);
    expect(data.get('text/plain')).toBe('<em>text</em> &amp; $x$ after');
    const parsed = fragmentOf(data.get('text/html')!);
    expect(parsed.querySelector('em')).toBeNull();
    expect(parsed.firstChild?.textContent).toBe('<em>text</em> &amp; ');
    expect(typletReplaceWithSource(parsed).textContent).toBe('<em>text</em> &amp; $x$ after');
    expect(p.innerHTML).toBe(original);
  });

  it('serializes multiple top-level text nodes and formulas in order', () => {
    document.body.innerHTML = '<p></p>';
    const p = document.body.firstElementChild!;
    p.append('a <b> ', fragmentOf(renderToString('x')), ' &amp; ', '"quotes" ', fragmentOf(renderToString('y')), ' end >');
    const { event, data } = copy(p);
    expect(event.defaultPrevented).toBe(true);
    expect(data.get('text/plain')).toBe('a <b> $x$ &amp; "quotes" $y$ end >');
    const parsed = fragmentOf(data.get('text/html')!);
    expect(parsed.querySelector('b')).toBeNull();
    expect(parsed.querySelectorAll('.typlet')).toHaveLength(2);
    expect(typletReplaceWithSource(parsed).textContent).toBe('a <b> $x$ &amp; "quotes" $y$ end >');
  });

  it.each(['<>&"\'', '&amp; &lt; &#38;', '<span>literal</span>', '😀 &amp;\nline'])('preserves literal mixed text %j', (literal) => {
    document.body.innerHTML = '<p></p>';
    const p = document.body.firstElementChild!;
    p.append(literal + ' ', fragmentOf(renderToString('x')), ' ' + literal);
    const { event, data } = copy(p);
    const expected = literal + ' $x$ ' + literal;
    expect(event.defaultPrevented).toBe(true);
    expect(data.get('text/plain')).toBe(expected);
    const parsed = fragmentOf(data.get('text/html')!);
    expect(parsed.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(parsed.firstChild?.textContent).toBe(literal + ' ');
    expect(parsed.lastChild?.textContent).toBe(' ' + literal);
    expect(typletReplaceWithSource(parsed).textContent).toBe(expected);
  });

  it('preserves real strong and em formatting around copied formulas', () => {
    document.body.innerHTML = '<p></p>';
    const p = document.body.firstElementChild!;
    const strong = document.createElement('strong');
    strong.textContent = '<literal &amp;>';
    const em = document.createElement('em');
    em.textContent = 'emphasis';
    p.append('prefix ', strong, ' ', fragmentOf(renderToString('x')), ' ', em, ' suffix');
    const original = p.innerHTML;
    const { data } = copy(p);
    const parsed = fragmentOf(data.get('text/html')!);
    expect(parsed.querySelectorAll('strong')).toHaveLength(1);
    expect(parsed.querySelector('strong')?.textContent).toBe('<literal &amp;>');
    expect(parsed.querySelectorAll('em')).toHaveLength(1);
    expect(parsed.querySelector('em')?.textContent).toBe('emphasis');
    expect(typletReplaceWithSource(parsed).textContent).toBe('prefix <literal &amp;> $x$ emphasis suffix');
    expect(data.get('text/plain')).toBe('prefix <literal &amp;> $x$ emphasis suffix');
    expect(p.innerHTML).toBe(original);
  });

  it('expands both formula boundaries without modifying the original range', () => {
    document.body.innerHTML = '<p></p>';
    const p = document.body.firstElementChild!;
    p.append('before ', fragmentOf(renderToString('x')), ' between ', fragmentOf(renderToString('y')), ' after');
    const [first, last] = p.querySelectorAll('.typlet-html');
    const range = document.createRange();
    range.setStart(first!, 0);
    range.setEnd(last!, 0);
    const original = p.innerHTML;
    const { data } = copy(p, range);
    expect(data.get('text/plain')).toBe('$x$ between $y$');
    const parsed = fragmentOf(data.get('text/html')!);
    expect(parsed.querySelectorAll('.typlet')).toHaveLength(2);
    expect(typletReplaceWithSource(parsed).textContent).toBe('$x$ between $y$');
    expect(range.startContainer).toBe(first);
    expect(range.startOffset).toBe(0);
    expect(range.endContainer).toBe(last);
    expect(range.endOffset).toBe(0);
    expect(p.innerHTML).toBe(original);
  });

  it.each(['htmlAndMathml', 'html', 'mathml'] as const)('copies numbered display %s source without its number', (output) => {
    document.body.innerHTML = '<p></p>';
    const p = document.body.firstElementChild!;
    p.append('before ', fragmentOf(renderToString('a + b', { output, displayMode: true, preamble: NUMBERING })), ' after');
    const { data } = copy(p);
    expect(data.get('text/plain')).toBe('before $ a + b $ after');
    const parsed = fragmentOf(data.get('text/html')!);
    expect(parsed.querySelector('.typlet-display.n')?.textContent).toContain('(1)');
    expect(typletReplaceWithSource(parsed).textContent).toBe('before $ a + b $ after');
  });

  it('allows custom delimiters when replacing the serialized clipboard fragment', () => {
    document.body.innerHTML = '<p></p>';
    const p = document.body.firstElementChild!;
    p.append(fragmentOf(renderToString('x')), ' and ', fragmentOf(renderToString('y', { displayMode: true })));
    const { data } = copy(p);
    expect(data.get('text/plain')).toBe('$x$ and $ y $');
    const parsed = fragmentOf(data.get('text/html')!);
    const delimiters = { inline: ['\\(', '\\)'] as const, display: ['\\[', '\\]'] as const };
    expect(typletReplaceWithSource(parsed, delimiters).textContent).toBe('\\(x\\) and \\[y\\]');
  });

  it.each(['htmlAndMathml', 'html', 'mathml'] as const)('copies %s source with whitespace in a custom number', (output) => {
    const source = ' x + "a<&" \n ';
    document.body.innerHTML = '<p></p>';
    const p = document.body.firstElementChild!;
    p.append(fragmentOf(renderToString(source, {
      output, displayMode: true, preamble: '#set math.equation(numbering: n => [ #n ])',
    })));
    const { data } = copy(p);
    expect(data.get('text/plain')).toBe(`$ ${source} $`);
    expect(typletReplaceWithSource(fragmentOf(data.get('text/html')!)).textContent).toBe(`$ ${source} $`);
  });

  it('preserves carriage returns in the HTML-only source attribute', () => {
    const source = ' x + y\r\n ';
    const html = renderToString(source, { output: 'html', displayMode: true, preamble: NUMBERING });
    expect(typletReplaceWithSource(fragmentOf(html)).textContent).toBe(`$ ${source} $`);
  });

  it.each([
    ['paragraphs', '<p>First FORMULA</p><p>Second OTHER</p>', 'First $x$\n\nSecond $y$'],
    ['line breaks', '<div>First FORMULA<br>Second OTHER<br></div>', 'First $x$\nSecond $y$\n'],
    ['list items', '<ul><li>First FORMULA</li><li>Second OTHER</li></ul>', 'First $x$\nSecond $y$'],
    ['table cells', '<table><tr><td>First FORMULA</td><td>Second OTHER</td></tr><tr><td>Next</td><td>cell</td></tr></table>', 'First $x$\tSecond $y$\nNext\tcell'],
    ['empty table cells', '<table><tr><td></td><td>FORMULA</td><td></td></tr><tr><td>OTHER</td><td></td><td>C</td></tr></table>', '\t$x$\t\n$y$\t\tC'],
    ['empty table rows and headers', '<table><caption>Title</caption><tr><th></th></tr><tr><th>FORMULA</th><th></th><th></th><th>OTHER</th></tr><tr><td></td></tr></table>', 'Title\n\n$x$\t\t\t$y$\n'],
  ])('preserves %s in copied plain text', (_, markup, expected) => {
    document.body.innerHTML = '<div></div>';
    const div = document.body.firstElementChild!;
    div.innerHTML = markup!.replace('FORMULA', renderToString('x')).replace('OTHER', renderToString('y'));
    const original = div.innerHTML;
    const { data } = copy(div);
    expect(data.get('text/plain')).toBe(expected);
    expect(fragmentOf(data.get('text/html')!).querySelectorAll('.typlet')).toHaveLength(2);
    expect(div.innerHTML).toBe(original);
  });

  it('preserves empty cells in a real Range crossing table columns', () => {
    document.body.innerHTML = `<table><tr><td>${renderToString('x')}</td><td></td><td>C</td></tr></table>`;
    const table = document.querySelector('table')!;
    const range = document.createRange();
    range.setStart(table.querySelector('.typlet-html')!, 0);
    range.setEnd(table.querySelectorAll('td')[2]!.firstChild!, 1);
    expect(copy(table, range).data.get('text/plain')).toBe('$x$\t\tC');
  });

  it('preserves leading and trailing empty rows when row wrappers are omitted', () => {
    document.body.innerHTML = `<table><tr><td></td></tr><tr><td>${renderToString('x')}</td></tr><tr><td></td></tr></table>`;
    const body = document.querySelector('tbody')!;
    const range = document.createRange();
    range.selectNodeContents(body);
    expect(copy(body, range).data.get('text/plain')).toBe('\n$x$\n');
  });

  it('does not intercept a selection without formulas', () => {
    document.body.innerHTML = '<p></p>';
    const p = document.body.firstElementChild!;
    p.textContent = '<em>literal</em> &amp;';
    const original = p.innerHTML;
    const { event, data } = copy(p);
    expect(event.defaultPrevented).toBe(false);
    expect(data.size).toBe(0);
    expect(p.innerHTML).toBe(original);
  });

});
