// A CommonJS module that requires the entry points: scripts/check-package.mjs
// type-checks it against the packed package, with the declarations of
// dist/cjs/.

import typlet = require('typlet');
import mathml = require('typlet/mathml');
import autoRender = require('typlet/contrib/auto-render');

const options: typlet.RenderOptions = { displayMode: true };
const html: string = typlet.renderToString('x^2', options) + mathml.renderToString('x');

export = { html, renderMathInElement: autoRender.renderMathInElement };
