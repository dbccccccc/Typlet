import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import markdownItTyplet, { type Options } from './index.js';

const render = (markdown: string, options?: Options) => new MarkdownIt().use(markdownItTyplet, options).render(markdown);
const sources = (html: string) => [...html.matchAll(/<annotation encoding="application\/x-typst">(.*?)<\/annotation>/gs)].map((m) => m[1]);

describe('markdown-it-typlet', () => {
  it('renders inline math', () => {
    const html = render('Let $x^2$ and $"$"$ be.');
    expect(html).toMatch(/^<p>Let <span class="typlet">/);
    expect(sources(html)).toEqual(['x^2', '"$"']);
  });

  it('leaves dollar amounts as text, as Pandoc does', () => {
    expect(render('It costs $5 and $10, or $ x$.')).toBe('<p>It costs $5 and $10, or $ x$.</p>\n');
    expect(render('Prices: $5, $10.')).toBe('<p>Prices: $5, $10.</p>\n');
    expect(render('Escaped: \\$x$.')).toBe('<p>Escaped: $x$.</p>\n');
  });

  it('renders $$ as display math, inline and on lines of their own', () => {
    const html = render('A $$x$$ b\n\n$$\nsum_i i\n$$\n\n$$ y $$\n');
    expect(html.match(/typlet-display/g)).toHaveLength(3);
    expect(sources(html)).toEqual(['x', 'sum_i i', 'y']);
    expect(html).toMatch(/<\/p>\n<span class="typlet-display">/);
  });

  it('keeps a display formula in a list item', () => {
    const html = render('- item\n\n  $$\n  a + b\n  $$\n');
    expect(html).toMatch(/<li>\n<p>item<\/p>\n<span class="typlet-display">/);
  });

  it('reads Typst’s syntax on request', () => {
    const html = render('Inline $x$ and display $ y $, and $#box[$z$]$.', { delimiters: 'typst' });
    expect(sources(html)).toEqual(['x', ' y ', '#box[$z$]']);
    expect(html.match(/typlet-display/g)).toHaveLength(1);
  });

  it('renders a failed formula in the error color', () => {
    expect(render('$foo$')).toContain('<span class="typlet-error"');
    expect(() => render('$foo$', { throwOnError: true })).toThrow('unknown variable: foo');
  });

  it('numbers each document from 1', () => {
    const md = new MarkdownIt().use(markdownItTyplet, { preamble: '#set math.equation(numbering: "(1)")', output: 'mathml' });
    const html = md.render('$$\na\n$$\n\n$$\nb\n$$\n');
    expect(html.match(/>\((\d)\)</g)).toEqual(['>(1)<', '>(2)<']);
    expect(md.render('$$\nc\n$$\n')).toContain('>(1)<');
  });
});
