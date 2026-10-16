// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { type RenderOptions, TypletError, render, renderToResult, renderToString } from '../src/index.js';

const OUTPUTS = ['html', 'htmlAndMathml', 'mathml'] as const;
const APIS = {
  renderToString,
  renderToResult: (source: string, options: RenderOptions) => {
    const result = renderToResult(source, options);
    expect(result.drawnAs).toBe('error');
    expect(result.warnings).toEqual([]);
    expect(result.number).toBeNull();
    return result.markup;
  },
  render: (source: string, options: RenderOptions) => {
    const element = { innerHTML: '' };
    render(source, element, options);
    return element.innerHTML;
  },
};

describe('bounded error markup', () => {
  for (const output of OUTPUTS) {
    for (const [name, draw] of Object.entries(APIS)) {
      it(`bounds ${name} errors in ${output}`, () => {
        const markup = draw('#(1 +)', { output, throwOnError: false, maxOutputSize: 64 });
        expect(markup.length).toBeLessThanOrEqual(64);
        expect(markup).toMatch(/^<span class="typlet-error"[^>]*>.*<\/span>$/);
      });
    }

    it(`bounds pending markup in ${output}`, () => {
      const element = { innerHTML: '' };
      render('#context [x]', element, { output, maxOutputSize: 16, fallback: () => new Promise<string>(() => {}) });
      expect(element.innerHTML).toBe('');
    });
  }

  it('keeps the default error bytes', () => {
    expect(renderToString('foo', { output: 'mathml', throwOnError: false, errorColor: '#00f' })).toBe(
      '<span class="typlet-error" title="TypletError: unknown variable: foo" style="color:#00f">foo</span>',
    );
  });

  it('keeps the thrown error and its diagnostics intact', () => {
    let thrown: unknown;
    try { renderToString('foo', { maxOutputSize: 0 }); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(TypletError);
    expect(thrown).toMatchObject({ kind: 'eval', source: 'foo', message: 'unknown variable: foo' });
    expect((thrown as TypletError).span).toEqual({ start: 0, end: 3 });
    expect((thrown as TypletError).hints[0]).toContain('try adding spaces');
  });
});

const ERROR_EMPTY = '<span class="typlet-error"></span>';
const PENDING_EMPTY = '<span class="typlet-pending"></span>';
const UNSUPPORTED = '#context [x]';

function parsedSpan(markup: string, className: string): Element {
  const template = document.createElement('template');
  template.innerHTML = markup;
  expect(template.content.childNodes).toHaveLength(1);
  expect(template.content.querySelectorAll('*')).toHaveLength(1);
  const span = template.content.firstElementChild!;
  expect(span.localName).toBe('span');
  expect(span.className).toBe(className);
  expect(markup.endsWith('</span>')).toBe(true);
  return span;
}

describe('error markup boundaries', () => {
  it.each([
    [0, ''],
    [1, ''],
    [ERROR_EMPTY.length - 1, ''],
    [ERROR_EMPTY.length, ERROR_EMPTY],
    [ERROR_EMPTY.length + 0.5, ERROR_EMPTY],
    [ERROR_EMPTY.length + 1, '<span class="typlet-error">…</span>'],
    [ERROR_EMPTY.length + 2, '<span class="typlet-error">f…</span>'],
  ] as const)('handles an error cap of %s', (maxOutputSize, expected) => {
    const result = renderToResult('foo', { throwOnError: false, maxOutputSize });
    expect(result.markup).toBe(expected);
    expect(result.markup.length).toBeLessThanOrEqual(maxOutputSize);
    expect(result.drawnAs).toBe('error');
    if (expected) {
      const span = parsedSpan(expected, 'typlet-error');
      expect(span.getAttributeNames()).toEqual(['class']);
    }
  });

  const rich = '<span class="typlet-error" title="TypletError: unknown variable: foo" style="color:#00f">foo</span>';
  it('keeps rich markup at the exact full length', () => {
    expect(renderToString('foo', { throwOnError: false, errorColor: '#00f', maxOutputSize: rich.length })).toBe(rich);
  });

  it('drops optional attributes when one character short of the full markup', () => {
    const markup = renderToString('foo', { throwOnError: false, errorColor: '#00f', maxOutputSize: rich.length - 1 });
    expect(markup).toBe('<span class="typlet-error">foo</span>');
  });

  it('keeps existing escaped title, color and source bytes when they fit', () => {
    const expected = '<span class="typlet-error" title="TypletError: unknown variable: unknown_name" style="color:red&#34;">#unknown_name &#60;&#38;😀</span>';
    const markup = renderToString('#unknown_name <&😀', { throwOnError: false, errorColor: 'red"', maxOutputSize: expected.length });
    expect(markup).toBe(expected);
    const span = parsedSpan(markup, 'typlet-error');
    expect(span.textContent).toBe('#unknown_name <&😀');
    expect(span.getAttribute('title')).toBe('TypletError: unknown variable: unknown_name');
    expect(span.getAttribute('style')).toBe('color:red"');
  });

  it.each([
    ['&', '&#38;'], ['<', '&#60;'], ['>', '&#62;'], ['"', '&#34;'], ["'", '&#39;'], ['😀', '😀'], ['\n', '\n'],
  ])('keeps the complete escaped boundary for %j', (char, escaped) => {
    const maxOutputSize = ERROR_EMPTY.length + escaped.length + 1;
    const markup = renderToString(char + '#unknown', { throwOnError: false, maxOutputSize });
    expect(markup).toBe('<span class="typlet-error">' + escaped + '…</span>');
    expect(markup.length).toBeLessThanOrEqual(maxOutputSize);
    expect(parsedSpan(markup, 'typlet-error').textContent).toBe(char + '…');
  });

  it('does not split a surrogate pair when only one UTF-16 unit remains', () => {
    const markup = renderToString('😀#unknown', { throwOnError: false, maxOutputSize: ERROR_EMPTY.length + 2 });
    expect(markup).toBe('<span class="typlet-error">…</span>');
    expect(parsedSpan(markup, 'typlet-error').textContent).toBe('…');
  });

  it('omits a long escaped error color without introducing attributes', () => {
    const markup = renderToString('foo', { throwOnError: false, maxOutputSize: 64, errorColor: '<&"'.repeat(128) });
    expect(markup).toBe('<span class="typlet-error">foo</span>');
    expect(parsedSpan(markup, 'typlet-error').getAttributeNames()).toEqual(['class']);
  });

  it('continues to throw unexpected native exceptions', () => {
    const native = new RangeError('native failure');
    expect(() => renderToString(UNSUPPORTED, { throwOnError: false, maxOutputSize: 0, fallback: () => { throw native; } })).toThrow(native);
  });
});

describe('bounded pending and rejected fallback markup', () => {
  const pending = '<span class="typlet-pending">#context [x]</span>';
  it.each([
    [0, ''],
    [PENDING_EMPTY.length - 1, ''],
    [PENDING_EMPTY.length, PENDING_EMPTY],
    [PENDING_EMPTY.length + 0.5, PENDING_EMPTY],
    [PENDING_EMPTY.length + 1, '<span class="typlet-pending">…</span>'],
    [pending.length - 1, '<span class="typlet-pending">#context […</span>'],
    [pending.length, pending],
  ] as const)('handles a pending cap of %s', (maxOutputSize, expected) => {
    const element = { innerHTML: '' };
    render(UNSUPPORTED, element, { maxOutputSize, fallback: () => new Promise<string>(() => {}) });
    expect(element.innerHTML).toBe(expected);
    expect(element.innerHTML.length).toBeLessThanOrEqual(maxOutputSize);
    if (expected) parsedSpan(expected, 'typlet-pending');
  });

  it('keeps default pending bytes, including escaped content', () => {
    const element = { innerHTML: '' };
    render('#context [<>&"\'😀\n]', element, { fallback: () => new Promise<string>(() => {}) });
    expect(element.innerHTML).toBe('<span class="typlet-pending">#context [&#60;&#62;&#38;&#34;&#39;😀\n]</span>');
    expect(parsedSpan(element.innerHTML, 'typlet-pending').textContent).toBe('#context [<>&"\'😀\n]');
  });

  it('keeps a pending preview on an entity boundary', () => {
    const element = { innerHTML: '' };
    const maxOutputSize = PENDING_EMPTY.length + '#context ['.length + '&#60;'.length + 1;
    render('#context [<>&"\'😀\n]', element, { maxOutputSize, fallback: () => new Promise<string>(() => {}) });
    expect(element.innerHTML).toBe('<span class="typlet-pending">#context [&#60;…</span>');
    expect(element.innerHTML.length).toBe(maxOutputSize);
    expect(parsedSpan(element.innerHTML, 'typlet-pending').textContent).toBe('#context [<…');
  });

  it.each(OUTPUTS)('bounds a rejected TypletError in %s', async (output) => {
    const message = '<&😀'.repeat(128);
    const diagnostic = { severity: 'error' as const, message, hints: ['original hint'], span: { start: 0, end: 1 }, in: 'formula' as const };
    const error = new TypletError('eval', [diagnostic], 'original rejected source');
    const element = { innerHTML: '' };
    render(UNSUPPORTED, element, { output, maxOutputSize: 64, fallback: () => Promise.reject(error) });
    await Promise.resolve();
    expect(element.innerHTML).toBe('<span class="typlet-error">#context [x]</span>');
    expect(element.innerHTML.length).toBeLessThanOrEqual(64);
    expect(parsedSpan(element.innerHTML, 'typlet-error').textContent).toBe(UNSUPPORTED);
    expect(error.message).toBe(message);
    expect(error.source).toBe('original rejected source');
    expect(error.diagnostics).toEqual([diagnostic]);
  });

  it('leaves immediate external fallback HTML to the caller', () => {
    const external = '<strong>trusted fallback</strong>';
    expect(renderToResult(UNSUPPORTED, { maxOutputSize: 0, fallback: () => external })).toEqual({
      markup: external, drawnAs: 'fallback', warnings: [], number: null,
    });
  });

  it('leaves resolved external fallback HTML to the caller', async () => {
    const external = '<strong>trusted fallback</strong>';
    const element = { innerHTML: '' };
    render(UNSUPPORTED, element, { maxOutputSize: 0, fallback: () => Promise.resolve(external) });
    expect(element.innerHTML).toBe('');
    await Promise.resolve();
    expect(element.innerHTML).toBe(external);
  });
});


describe('error sources and escaped metadata', () => {
  it.each(OUTPUTS)('bounds the error presentation after %s output exceeds its cap', (output) => {
    const result = renderToResult('x', { output, throwOnError: false, maxOutputSize: 64 });
    expect(result.drawnAs).toBe('error');
    expect(result.markup).toBe('<span class="typlet-error">x</span>');
  });

  it('omits a color whose escaped text exceeds the available attribute space', () => {
    const markup = renderToString('foo', { throwOnError: false, errorColor: '&'.repeat(16), maxOutputSize: 128 });
    expect(markup).toBe('<span class="typlet-error">foo</span>');
  });

  it('omits a title whose escaped text exceeds the available attribute space', async () => {
    const error = new TypletError('eval', [{ severity: 'error', message: '&'.repeat(32), hints: [], span: null, in: 'formula' }], UNSUPPORTED);
    const element = { innerHTML: '' };
    render(UNSUPPORTED, element, { maxOutputSize: 128, fallback: () => Promise.reject(error) });
    await Promise.resolve();
    expect(element.innerHTML).toBe('<span class="typlet-error">#context [x]</span>');
  });
});
