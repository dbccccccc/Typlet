// @ts-check
// Typlet original: not ported from Typst.
//
// A rehype plugin that renders math with Typlet, like rehype-katex: the
// elements remark-math makes for `$x$` and `$$x$$`, with the classes
// `math-inline` and `math-display`, and code blocks fenced as ```math.

/**
 * @import {ElementContent, Root} from 'hast'
 * @import {RenderOptions, TypletWarning} from 'typlet'
 * @import {VFile} from 'vfile'
 */

import { fromHtmlIsomorphic } from 'hast-util-from-html-isomorphic';
import { toText } from 'hast-util-to-text';
import { TypletError, renderToString } from 'typlet';
import { SKIP, visitParents } from 'unist-util-visit-parents';

/** @type {Readonly<RenderOptions>} */
const emptyOptions = {};

/**
 * Renders math with Typlet. Formulas that fail render their source in the
 * error color, and the failure and any warnings become messages on the file.
 * Each document numbers its equations from 1.
 *
 * @param {Readonly<RenderOptions> | null | undefined} [options]
 *   Typlet's render options; `displayMode` comes from the markup.
 * @returns {(tree: Root, file: VFile) => undefined}
 */
export default function rehypeTyplet(options) {
  const settings = options || emptyOptions;

  return function (tree, file) {
    const equationCounter = settings.equationCounter ?? { value: 0 };

    visitParents(tree, 'element', function (element, parents) {
      const classes = Array.isArray(element.properties.className) ? element.properties.className : [];
      // Code fenced as ```math.
      const languageMath = classes.includes('language-math');
      // remark-math's flow math, `$$` on lines of their own.
      const mathDisplay = classes.includes('math-display');
      // remark-math's text math, `$x$`.
      const mathInline = classes.includes('math-inline');
      if (!languageMath && !mathDisplay && !mathInline) return;

      let displayMode = mathDisplay;
      let parent = parents.at(-1);
      let scope = element;
      // A ```math fence is a display formula in place of its `<pre>`.
      if (element.tagName === 'code' && languageMath && parent?.type === 'element' && parent.tagName === 'pre') {
        scope = parent;
        parent = parents.at(-2);
        displayMode = true;
      }
      if (!parent) return;

      const value = toText(scope, { whitespace: 'pre' });
      const ancestors = [...parents, element];
      /** @param {TypletWarning} warning */
      const report = (warning) => {
        file.message(warning.message, { ancestors, place: element.position, ruleId: 'warning', source: 'rehype-typlet' });
        return /** @type {const} */ ('ignore');
      };
      const render = (/** @type {boolean} */ throwOnError) =>
        renderToString(value, { strict: report, ...settings, displayMode, equationCounter, throwOnError });

      const number = equationCounter.value;
      /** @type {string} */
      let result;
      try {
        result = render(true);
      } catch (error) {
        if (!(error instanceof TypletError)) throw error;
        file.message('Could not render math with Typlet', {
          ancestors,
          cause: error,
          place: element.position,
          ruleId: error.kind,
          source: 'rehype-typlet',
        });
        equationCounter.value = number;
        result = render(false);
      }

      /** @type {Array<ElementContent>} */
      const nodes = /** @type {Array<ElementContent>} */ (fromHtmlIsomorphic(result, { fragment: true }).children);
      const index = parent.children.indexOf(scope);
      parent.children.splice(index, 1, ...nodes);
      return SKIP;
    });
  };
}
