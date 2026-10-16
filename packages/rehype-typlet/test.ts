import type { Element, Root } from 'hast';
import { VFile } from 'vfile';
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

function mathNode(source: string, mode: 'inline' | 'display' | 'fenced'): Element {
  const code: Element = {
    type: 'element', tagName: 'code', properties: { className: [mode === 'fenced' ? 'language-math' : 'math-' + mode] },
    children: [{ type: 'text', value: source }],
  };
  return mode === 'fenced' ? { type: 'element', tagName: 'pre', properties: {}, children: [code] } : code;
}

function processAdjacent(sources: string[], mode: 'inline' | 'display' | 'fenced', options?: Options) {
  const nodes = sources.map((source) => mathNode(source, mode));
  const tree: Root = {
    type: 'root',
    children: mode === 'inline' ? [{ type: 'element', tagName: 'p', properties: {}, children: nodes }] : nodes,
  };
  const file = new VFile();
  const processor = unified().use(rehypeTyplet, options).use(rehypeStringify);
  processor.runSync(tree, file);
  return { html: processor.stringify(tree), messages: file.messages };
}

describe('rehype replacement traversal', () => {
  it.each(['inline', 'display', 'fenced'] as const)('processes each adjacent %s formula after empty previews', (mode) => {
    const { html, messages } = processAdjacent(['x', 'y', 'z'], mode, { maxOutputSize: 0 });
    expect(messages).toHaveLength(3);
    expect(messages.map((message) => message.ruleId)).toEqual(['limit', 'limit', 'limit']);
    expect(html).not.toMatch(/math-inline|math-display|language-math|<pre>|<code>/);
    expect(html).toBe(mode === 'inline' ? '<p></p>' : '');
  });

  it.each(['inline', 'display', 'fenced'] as const)('processes each adjacent %s formula after empty fallbacks', (mode) => {
    const called: string[] = [];
    const { html, messages } = processAdjacent(['#context x', '#context y', '#context z'], mode, {
      fallback: (source) => { called.push(source); return ''; },
    });
    expect(called).toEqual(['#context x', '#context y', '#context z']);
    expect(html).toBe(mode === 'inline' ? '<p></p>' : '');
    expect(messages).toEqual([]);
  });

  it.each(['inline', 'display', 'fenced'] as const)('keeps adjacent normal %s math after an empty fallback', (mode) => {
    const { html, messages } = processAdjacent(['#context x', 'y', 'z'], mode, { fallback: () => '' });
    expect(html.match(/<annotation encoding="application\/x-typst">/g)).toHaveLength(2);
    expect(html).toContain('>y</annotation>');
    expect(html).toContain('>z</annotation>');
    expect(html).not.toMatch(/math-inline|math-display|language-math|<pre>|<code>/);
    expect(messages).toEqual([]);
  });

  it.each(['inline', 'display', 'fenced'] as const)('does not revisit multiple fallback nodes for %s math', (mode) => {
    let calls = 0;
    const { html, messages } = processAdjacent(['#context x', 'y', '#context z'], mode, {
      fallback: () => { calls++; return '<b>before</b><code class="math-inline">raw</code><i>after</i>'; },
    });
    expect(calls).toBe(2);
    expect(html.match(/<code class="math-inline">raw<\/code>/g)).toHaveLength(2);
    expect(html.match(/<annotation encoding="application\/x-typst">/g)).toHaveLength(1);
    expect(html).toContain('>y</annotation>');
    expect(messages).toEqual([]);
  });

  it('preserves equation numbering across empty and multiple-node fenced fallbacks', async () => {
    const options = {
      output: 'mathml', preamble: '#set math.equation(numbering: "(1)")',
      fallback: (source: string) => source.includes('empty') ? '' : '<b>one</b><i>two</i>',
    } as const;
    const { html, messages } = processAdjacent(['#context empty', 'x', '#context many', 'y'], 'fenced', options);
    expect(html.match(/>\((\d)\)</g)).toEqual(['>(1)<', '>(2)<']);
    expect(messages).toEqual([]);
    expect((await process('$$\nx\n$$\n', options)).html).toContain('>(1)<');
  });
});
