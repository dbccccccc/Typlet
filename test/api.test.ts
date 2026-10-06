import { describe, expect, it } from 'vitest';
import { kindName, parse, render, renderToString, type RenderOptions, SyntaxKind, TypletError } from '../src/index.js';
import * as mathmlEntry from '../src/mathml.js';

describe('parse', () => {
  it('parses formulas in math mode by default', () => {
    const tree = parse('x^2');
    expect(tree.kind).toBe(SyntaxKind.Math);
    expect(tree.children[0]?.kind).toBe(SyntaxKind.MathAttach);
    expect(tree.fullText()).toBe('x^2');
  });

  it('parses preambles in markup mode and code in code mode', () => {
    expect(parse('#let x = 1', { mode: 'markup' }).kind).toBe(SyntaxKind.Markup);
    expect(parse('(x) => x', { mode: 'code' }).children[0]?.kind).toBe(SyntaxKind.Closure);
  });

  it('keeps errors in the tree, with offsets in UTF-16 code units', () => {
    const tree = parse('𝑥 + #(1 +)');
    expect(tree.erroneous()).toBe(true);
    expect(tree.diagnostics()).toEqual([
      { severity: 'error', message: 'expected expression', hints: [], start: 10, end: 10 },
    ]);
  });

  it('reports syntax warnings', () => {
    const [warning] = parse('```js```', { mode: 'markup' }).diagnostics();
    expect(warning).toMatchObject({ severity: 'warning', message: 'empty raw text' });
  });

  it('names kinds as Typst does', () => {
    expect(kindName(SyntaxKind.MathIdent)).toBe('math identifier');
    expect(SyntaxKind[SyntaxKind.MathIdent]).toBe('MathIdent');
  });
});

