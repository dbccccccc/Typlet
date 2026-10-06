// Typlet original: not ported from Typst.
//
// Renders an evaluated equation to MathML, as Typst's HTML export does
// (typst-html's `EQUATION_RULE`).

import type { EquationElem } from '../eval/content.js';
import type { SourceDiagnostic } from '../eval/diag.js';
import type { StyleChain, Styles } from '../eval/styles.js';
import type { MathItem } from '../ir/item.js';
import { equationStyles, resolveEquation } from '../ir/resolve.js';
import { elem, encode, protectSpaces } from './html.js';
import { type Trust, convertMathToNodes } from './mathml.js';

/**
 * Renders an equation to a `<math>` element. Warnings are appended to
 * `warnings`. With `annotation`, the source, the MathML is wrapped in
 * `<semantics>` with the source as an `application/x-typst` annotation.
 */
export function equationToMathml(
  equation: EquationElem,
  warnings: SourceDiagnostic[],
  annotation?: string,
  outer: Styles = [],
): string {
  const block = equation.block ?? false;
  const styles = equationStyles(block, outer);
  const item = resolveEquation(equation.body, styles, warnings, 'html');
  return itemToMathml(item, block, warnings, annotation, undefined, styles);
}

/**
 * Renders an equation's math IR, resolved for HTML, to a `<math>` element,
 * like `equationToMathml`. `trust` decides which links to emit, and `styles`
 * are the equation's, which content in it that isn't math is converted in.
 * With `decorations`, the MathML keeps what Typst's export drops (docs/DESIGN.md
 * §4.3): text colors, `overline`, `underline` and `cancel`, box borders, and
 * hidden content as an `mphantom`. Rendering keeps them; the tests compare
 * the MathML without them with Typst's.
 */
export function itemToMathml(
  item: MathItem,
  block: boolean,
  warnings: SourceDiagnostic[],
  annotation?: string,
  trust?: Trust,
  styles?: StyleChain,
  decorations = false,
): string {
  const nodes = convertMathToNodes(item, block, warnings, trust, undefined, styles, decorations);
  const math = elem(
    'math',
    annotation === undefined
      ? nodes
      : [
          elem('semantics', [
            nodes.length === 1 ? nodes[0]! : elem('mrow', nodes),
            elem('annotation', [annotation], [['encoding', 'application/x-typst']]),
          ]),
        ],
  );
  if (block) math.attrs.push(['display', 'block']);
  // The equation is alone in its block, as in the oracle's documents.
  const context = [math];
  protectSpaces(context);
  return encode(context[0]!);
}
