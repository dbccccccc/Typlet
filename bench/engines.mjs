// The renderers the benchmark compares. Each engine renders one corpus
// formula: `tex` engines use the formula's LaTeX, `typst` engines its Typst.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// `import()` needs a URL: a plain absolute path fails on Windows.
const dist = new URL('../dist/index.js', import.meta.url);

async function typlet(output) {
  if (!existsSync(fileURLToPath(dist))) return null;
  const typlet = await import(dist.href);
  if (typeof typlet.renderToString !== 'function') return null;
  // Warnings are still made, but not logged: the corpus's `#link` formula
  // would print one on every render, and KaTeX prints none for its formulas.
  return (formula) => typlet.renderToString(formula.src, { displayMode: formula.display, output, strict: 'ignore' });
}

async function katex(output) {
  const { default: katex } = await import('katex');
  return (formula) => katex.renderToString(formula.tex, { displayMode: formula.display, throwOnError: true, output });
}

export const engines = {
  'katex': { input: 'tex', load: () => katex('htmlAndMathml') },
  'katex-mathml': { input: 'tex', load: () => katex('mathml') },
  'typlet': { input: 'typst', load: () => typlet('htmlAndMathml') },
  'typlet-mathml': { input: 'typst', load: () => typlet('mathml') },
};

/**
 * Makes a formula unique per iteration, so no engine can reuse cached work,
 * as engines with caches would otherwise.
 */
export function uniquify(formula, k, input) {
  if (input === 'tex') return { ...formula, tex: `${formula.tex} + z_{${k}}` };
  return { ...formula, src: `${formula.src} + z_(${k})` };
}
