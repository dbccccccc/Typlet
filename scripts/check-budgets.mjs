// Checks that the built bundle finishes abusive formulas within 50 ms (docs/DESIGN.md
// §6.8): each is rendered once to warm up, then five times, and the median
// time counts. The formulas of test/budget-cases.mjs must stop with an error,
// or render, as their list says; those that render are timed in both entry
// points.
//
//   npm run build && node scripts/check-budgets.mjs

import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BOUNDED_CASES, BUDGET_CASES, TYPST_LIMIT_CASES } from '../test/budget-cases.mjs';

const root = resolve(import.meta.dirname, '..');
const { renderToString } = await import(pathToFileURL(join(root, 'dist/index.js')).href);
const mathml = await import(pathToFileURL(join(root, 'dist/mathml.js')).href);
const LIMIT_MS = 50;

/** The median time of five renders after a warm-up, each of which must fail, or must not. */
function time(render, source, options, fails) {
  const run = () => {
    const start = performance.now();
    let error = null;
    try {
      render(source, { ...options, strict: 'ignore' });
    } catch (e) {
      error = e;
    }
    if (fails && error === null) throw new Error(`${source.slice(0, 60)} did not fail`);
    if (!fails && error !== null) throw new Error(`${source.slice(0, 60)} failed: ${error}`);
    return performance.now() - start;
  };
  run();
  const times = Array.from({ length: 5 }, run).sort((a, b) => a - b);
  return times[2];
}

let failures = 0;
function report(name, ms) {
  const ok = ms < LIMIT_MS;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'SLOW'} ${name.padEnd(44)} ${ms.toFixed(1).padStart(6)} ms`);
}

for (const [name, source, options] of [...BUDGET_CASES, ...TYPST_LIMIT_CASES]) {
  report(name, time(renderToString, source, options, true));
}
for (const [name, source, options] of BOUNDED_CASES) {
  report(name, time(renderToString, source, options, false));
  report(`${name}, typlet/mathml`, time(mathml.renderToString, source, options, false));
}
if (failures > 0) {
  console.error(`${failures} formula(s) took ${LIMIT_MS} ms or more`);
  process.exit(1);
}
