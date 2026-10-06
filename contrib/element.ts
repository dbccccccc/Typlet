// Typlet original: not ported from Typst.
//
// A custom element that renders its text as a formula:
//
//   <typlet-math>x^2</typlet-math>
//   <typlet-math display>sum_(i=1)^n i = (n(n+1))/2</typlet-math>
//   <typlet-math source="a^2 + b^2 = c^2"></typlet-math>
//
// Importing this module defines `<typlet-math>`. It renders into the
// element itself, so the page needs typlet.css, as for `render`.

import { type Output, type RenderOptions, render } from 'typlet';

/**
 * Render options for every `<typlet-math>` element, such as a `preamble` or
 * `trust`. Change them before the elements render, for example before
 * importing this module's elements into the page. Invalid formulas show their
 * source in the error color, unless `throwOnError` is set to `true`.
 */
export const elementOptions: RenderOptions = {};

// Importing the module where there is no DOM, as in server-side rendering, defines nothing.
const Base = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;

/** `<typlet-math>`: the formula in its text or its `source` attribute. */
export class TypletMathElement extends Base {
  static readonly observedAttributes = ['source', 'display', 'output'];

  // The source taken from the element's text, which rendering replaces.
  #text: string | null = null;

  /** The formula's Typst source. Setting it renders the new formula. */
  get source(): string {
    return this.getAttribute('source') ?? this.#text ?? '';
  }

  set source(value: string) {
    this.setAttribute('source', value);
  }

  connectedCallback(): void {
    if (this.#text !== null || this.hasAttribute('source') || this.hasChildNodes()) {
      this.#start();
    } else if (this.ownerDocument.readyState === 'loading') {
      // A script in the page's head defines the element before the parser
      // reaches its text.
      this.ownerDocument.addEventListener('DOMContentLoaded', () => this.#start(), { once: true });
    } else {
      // The code that inserted the element may add its text right after.
      queueMicrotask(() => this.#start());
    }
  }

  #start(): void {
    if (!this.isConnected) return;
    if (!this.hasAttribute('source')) this.#text ??= this.textContent ?? '';
    this.#render();
  }

  attributeChangedCallback(): void {
    if (this.isConnected && (this.#text !== null || this.hasAttribute('source'))) this.#render();
  }

  #render(): void {
    const output = this.getAttribute('output') as Output | null;
    render(this.source, this, {
      throwOnError: false,
      ...elementOptions,
      displayMode: this.hasAttribute('display'),
      ...(output ? { output } : {}),
    });
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('typlet-math')) {
  customElements.define('typlet-math', TypletMathElement);
}
