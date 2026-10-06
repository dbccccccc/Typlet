// Measures one engine in a fresh process. Prints one JSON object.
//
//   node bench/worker.mjs <engine> per-formula <iterations>
//   node bench/worker.mjs <engine> cold

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { engines, uniquify } from './engines.mjs';

const [name, mode, iterationsArg] = process.argv.slice(2);
const engine = engines[name];
const started = performance.now();
const render = await engine.load();
const loaded = performance.now();
if (!render) {
  console.log(JSON.stringify({ engine: name, available: false }));
  process.exit(0);
}

// The paired corpus, minus formulas this engine's input can't express.
const corpusPath = fileURLToPath(new URL('../test/corpus/paired.jsonl', import.meta.url));
const corpus = readFileSync(corpusPath, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))
  .filter((f) => (engine.input === 'tex' ? f.tex : !f.preamble));

if (mode === 'cold') {
  // Load time, and the first render in this fresh process: the engine's
  // initialization and its first formula, before anything else ran. Every
  // engine renders the corpus's
  // first formula.
  const t0 = performance.now();
  render(uniquify(corpus[0], 0, engine.input));
  const firstRender = performance.now() - t0;
  console.log(JSON.stringify({ engine: name, available: true, loadMs: loaded - started, firstRenderMs: firstRender }));
  process.exit(0);
}

const usable = corpus.filter((f) => {
  try {
    render(f);
    return true;
  } catch {
    return false;
  }
});
// An engine that renders none of the corpus counts as unavailable.
if (usable.length === 0) {
  console.log(JSON.stringify({ engine: name, available: false }));
  process.exit(0);
}

const iterations = Number(iterationsArg ?? 20);
// Warm up the JIT before measuring.
for (let k = 0; k < 3; k++) for (const f of usable) render(uniquify(f, 1e6 + k, engine.input));

const times = [];
let bytes = 0;
let k = 0;
for (let i = 0; i < iterations; i++) {
  for (const f of usable) {
    const formula = uniquify(f, k++, engine.input);
    const t0 = performance.now();
    const out = render(formula);
    times.push(performance.now() - t0);
    if (i === 0) bytes += out.length;
  }
}
times.sort((a, b) => a - b);
const quantile = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))];

console.log(
  JSON.stringify({
    engine: name,
    available: true,
    formulas: usable.length,
    renders: times.length,
    medianMs: quantile(0.5),
    p95Ms: quantile(0.95),
    meanBytes: bytes / usable.length,
    rssMB: process.memoryUsage().rss / 1024 / 1024,
  }),
);