describe('renderToString', () => {
  const mathml = (src: string, options: RenderOptions = {}) => renderToString(src, { output: 'mathml', ...options });

  it('renders MathML with the source as an annotation', () => {
    expect(mathml('x^2')).toBe(
      '<span class="typlet"><math><semantics><msup><mi>𝑥</mi><mn>2</mn></msup>' +
        '<annotation encoding="application/x-typst">x^2</annotation></semantics></math></span>',
    );
  });

  it('groups several top-level nodes and renders display formulas as blocks', () => {
    const out = mathml('a + b', { displayMode: true });
    expect(out).toMatch(
      /^<span class="typlet-display"><span class="typlet"><math display="block"><semantics><mrow><mi>𝑎<\/mi><mo>\+<\/mo><mi>𝑏<\/mi><\/mrow><annotation/,
    );
  });

  it('escapes the source in the annotation', () => {
    expect(mathml('a < b')).toContain('<annotation encoding="application/x-typst">a &lt; b</annotation>');
  });

  it('renders HTML for the eyes and MathML for screen readers by default', () => {
    const out = renderToString('x^2');
    expect(out).toMatch(/^<span class="typlet"><span class="typlet-mathml"><math><semantics>/);
    expect(out).toContain('<span class="typlet-html" aria-hidden="true"><span class="f" style="');
    // The 2 is a script-size glyph, drawn from a private-use code point.
    expect(out).toMatch(/<span class="g" style="[^"]*">𝑥<\/span><span class="g" style="font-size:0\.7em;[^"]*">\u{E000}?[\u{E000}-\u{F8FF}]<\/span>/u);
  });

  it('renders HTML alone with the source as its label', () => {
    const out = renderToString('a < b', { output: 'html' });
    expect(out).toMatch(/^<span class="typlet"><span class="typlet-html" role="img" aria-label="a &#60; b">/);
    expect(out).not.toContain('<math');
  });

  it('breaks inline formulas after relations, and keeps display ones whole', () => {
    // The thick space after `=` stays with it, as a margin, at a line's end.
    const pieces = renderToString('a = b', { output: 'html' }).match(/<span class="f" style="[^"]*"/g);
    expect(pieces).toHaveLength(2);
    expect(pieces?.[0]).toMatch(/;margin-right:0\.2778em"$/);
    expect(pieces?.[1]).not.toContain('margin');
    const display = renderToString('a = b', { output: 'html', displayMode: true });
    expect(display.match(/class="f"/g)).toHaveLength(1);
    expect(display).toMatch(/^<span class="typlet-display">/);
  });

  it('draws rules for fractions and roots', () => {
    expect(renderToString('1/2', { output: 'html' }).match(/class="r"/g)).toHaveLength(1);
    expect(renderToString('sqrt(x)', { output: 'html' }).match(/class="r"/g)).toHaveLength(1);
  });

  it('shows formulas the HTML cannot draw as MathML, with a warning', () => {
    const seen: string[] = [];
    const out = renderToString('#left', {
      strict: (w) => {
        seen.push(w.message);
        return 'ignore';
      },
    });
    expect(out).toMatch(/^<span class="typlet"><math>/);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/drawn as MathML$/);
    expect(() => renderToString('#left', { output: 'html' })).toThrow(TypletError);
  });

  it('reports syntax errors with Typst’s message and span', () => {
    const error = catchError(() => mathml('x + #(1 +)'));
    expect(error.kind).toBe('syntax');
    expect(error.message).toBe('expected expression');
    expect(error.span).toEqual({ start: 9, end: 9 });
  });

  it('reports evaluation errors with hints', () => {
    const error = catchError(() => mathml('foo'));
    expect(error.kind).toBe('eval');
    expect(error.message).toBe('unknown variable: foo');
    expect(error.span).toEqual({ start: 0, end: 3 });
    expect(error.hints[0]).toContain('try adding spaces between each letter');
  });

  it('refuses unsupported constructs by name', () => {
    const error = catchError(() => mathml('#for i in (1, 2) [#i]'));
    expect(error.kind).toBe('unsupported');
    expect(error.message).toBe('Typlet does not support loops');
  });

  it('stops at its budgets', () => {
    expect(catchError(() => mathml('#("x" * 200000)')).kind).toBe('limit');
    expect(catchError(() => mathml('#("x" * 20)', { maxStringLength: 10 })).kind).toBe('limit');
    expect(catchError(() => mathml('#((1,) * 20)', { maxCollectionSize: 10 })).kind).toBe('limit');
    expect(catchError(() => mathml('x + y', { maxOutputSize: 10 })).kind).toBe('limit');
  });

  it('renders errors in place when throwOnError is false', () => {
    expect(mathml('foo', { throwOnError: false, errorColor: '#00f' })).toBe(
      '<span class="typlet-error" title="TypletError: unknown variable: foo" style="color:#00f">foo</span>',
    );
  });

  it('handles warnings as `strict` says', () => {
    expect(() => mathml('gt.tri', { strict: 'ignore' })).not.toThrow();
    expect(catchError(() => mathml('gt.tri', { strict: 'error' })).message).toBe(
      '`gt.tri` is deprecated, use `gt.closed` instead',
    );
    const seen: string[] = [];
    mathml('gt.tri', {
      strict: (warning) => {
        seen.push(warning.message);
        return 'ignore';
      },
    });
    expect(seen).toEqual(['`gt.tri` is deprecated, use `gt.closed` instead']);
  });

  it('renders into an element', () => {
    const element = { innerHTML: '' };
    render('x', element, { output: 'mathml' });
    expect(element.innerHTML).toContain('<mi>𝑥</mi>');
  });
});

describe('typlet/mathml', () => {
  it('renders MathML by default', () => {
    expect(mathmlEntry.renderToString('x^2')).toBe(renderToString('x^2', { output: 'mathml' }));
    const element = { innerHTML: '' };
    mathmlEntry.render('x', element);
    expect(element.innerHTML).toContain('<mi>𝑥</mi>');
  });

  it('refuses other outputs', () => {
    const error = catchError(() => mathmlEntry.renderToString('x', { output: 'html' }));
    expect(error.kind).toBe('unsupported');
    expect(error.message).toBe("`typlet/mathml` renders only `output: 'mathml'`");
  });
});

function catchError(f: () => unknown): TypletError {
  try {
    f();
  } catch (e) {
    if (e instanceof TypletError) return e;
    throw e;
  }
  throw new Error('expected a TypletError');
}

