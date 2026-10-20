import type MarkdownIt from 'markdown-it';
import type { RenderOptions } from 'typlet';

/**
 * Typlet's render options, and which math syntax to read. Invalid formulas
 * render their source in the error color unless `throwOnError` is `true`.
 */
export interface Options extends RenderOptions {
  /**
   * `markdown`, the default: `$x$` is inline, `$$x$$` is display, and `$$`
   * on lines of their own surround a display formula. `typst`: `$x$` is
   * inline and `$ x $`, with spaces inside both dollar signs, is display.
   */
  delimiters?: 'markdown' | 'typst';
}

/**
 * Renders math with Typlet. Each document, one `md.render` call, numbers its
 * equations from 1. The parameter's type suits both markdown-it 14, typed by
 * DefinitelyTyped, and markdown-it 15, whose own types export the class as a type.
 */
export default function markdownItTyplet(md: InstanceType<typeof MarkdownIt>, options?: Options): void;
