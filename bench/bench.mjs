// Benchmarks Typlet against KaTeX on the paired corpus (test/corpus/), the
// same way for both: each engine in its own process, unique
// formulas per render, medians over many renders, and cold starts measured
// in fresh processes.
//
//   node bench/bench.mjs [--iterations N] [--cold-runs N] [engine...]
//
// Build Typlet first (`npm run build`); engines that can't render yet are
// reported as unavailable. Results are written to bench/results/.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { engines } from './engines.mjs';

const args = process.argv.slice(2);
const option = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : Number(args.splice(i, 2)[1]);
};
// Fewer iterations measure engines before V8 has optimized them: at 20, the
// medians of repeated runs varied by half; at 100, by a few percent.
const iterations = option('--iterations', 100);
const coldRuns = option('--cold-runs', 7);
const names = args.length > 0 ? args : Object.keys(engines);

const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url));
const run = (...argv) => JSON.parse(execFileSync(process.execPath, [worker, ...argv], { encoding: 'utf8' }));
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const results = [];
for (const name of names) {
  if (!engines[name]) throw new Error(`unknown engine: ${name}`);
  const steady = run(name, 'per-formula', String(iterations));
  if (!steady.available) {
    results.push({ engine: name, available: false });
    continue;
  }
  const cold = Array.from({ length: coldRuns }, () => run(name, 'cold'));
  results.push({
    ...steady,
    coldLoadMs: median(cold.map((c) => c.loadMs)),
    coldFirstRenderMs: median(cold.map((c) => c.firstRenderMs)),
  });
}

const fmt = (v, digits = 3) => (v === undefined ? '' : v.toFixed(digits));
console.log(`\n${'engine'.padEnd(15)} ${'formulas'.padStart(8)} ${'median ms'.padStart(10)} ${'p95 ms'.padStart(8)} ${'load ms'.padStart(8)} ${'1st ms'.padStart(8)} ${'bytes'.padStart(7)}`);
for (const r of results) {
  if (!r.available) {
    console.log(`${r.engine.padEnd(15)} not available yet`);
    continue;
  }
  console.log(
    `${r.engine.padEnd(15)} ${String(r.formulas).padStart(8)} ${fmt(r.medianMs).padStart(10)} ${fmt(r.p95Ms).padStart(8)} ${fmt(r.coldLoadMs, 1).padStart(8)} ${fmt(r.coldFirstRenderMs, 2).padStart(8)} ${fmt(r.meanBytes, 0).padStart(7)}`,
  );
}

const outDir = fileURLToPath(new URL('./results/', import.meta.url));
mkdirSync(outDir, { recursive: true });
const file = `${outDir}${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(
  file,
  JSON.stringify({ date: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model, iterations, coldRuns, results }, null, 1),
);
console.log(`\nSaved ${file}`);
