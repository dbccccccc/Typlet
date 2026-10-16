// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { TypletError, render } from '../src/index.js';
import { TypletMathElement, elementOptions } from '../contrib/element.js';

const SOURCE = '#context [x]';

function deferred() {
  let resolve!: (markup: string) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

afterEach(() => {
  document.body.innerHTML = '';
  for (const key of Object.keys(elementOptions)) delete elementOptions[key as keyof typeof elementOptions];
});

describe('asynchronous render identity', () => {
  it('finishes a fallback after DOM entity normalization', async () => {
    const element = document.createElement('div');
    const job = deferred();
    const source = '#context [<>&"\'😀]';
    render(source, element, { fallback: () => job.promise });
    expect(element.querySelector('.typlet-pending')?.textContent).toBe(source);
    job.resolve('<b>resolved</b>');
    await Promise.resolve();
    expect(element.innerHTML).toBe('<b>resolved</b>');
    expect(element.querySelector('.typlet-pending')).toBeNull();
  });

  it('ignores an older same-source fallback that resolves first', async () => {
    const element = document.createElement('div');
    const first = deferred();
    const second = deferred();
    render(SOURCE, element, { displayMode: false, fallback: () => first.promise });
    render(SOURCE, element, { displayMode: true, fallback: () => second.promise });
    first.resolve('<b>old</b>');
    await Promise.resolve();
    expect(element.querySelector('.typlet-pending')?.textContent).toBe(SOURCE);
    second.resolve('<b>new</b>');
    await Promise.resolve();
    expect(element.innerHTML).toBe('<b>new</b>');
  });
});


function typedError(message = 'typed fallback failure'): TypletError {
  return new TypletError('eval', [{ severity: 'error', message, hints: ['original hint'], span: null, in: 'formula' }], SOURCE);
}

describe('fallback invocation lifetime', () => {
  it('supports an ordinary object target', async () => {
    const element = { innerHTML: '' };
    const job = deferred();
    render(SOURCE, element, { fallback: () => job.promise });
    expect(element.innerHTML).toBe('<span class="typlet-pending">#context [x]</span>');
    job.resolve('<b>object</b>');
    await Promise.resolve();
    expect(element.innerHTML).toBe('<b>object</b>');
  });

  it('keeps the newer same-source fallback when it resolves first', async () => {
    const element = document.createElement('div');
    const first = deferred();
    const second = deferred();
    render(SOURCE, element, { output: 'html', fallback: () => first.promise });
    render(SOURCE, element, { output: 'mathml', fallback: () => second.promise });
    second.resolve('<b>new</b>');
    await Promise.resolve();
    first.resolve('<b>old</b>');
    await Promise.resolve();
    expect(element.innerHTML).toBe('<b>new</b>');
  });

  it('expires old work after synchronous formula success', async () => {
    const element = document.createElement('div');
    const job = deferred();
    render(SOURCE, element, { fallback: () => job.promise });
    render('x', element);
    const markup = element.innerHTML;
    job.resolve('<b>old</b>');
    await Promise.resolve();
    expect(element.innerHTML).toBe(markup);
    expect(element.querySelector('annotation')?.textContent).toBe('x');
  });

  it('expires old work after a synchronous fallback result', async () => {
    const element = document.createElement('div');
    const job = deferred();
    render(SOURCE, element, { fallback: () => job.promise });
    render(SOURCE, element, { fallback: () => '<b>sync</b>' });
    job.resolve('<b>old</b>');
    await Promise.resolve();
    expect(element.innerHTML).toBe('<b>sync</b>');
  });

  it('expires old work after a rendered synchronous failure', async () => {
    const element = document.createElement('div');
    const job = deferred();
    render(SOURCE, element, { fallback: () => job.promise });
    render('foo', element, { throwOnError: false });
    const markup = element.innerHTML;
    job.resolve('<b>old</b>');
    await Promise.resolve();
    expect(element.innerHTML).toBe(markup);
    expect(element.querySelector('.typlet-error')?.textContent).toBe('foo');
  });

  it('expires old work even when the newer call throws a TypletError', async () => {
    const element = document.createElement('div');
    const job = deferred();
    render(SOURCE, element, { fallback: () => job.promise });
    const pending = element.innerHTML;
    expect(() => render('foo', element)).toThrow(TypletError);
    job.resolve('<b>old</b>');
    await Promise.resolve();
    expect(element.innerHTML).toBe(pending);
  });

  it('preserves synchronous native exceptions while expiring old work', async () => {
    const element = document.createElement('div');
    const job = deferred();
    const native = new RangeError('synchronous native failure');
    render(SOURCE, element, { fallback: () => job.promise });
    const pending = element.innerHTML;
    expect(() => render(SOURCE, element, { fallback: () => { throw native; } })).toThrow(native);
    job.resolve('<b>old</b>');
    await Promise.resolve();
    expect(element.innerHTML).toBe(pending);
  });

  it.each([
    ['typed', typedError()],
    ['native', new Error('obsolete native failure')],
    ['unknown', null],
  ])('consumes an obsolete %s rejection without changing the newer invocation', async (_name, error) => {
    const element = document.createElement('div');
    const first = deferred();
    const second = deferred();
    render(SOURCE, element, { fallback: () => first.promise });
    render(SOURCE, element, { fallback: () => second.promise });
    first.reject(error);
    await Promise.resolve();
    expect(element.querySelector('.typlet-pending')?.textContent).toBe(SOURCE);
    second.resolve('<b>current</b>');
    await Promise.resolve();
    expect(element.innerHTML).toBe('<b>current</b>');
  });

  it('renders a current typed rejection after entity normalization', async () => {
    const source = '#context [<>&"\'😀]';
    const element = document.createElement('div');
    const job = deferred();
    const error = typedError();
    render(source, element, { fallback: () => job.promise });
    job.reject(error);
    await Promise.resolve();
    expect(element.querySelector('.typlet-pending')).toBeNull();
    expect(element.querySelector('.typlet-error')?.textContent).toBe(source);
    expect(element.querySelector('.typlet-error')?.getAttribute('title')).toBe('TypletError: typed fallback failure');
    expect(error.hints).toEqual(['original hint']);
  });

  it.each([
    ['native', new RangeError('secret native details')],
    ['string', 'secret string details'],
    ['null', null],
    ['object', { toString: () => { throw new Error('must not stringify unknown rejection'); } }],
  ])('renders a bounded generic failure for a current %s rejection', async (_name, error) => {
    const element = document.createElement('div');
    const job = deferred();
    render(SOURCE, element, { fallback: () => job.promise });
    job.reject(error);
    await Promise.resolve();
    expect(element.querySelector('.typlet-pending')).toBeNull();
    const failed = element.querySelector('.typlet-error');
    expect(failed?.textContent).toBe(SOURCE);
    expect(failed?.getAttribute('title')).toBe('TypletError: fallback failed');
    expect(element.innerHTML).not.toContain('secret');
  });

  it.each(['resolve', 'reject'] as const)('preserves an external DOM edit on %s', async (mode) => {
    const element = document.createElement('div');
    const job = deferred();
    render(SOURCE, element, { fallback: () => job.promise });
    element.innerHTML = '<i>edited by the caller</i>';
    if (mode === 'resolve') job.resolve('<b>old</b>');
    else job.reject(new Error('obsolete failure'));
    await Promise.resolve();
    expect(element.innerHTML).toBe('<i>edited by the caller</i>');
  });

  it('tracks different elements independently', async () => {
    const firstElement = document.createElement('div');
    const secondElement = document.createElement('div');
    const first = deferred();
    const second = deferred();
    render(SOURCE, firstElement, { fallback: () => first.promise });
    render(SOURCE, secondElement, { fallback: () => second.promise });
    second.resolve('<b>second</b>');
    await Promise.resolve();
    expect(firstElement.querySelector('.typlet-pending')?.textContent).toBe(SOURCE);
    expect(secondElement.innerHTML).toBe('<b>second</b>');
    first.resolve('<b>first</b>');
    await Promise.resolve();
    expect(firstElement.innerHTML).toBe('<b>first</b>');
    expect(secondElement.innerHTML).toBe('<b>second</b>');
  });

  it('keeps invocation identity when both pending previews are empty', async () => {
    const element = document.createElement('div');
    const first = deferred();
    const second = deferred();
    render(SOURCE, element, { maxOutputSize: 0, fallback: () => first.promise });
    render(SOURCE, element, { maxOutputSize: 0, fallback: () => second.promise });
    first.resolve('<b>old</b>');
    await Promise.resolve();
    expect(element.innerHTML).toBe('');
    second.resolve('<b>new</b>');
    await Promise.resolve();
    expect(element.innerHTML).toBe('<b>new</b>');
  });

  it.each([0, 64])('bounds a current generic rejection at cap %i', async (maxOutputSize) => {
    const element = document.createElement('div');
    const job = deferred();
    render(SOURCE, element, { maxOutputSize, fallback: () => job.promise });
    job.reject(new Error('secret failure'));
    await Promise.resolve();
    expect(element.innerHTML.length).toBeLessThanOrEqual(maxOutputSize);
    expect(element.querySelector('.typlet-pending')).toBeNull();
    if (maxOutputSize === 0) expect(element.innerHTML).toBe('');
    else expect(element.querySelector('.typlet-error')?.textContent).toBe(SOURCE);
  });
});

describe('reentrant fallback and custom elements', () => {
  it('does not overwrite a nested render with the outer synchronous result', async () => {
    const element = document.createElement('div');
    const inner = deferred();
    render(SOURCE, element, { fallback: () => {
      render(SOURCE, element, { fallback: () => inner.promise });
      return '<b>outer</b>';
    } });
    expect(element.querySelector('.typlet-pending')?.textContent).toBe(SOURCE);
    inner.resolve('<b>inner</b>');
    await Promise.resolve();
    expect(element.innerHTML).toBe('<b>inner</b>');
  });

  it.each(['resolve', 'reject'] as const)('consumes an expired reentrant outer promise on %s', async (mode) => {
    const element = document.createElement('div');
    const outer = deferred();
    const inner = deferred();
    render(SOURCE, element, { fallback: () => {
      render(SOURCE, element, { fallback: () => inner.promise });
      return outer.promise;
    } });
    if (mode === 'resolve') outer.resolve('<b>outer</b>');
    else outer.reject(new Error('expired outer rejection'));
    await Promise.resolve();
    expect(element.querySelector('.typlet-pending')?.textContent).toBe(SOURCE);
    inner.resolve('<b>inner</b>');
    await Promise.resolve();
    expect(element.innerHTML).toBe('<b>inner</b>');
  });

  it('does not clear the nested invocation when the outer fallback throws', async () => {
    const element = document.createElement('div');
    const inner = deferred();
    const error = new Error('outer synchronous failure');
    expect(() => render(SOURCE, element, { fallback: () => {
      render(SOURCE, element, { fallback: () => inner.promise });
      throw error;
    } })).toThrow(error);
    inner.resolve('<b>inner</b>');
    await Promise.resolve();
    expect(element.innerHTML).toBe('<b>inner</b>');
  });

  it('uses the latest same-source custom-element attribute update', async () => {
    const first = deferred();
    const second = deferred();
    const jobs = [first, second];
    let calls = 0;
    elementOptions.fallback = () => jobs[calls++]!.promise;
    const element = document.createElement('typlet-math') as TypletMathElement;
    element.source = SOURCE;
    document.body.append(element);
    element.setAttribute('display', '');
    expect(calls).toBe(2);
    first.resolve('<b>old element</b>');
    await Promise.resolve();
    expect(element.querySelector('.typlet-pending')?.textContent).toBe(SOURCE);
    second.resolve('<b>new element</b>');
    await Promise.resolve();
    expect(element.innerHTML).toBe('<b>new element</b>');
  });
});
