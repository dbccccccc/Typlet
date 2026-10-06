// A local page that shows formulas three ways, side by side: Typst's own
// rendering (SVG from the oracle), Typlet's HTML, and Typlet's MathML.
//
//   npm run build && node tools/demo/serve.mjs [--port 5174]
//
// Then open http://localhost:5174/. The Typst column needs the oracle
// (`npm run oracle:build`).

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { oraclePath, runOracle } from '../lib/oracle.mjs';

const root = resolve(import.meta.dirname, '../..');
const portArg = process.argv.indexOf('--port');
const port = portArg === -1 ? 5174 : Number(process.argv[portArg + 1]);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.jsonl': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

/** Typst's SVG of a formula after a preamble, from the oracle. */
function typstSvg(src, display, preamble) {
  const [record] = runOracle(['run', '--outputs', 'svg'], [{ id: 'demo', src, display, ...(preamble ? { preamble } : {}) }]);
  return record?.svg ?? null;
}

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    if (url.pathname === '/typst.svg') {
      const svg = typstSvg(url.searchParams.get('src') ?? '', url.searchParams.get('display') === '1', url.searchParams.get('preamble') ?? '');
      if (!svg) return res.writeHead(422).end();
      return res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(svg);
    }
    const path = url.pathname === '/' ? '/tools/demo/index.html' : url.pathname;
    const file = normalize(join(root, path));
    const allowed = ['dist', 'fonts', 'tools/demo', 'test/corpus'].map((dir) => join(root, dir));
    if (!allowed.some((dir) => file.startsWith(dir))) return res.writeHead(404).end();
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => {
  console.log(`Typlet demo on http://localhost:${port}/ (oracle: ${oraclePath})`);
});
