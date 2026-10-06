// An ES module that uses every entry point's types: scripts/check-package.mjs
// type-checks it against the packed package.

import { parse, render, renderToString, TypletError, typstVersion, version, type RenderOptions } from 'typlet';
import { renderToString as renderMathml } from 'typlet/mathml';
import renderMathInElement from 'typlet/contrib/auto-render';
import { handleCopy } from 'typlet/contrib/copy-typst';
import { TypletMathElement } from 'typlet/contrib/element';

const options: RenderOptions = {
  displayMode: true,
  output: 'htmlAndMathml',
  strict: 'ignore',
  trust: ({ protocol }) => protocol === 'https',
  preamble: '#let RR = $bb(R)$',
};
export const html: string = renderToString('x in RR', options) + renderMathml('x') + version + typstVersion;

try {
  parse('x');
} catch (error) {
  if (error instanceof TypletError) console.log(error.kind, error.message);
}

export { handleCopy, render, renderMathInElement, TypletMathElement };
