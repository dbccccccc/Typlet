// Measures loading on the web: a
// page renders the paired corpus's formulas in the browser, from a local
// server that compresses with brotli as a CDN would. Each run is a first
// visit, in a fresh browser context. The page records when the first formula
// and all formulas were rendered, when the fonts were ready, and the bytes it
// downloaded by kind. KaTeX renders the same formulas in the same run.
//
//   npm run build && node bench/web.mjs [--runs N]
//
// Needs Playwright's Chromium (`npx playwright install chromium`).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const runsArg = process.argv.indexOf('--runs');
const runs = runsArg === -1 ? 7 : Number(process.argv[runsArg + 1]);
const katexDir = dirname(createRequire(import.meta.url).resolve('katex/package.json'));

// The formulas both engines render, as in bench/worker.mjs.
const typlet = await import(new URL('../dist/index.js', import.meta.url).href);
const katex = (await import('katex')).default;
const formulas = readFileSync(join(root, 'test/corpus/paired.jsonl'), 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line))
  .filter((f) => f.tex && !f.preamble)
  .filter((f) => {
    try {
      typlet.renderToString(f.src, { displayMode: !!f.display, strict: 'ignore' });
      katex.renderToString(f.tex, { displayMode: !!f.display, throwOnError: true });
      return true;
    } catch {
      return false;
    }
  })
  .map((f) => ({ typ: f.src, tex: f.tex, display: !!f.display }));

const common = `
const FORMULAS = ${JSON.stringify(formulas)};
const out = document.getElementById('out');
const base = location.pathname.replace(/\\/[^/]*$/, '');
function finish(r) {
  r.resources = performance.getEntriesByType('resource').map((e) => ({ name: e.name, transfer: e.transferSize }));
  window.__result = r;
}`;

const pages = {
  katex: `<!doctype html><meta charset="utf-8"><title>KaTeX</title><div id="out"></div><script>
${common}
const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = base + '/katex/katex.min.css';
document.head.append(css);
const s = document.createElement('script');
s.src = base + '/katex/katex.min.js';
s.onload = async () => {
  const r = { tScriptReady: performance.now() };
  FORMULAS.forEach((f, i) => {
    const d = document.createElement('div');
    katex.render(f.tex, d, { displayMode: f.display, throwOnError: false });
    out.append(d);
    if (i === 0) r.tFirst = performance.now();
  });
  r.tAll = performance.now();
  void out.offsetHeight;
  await document.fonts.ready;
  r.tFontsReady = performance.now();
  finish(r);
};
document.head.append(s);
</script>`,
  typlet: `<!doctype html><meta charset="utf-8"><title>Typlet</title><div id="out"></div><script>
${common}
const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = base + '/typlet/fonts/typlet.css';
document.head.append(css);
const s = document.createElement('script');
s.src = base + '/typlet/dist/typlet.min.js';
s.onload = async () => {
  const r = { tScriptReady: performance.now() };
  FORMULAS.forEach((f, i) => {
    const d = document.createElement('div');
    typlet.render(f.typ, d, { displayMode: f.display, throwOnError: false, strict: 'ignore' });
    out.append(d);
    if (i === 0) r.tFirst = performance.now();
  });
  r.tAll = performance.now();
  void out.offsetHeight;
  await document.fonts.ready;
  r.tFontsReady = performance.now();
  finish(r);
};
document.head.append(s);
</script>`,
};

// The server: brotli at quality 9, and `/v/<token>/` paths so that
// each run is a first visit.
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const compressible = new Set(['.html', '.js', '.css', '.ttf']);
const cache = new Map();
function file(path) {
  const p = decodeURIComponent(path).replace(/^\/v\/[^/]+/, '');
  if (p.startsWith('/katex/')) return normalize(join(katexDir, 'dist', p.slice('/katex/'.length)));
  if (p.startsWith('/typlet/')) {
    const f = normalize(join(root, p.slice('/typlet/'.length)));
    return f.startsWith(join(root, 'dist')) || f.startsWith(join(root, 'fonts')) ? f : null;
  }
  return null;
}
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const page = path.match(/^\/v\/[^/]+\/(katex|typlet)\.html$/)?.[1];
  let body;
  let ext;
  if (page) {
    body = Buffer.from(pages[page]);
    ext = '.html';
  } else {
    const f = file(path);
    if (!f || !existsSync(f) || statSync(f).isDirectory()) return res.writeHead(404).end();
    body = readFileSync(f);
    ext = extname(f);
  }
  const headers = { 'content-type': types[ext] ?? 'application/octet-stream', 'cache-control': 'public, max-age=3600' };
  if (compressible.has(ext) && /\bbr\b/.test(req.headers['accept-encoding'] ?? '')) {
    const key = page ?? path.replace(/^\/v\/[^/]+/, '');
    if (!cache.has(key)) cache.set(key, brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }));
    body = cache.get(key);
    headers['content-encoding'] = 'br';
  }
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  res.end(body);
});
await new Promise((done) => server.listen(0, done));
const origin = `http://localhost:${server.address().port}`;

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const kb = (bytes) => (bytes / 1024).toFixed(0);
const browser = await chromium.launch();
const results = {};
for (const engine of ['katex', 'typlet']) {
  const samples = [];
  for (let run = 0; run < runs; run++) {
    const context = await browser.newContext();
    const tab = await context.newPage();
    await tab.goto(`${origin}/v/${engine}-${run}-${Date.now()}/${engine}.html`);
    await tab.waitForFunction(() => window.__result, null, { timeout: 60_000 });
    samples.push(await tab.evaluate(() => window.__result));
    await context.close();
  }
  const bytes = (sample, test) => sample.resources.filter((r) => test(r.name)).reduce((sum, r) => sum + r.transfer, 0);
  results[engine] = {
    first: median(samples.map((s) => s.tFirst)),
    all: median(samples.map((s) => s.tAll)),
    fonts: median(samples.map((s) => s.tFontsReady)),
    js: median(samples.map((s) => bytes(s, (n) => n.endsWith('.js')))),
    css: median(samples.map((s) => bytes(s, (n) => n.endsWith('.css')))),
    fontBytes: median(samples.map((s) => bytes(s, (n) => /\.(woff2?|ttf)$/.test(n)))),
    fontFiles: median(samples.map((s) => s.resources.filter((r) => /\.(woff2?|ttf)$/.test(r.name)).length)),
  };
}
await browser.close();
server.close();

console.log(`${formulas.length} formulas, ${runs} first visits each, Chromium ${browser.version()}\n`);
console.log(`${'engine'.padEnd(8)} ${'first ms'.padStart(9)} ${'all ms'.padStart(8)} ${'fonts ms'.padStart(9)} ${'JS KB'.padStart(6)} ${'CSS KB'.padStart(7)} ${'font KB'.padStart(8)} ${'files'.padStart(6)}`);
for (const [engine, r] of Object.entries(results)) {
  console.log(
    `${engine.padEnd(8)} ${r.first.toFixed(0).padStart(9)} ${r.all.toFixed(0).padStart(8)} ${r.fonts.toFixed(0).padStart(9)} ${kb(r.js).padStart(6)} ${kb(r.css).padStart(7)} ${kb(r.fontBytes).padStart(8)} ${String(r.fontFiles).padStart(6)}`,
  );
}
