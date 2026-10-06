// Measures Typlet's parser on the corpus: microseconds per formula.
//
//   npm run build && node bench/parse.mjs
//
// Each formula gets a unique suffix per iteration, as in bench.mjs, so the
// numbers reflect fresh parses.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { parse } = await import(new URL('../dist/index.js', import.meta.url).href);

const load = (name) =>
  readFileSync(fileURLToPath(new URL(`../test/corpus/${name}.jsonl`, import.meta.url)), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

const ITERATIONS = 200;
for (const name of ['paired', 'typstpad', 'typst-docs', 'symbols']) {
  const formulas = load(name).map((f) => f.src);
  for (let k = 0; k < 20; k++) for (const src of formulas) parse(`${src} + z_(${k})`); // warm up

  const times = [];
  for (let k = 0; k < ITERATIONS; k++) {
    for (const src of formulas) {
      const input = `${src} + z_(${1e6 + k})`;
      const t0 = performance.now();
      parse(input);
      times.push(performance.now() - t0);
    }
  }
  times.sort((a, b) => a - b);
  const us = (q) => (times[Math.floor(q * times.length)] * 1000).toFixed(1);
  console.log(`${name.padEnd(11)} ${String(formulas.length).padStart(5)} formulas  median ${us(0.5)} µs  p95 ${us(0.95)} µs`);
}