describe('embedded code Levels 2 and 3', () => {
  const quiet = { strict: 'ignore' } as const;

  it('evaluates a preamble once for the formulas after it', () => {
    const preamble = '#let norm(x) = $lr(|| #x ||)$\n#set math.mat(delim: "[")';
    const out = renderToString('norm(v) + mat(1, 2)', { preamble, output: 'mathml' });
    expect(out).toContain('<mo>‖</mo><mi>𝑣</mi><mo>‖</mo>');
    expect(out).toContain('<mo>[</mo>');
  });

  it('reports a preamble’s errors in the preamble', () => {
    const error = catchError(() => renderToString('x', { preamble: '#let f(x) = x\n#f()' }));
    expect(error.kind).toBe('eval');
    expect(error.message).toBe('missing argument: x');
    expect(error.diagnostics[0]).toMatchObject({ in: 'preamble', span: { start: 15, end: 18 } });
  });

  it('reports a preamble’s warnings with its first formula only', () => {
    const warnings: string[] = [];
    const strict = (w: { message: string }) => (warnings.push(w.message), 'ignore' as const);
    const preamble = '#let is = 1 // A preamble of its own.';
    renderToString('x', { preamble, strict });
    renderToString('y', { preamble, strict });
    expect(warnings.filter((w) => w.startsWith('`is` will likely become a keyword'))).toHaveLength(1);
  });

  it('numbers display equations with the caller’s counter', () => {
    const preamble = '#set math.equation(numbering: "(1)")';
    const equationCounter = { value: 0 };
    const first = renderToString('a', { preamble, displayMode: true, equationCounter, ...quiet });
    const second = renderToString('b', { preamble, displayMode: true, equationCounter, ...quiet });
    expect(first).toMatch(/^<span class="typlet-display n">/);
    expect(first).toContain('</math>(1)</span>');
    expect(second).toContain('</math>(2)</span>');
    expect(equationCounter.value).toBe(2);
    // Inline equations aren't numbered.
    expect(renderToString('c', { preamble, equationCounter, ...quiet })).not.toContain('(3)');
  });

  it('draws links only where trust allows them', () => {
    const source = '#link("https://typst.app")[$x$]';
    const warnings: string[] = [];
    const strict = (w: { message: string }) => (warnings.push(w.message), 'ignore' as const);
    expect(renderToString(source, { output: 'html', strict })).not.toContain('href=');
    expect(warnings).toEqual(["Typlet left out a link to https://typst.app, as the `trust` option doesn't allow it"]);
    expect(renderToString(source, { output: 'html', trust: true })).toContain('<a class="l" href="https://typst.app"');
    const trust = ({ url }: { url: string }) => url.startsWith('https://typst.app');
    expect(renderToString(source, { trust })).toContain('<a href="https://typst.app">');
    expect(renderToString('#link("https://example.com")[$x$]', { trust, ...quiet })).not.toContain('href=');
  });

  it('draws bold and colored text', () => {
    expect(renderToString('#strong[bold]', { output: 'html' })).toContain('<span class="g b" style="left:0em;top:-0.317em">bold</span>');
    expect(renderToString('#text(fill: red)[$x$]', { output: 'html' })).toContain('color:#ff4136');
  });

  it('hands refused formulas to the fallback', () => {
    const fallback = (source: string, error: TypletError) => `<img alt="${source}" title="${error.message}">`;
    // A show rule is refused in a content block; directly in math, it is an error in Typst too.
    expect(renderToString('#[#show "x": "y"\nx]', { fallback })).toBe('<img alt="#[#show "x": "y"\nx]" title="Typlet does not support `show` rules">');
    // Errors in Typst's own terms don't go to the fallback.
    expect(() => renderToString('foo', { fallback })).toThrow('unknown variable: foo');
  });

  it('shows the source until a fallback’s promise resolves', async () => {
    const element = { innerHTML: '' };
    let resolve: (html: string) => void = () => {};
    const fallback = () => new Promise<string>((r) => (resolve = r));
    render('#[#show "x": "y"\nx]', element, { fallback });
    expect(element.innerHTML).toBe('<span class="typlet-pending">#[#show &#34;x&#34;: &#34;y&#34;\nx]</span>');
    resolve('<svg></svg>');
    await Promise.resolve();
    expect(element.innerHTML).toBe('<svg></svg>');
    // `renderToString` can't wait for it.
    expect(() => renderToString('#[#show "x": "y"\nx]', { fallback })).toThrow('Typlet does not support `show` rules');
  });
});
