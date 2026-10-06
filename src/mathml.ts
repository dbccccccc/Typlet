// Typlet original: not ported from Typst.

/**
 * The `typlet/mathml` entry point: MathML output only, without the layout
 * engine or font metrics (docs/DESIGN.md §2.3).
 */

import { type RenderOptions, renderInto, renderWith } from './render.js';

export { typstVersion, version } from './version.js';
export {
  type ErrorKind,
  type Output,
  type RenderOptions,
  type Strictness,
  type TypletDiagnostic,
  TypletError,
  type TrustContext,
  type TypletWarning,
} from './render.js';

/** Renders a formula to a string of MathML. */
export function renderToString(source: string, options: RenderOptions = {}): string {
  return renderWith(source, options, 'mathml', null);
}

/** Renders a formula as MathML into an element, replacing its content. */
export function render(source: string, element: { innerHTML: string }, options: RenderOptions = {}): void {
  renderInto(source, element, options, 'mathml', null);
}
