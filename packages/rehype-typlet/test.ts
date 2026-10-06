import rehypeStringify from 'rehype-stringify';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';
import rehypeTyplet, { type Options } from './index.js';

async function process(markdown: string, options?: Options) {
  const file = await unified()
    .use(remarkParse)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeTyplet, options)
    .use(rehypeStringify)
    .process(markdown);
  return { html: String(file), messages: file.messages };
}

describe('rehype-typlet', () => {
  it('renders inline and display math', async () => {
    const { html, messages } = await process('Let $x^2$ be.\n\n$$\nsum_(i=1)^n i\n$$\n');
    expect(html).toMatch(/<p>Let <span class="typlet"><span class="typlet-mathml"><math><semantics>/);
    expect(html).toContain('<annotation encoding="application/x-typst">x^2</annotation>');
    expect(html).toContain('<span class="typlet-display">');
    expect(html).toContain('<annotation encoding="application/x-typst">sum_(i=1)^n i</annotation>');
    expect(html).not.toContain('math-display');
    expect(messages).toEqual([]);
  });

  it('renders ```math fences as display formulas', async () => {
    const { html } = await process('```math\na/b\n```\n');
    expect(html).toMatch(/^<span class="typlet-display">/);
    expect(html).not.toContain('<pre>');
  });

  it('passes options and numbers each document from 1', async () => {
    const options = { output: 'mathml', preamble: '#set math.equation(numbering: "(1)")\n#let RR = $bb(R)$' } as const;
    const { html } = await process('$$\nRR\n$$\n\n$$\nRR^2\n$$\n', options);
    expect(html).toContain('ℝ');
    expect(html).not.toContain('typlet-html');
    expect(html.match(/>\((\d)\)</g)).toEqual(['>(1)<', '>(2)<']);
    expect((await process('$$\nx\n$$\n', options)).html).toContain('>(1)<');
  });

  it('renders a failed formula in the error color, with a message', async () => {
    const { html, messages } = await process('a $foo$ b');
    expect(html).toContain('<span class="typlet-error"');
    expect(messages).toHaveLength(1);
    expect(messages[0]!.reason).toBe('Could not render math with Typlet');
    expect(messages[0]!.ruleId).toBe('eval');
    expect(String(messages[0]!.cause)).toContain('unknown variable: foo');
  });

  it('turns warnings into messages', async () => {
    const { html, messages } = await process('$#link("https://typst.app")[T]$', { output: 'mathml' });
    expect(html).not.toContain('href');
    expect(messages.map((m) => m.reason)).toEqual(["Typlet left out a link to https://typst.app, as the `trust` option doesn't allow it"]);
  });
});
