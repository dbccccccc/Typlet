// Serves the documentation site that tools/site/build.mjs built into site/.
// Text is sent compressed and every file with a validator, as a web host
// would, so that the comparison page measures what a reader's browser would
// fetch on a first visit and on a later one.
//
//   npm run docs:build && node tools/site/serve.mjs [--port 5175]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const site = resolve(import.meta.dirname, '../../site');
const portArg = process.argv.indexOf('--port');
const port = portArg === -1 ? 5175 : Number(process.argv[portArg + 1]);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
// The fonts are compressed already.
const COMPRESSED = new Set(['.html', '.js', '.css', '.txt']);
const ENCODINGS = {
  br: (body) => brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } }),
  gzip: (body) => gzipSync(body),
};

/** A file's validator, which changes when the site is built again. */
function etagOf(file) {
  const { size, mtimeMs } = statSync(file);
  return `"${size.toString(36)}-${Math.round(mtimeMs).toString(36)}"`;
}

/** Compressed files, by encoding and path, each with the validator of what was compressed. */
const compressed = new Map();
function compress(file, encoding, etag) {
  const key = `${encoding} ${file}`;
  if (compressed.get(key)?.etag !== etag) compressed.set(key, { etag, body: ENCODINGS[encoding](readFileSync(file)) });
  return compressed.get(key).body;
}

// Compress the site before the first request, which would wait for it otherwise.
try {
  for (const name of readdirSync(site, { recursive: true })) {
    const file = join(site, name);
    if (COMPRESSED.has(extname(file))) compress(file, 'br', etagOf(file));
  }
} catch {
  // No site yet: its files are compressed as they are asked for.
}

createServer((req, res) => {
  try {
    const { pathname } = new URL(req.url, `http://localhost:${port}`);
    const file = normalize(join(site, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    if (!file.startsWith(site + sep)) return res.writeHead(404).end();
    const etag = etagOf(file);
    // Browsers keep the file, and ask whether it changed before using it again.
    const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', etag, 'cache-control': 'no-cache' };
    if (req.headers['if-none-match'] === etag) return res.writeHead(304, headers).end();
    const accepted = String(req.headers['accept-encoding'] ?? '')
      .split(',')
      .map((name) => name.split(';')[0].trim());
    const encoding = COMPRESSED.has(extname(file)) ? Object.keys(ENCODINGS).find((name) => accepted.includes(name)) : undefined;
    if (!encoding) return res.writeHead(200, headers).end(readFileSync(file));
    res.writeHead(200, { ...headers, 'content-encoding': encoding, vary: 'accept-encoding' }).end(compress(file, encoding, etag));
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => {
  console.log(`Typlet's documentation on http://localhost:${port}/`);
});
