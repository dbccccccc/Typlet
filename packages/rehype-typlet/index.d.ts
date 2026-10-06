import type { Root } from 'hast';
import type { RenderOptions } from 'typlet';
import type { VFile } from 'vfile';

/** Typlet's render options; `displayMode` comes from the markup. */
export type Options = RenderOptions;

/**
 * Renders math with Typlet, like rehype-katex: the elements remark-math makes
 * for `$x$` and `$$x$$`, and code blocks fenced as ```math. Formulas that
 * fail render their source in the error color, and the failure and any
 * warnings become messages on the file. Each document numbers its equations
 * from 1.
 */
export default function rehypeTyplet(options?: Readonly<Options> | null): (tree: Root, file: VFile) => undefined;
