// Typlet original: not ported from Typst.

/**
 * Typlet renders Typst math: as HTML laid out like Typst's own output, with
 * MathML for screen readers, by default (docs/DESIGN.md §2).
 */

import { HTML_BACKEND } from './html/index.js';
import { type RenderOptions, renderInto, renderWith } from './render.js';
import { parse as parseMarkup, parseCode, parseMath, type SyntaxNode } from './syntax/index.js';

export { SyntaxKind, SyntaxNode, kindName, type SyntaxDiagnostic } from './syntax/index.js';
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

/** Renders a formula to a string of HTML, MathML or both. */
export function renderToString(source: string, options: RenderOptions = {}): string {
  return renderWith(source, options, 'htmlAndMathml', HTML_BACKEND);
}

/** Renders a formula into an element, replacing its content. */
export function render(source: string, element: { innerHTML: string }, options: RenderOptions = {}): void {
  renderInto(source, element, options, 'htmlAndMathml', HTML_BACKEND);
}

/** Options for {@link parse}. */
export interface ParseOptions {
  /**
   * What the source is: `math` (the default) is a formula without its `$`
   * delimiters; `markup` is document text, such as a preamble of `#let` and
   * `#set` statements; `code` is the inside of a code block.
   */
  mode?: 'math' | 'markup' | 'code';
}

/**
 * Parses Typst source into a syntax tree, exactly as typst-syntax does: the
 * same node kinds, the same error recovery and the same error messages.
 * Errors are part of the tree; collect them with `tree.diagnostics()`.
 */
export function parse(source: string, options: ParseOptions = {}): SyntaxNode {
  switch (options.mode ?? 'math') {
    case 'math':
      return parseMath(source);
    case 'markup':
      return parseMarkup(source);
    case 'code':
      return parseCode(source);
  }
}
