// Checks that the built bundle stops abusive formulas within 50 ms (docs/DESIGN.md
// §6.8): each is rendered once to warm up, then five times, and the median
// time counts.
//
//   npm run build && node scripts/check-budgets.mjs

import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUDGET_CASES, TYPST_LIMIT_CASES } from '../test/budget-cases.mjs';

const root = resolve(import.meta.dirname, '..');
const { renderToString } = await import(pathToFileURL(join(root, 'dist/index.js')).href);
const LIMIT_MS = 50;

function time(source, options) {
  const run = () => {
    const start = performance.now();
    try {
      renderToString(source, { ...options, strict: 'ignore' });
    } catch {
      return performance.now() - start;
    }
    throw new Error(`${source} did not fail`);
  };
  run();
  const times = Array.from({ length: 5 }, run).sort((a, b) => a - b);
  return times[2];
}

let failures = 0;
for (const [name, source, options] of [...BUDGET_CASES, ...TYPST_LIMIT_CASES]) {
  const ms = time(source, options);
  const ok = ms < LIMIT_MS;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'SLOW'} ${name.padEnd(36)} ${ms.toFixed(1).padStart(6)} ms`);
}
if (failures > 0) {
  console.error(`${failures} formula(s) took ${LIMIT_MS} ms or more to stop`);
  process.exit(1);
}
