// Compares Typlet's HTML with Typst's own rendering in Chromium, Firefox and
// WebKit (docs/DESIGN.md §5.3). Each formula is drawn twice in the same browser,
// at the same scale and origin: as Typst's SVG, from the oracle, and as
// Typlet's HTML. Their ink must match: every dark pixel of one has a dark
// pixel of the other within a pixel, but for a small share at most.
//
// Then a long inline formula wraps in a paragraph of every width from 40 to
// 640 pixels (§4.1). Its pieces must sit on the text's baseline, no line may
// start with the space after an operator, and only a line of one piece may
// overflow.
//
// On Linux, browsers hint fonts: they snap glyph outlines to the pixel grid,
// which SVG outlines never are. Chromium and Firefox run without hinting
// there, and WebKit, which can't, gets a larger allowance.
//
//   npm run build && node test/browsers/visual.mjs [chromium] [firefox] [webkit]
//
// Needs the oracle (`npm run oracle:build`), the fonts (`npm run fonts`) and
// Playwright's browsers. Writes the images of failures to the OS temp folder.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { chromium, firefox, webkit } from 'playwright';
import { runOracle } from '../../tools/lib/oracle.mjs';

const root = resolve(import.meta.dirname, '../..');
const SIZE = 32; // px per em; Typst lays out at 11pt
const CELL = { width: 640, height: 300 };
const ORIGIN = { x: 40, y: 40 };
const COLUMNS = 3;
const ROWS = 6;
/** The share of ink that may lack a match within a pixel. */
const MAX_MISMATCH = 0.02;

// Hinting moves the edges of Typlet's glyphs by up to a pixel from Typst's,
// which in a formula of a few thin glyphs, such as β or ∂, is more than the
// allowance. Chromium turns it off with a switch, and Firefox through a
// fontconfig file. WebKit's Linux build reads neither, nor any setting for it,
// so its allowance there is larger: thin glyphs miss by up to 5.8% on Ubuntu
// 24.04, against 0.5% at most on Windows.
const LINUX = process.platform === 'linux';
const LAUNCH = {
  chromium: LINUX ? { args: ['--font-render-hinting=none'] } : {},
  firefox: LINUX ? { env: { ...process.env, FONTCONFIG_FILE: join(import.meta.dirname, 'no-hinting.conf') } } : {},
  webkit: {},
};
const ALLOWANCE = { chromium: MAX_MISMATCH, firefox: MAX_MISMATCH, webkit: LINUX ? 0.08 : MAX_MISMATCH };

const { renderToString } = await import(pathToFileURL(join(root, 'dist/index.js')).href);

// Formulas whose preambles put text on the page, which the SVG shows too.
const SKIPPED = new Set(['levels/preamble-text']);

// The formulas: the corpora's, where Typlet draws HTML.
const formulas = [];
for (const name of ['paired', 'features', 'typst-docs', 'typstpad', 'levels']) {
  for (const line of readFileSync(join(root, `test/corpus/${name}.jsonl`), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const f = JSON.parse(line);
    if (SKIPPED.has(`${name}/${f.id}`)) continue;
    const preamble = f.preamble?.trim() ? f.preamble : undefined;
    let html;
    try {
      html = renderToString(f.src, { output: 'html', displayMode: !!f.display, strict: 'ignore', trust: true, preamble });
    } catch {
      continue;
    }
    formulas.push({ id: `${name}/${f.id}`, src: f.src, display: !!f.display, preamble, html });
  }
}
const svgs = runOracle(
  ['run', '--outputs', 'svg'],
  formulas.map((f) => ({ id: f.id, src: f.src, display: f.display, ...(f.preamble ? { preamble: f.preamble } : {}) })),
);
for (const [i, record] of svgs.entries()) formulas[i].svg = record.svg ?? null;

/** A page of formulas in a grid, drawn by Typst or Typlet. */
function page(batch, engine) {
  const cells = batch.map((f, i) => {
    const left = (i % COLUMNS) * CELL.width + ORIGIN.x;
    const top = Math.floor(i / COLUMNS) * CELL.height + ORIGIN.y;
    let content;
    if (engine === 'typst') {
      // Scale the SVG from points to the font size: 11pt is one em.
      content = f.svg.replace(/<svg([^>]*?)width="([\d.]+)pt" height="([\d.]+)pt"/, (_, attrs, w, h) =>
        `<svg${attrs}width="${(w * SIZE) / 11}px" height="${(h * SIZE) / 11}px"`,
      );
    } else {
      content = f.html;
    }
    return `<div class="cell" style="left:${left}px;top:${top}px">${content}</div>`;
  });
  return `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/fonts/typlet.css">
<style>
  body { margin: 0; background: #fff; color: #000; }
  .cell { position: absolute; font-size: ${SIZE}px; line-height: 0; white-space: nowrap; }
  .cell svg { display: block; overflow: visible; }
  .cell .typlet-display { margin: 0; display: inline-block; vertical-align: top; }
  /* No strut above the formula: its box starts where Typst's page does. A
     display formula is one box, which may be shorter than the strut. */
  .cell .typlet { line-height: 0; }
  .cell .typlet-display .f { vertical-align: top !important; }
</style>
${cells.join('\n')}`;
}

/** A paragraph with a marker on its first line's baseline, then a formula. */
const WRAP = 'a + b + c + d + e + f + g + h = i + j + k <= l + m + n';
const wrapPage = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/fonts/typlet.css">
<style>body { margin: 0; background: #fff; } p { margin: 0; font: 20px serif; }</style>
<p>x<span id="mark" style="display: inline-block"></span>${renderToString(WRAP)}</p>`;

/** The problems of the wrapped formula, at each width that has any. */
function checkWrapping() {
  const p = document.querySelector('p');
  const mark = document.querySelector('#mark');
  const failed = [];
  for (let width = 40; width <= 640; width++) {
    p.style.width = `${width}px`;
    const left = p.getBoundingClientRect().left;
    const pieces = [...p.querySelectorAll('.typlet-html > .f')].map((f) => {
      const r = f.getBoundingClientRect();
      return { left: r.left, right: r.right, baseline: r.bottom + parseFloat(getComputedStyle(f).verticalAlign) };
    });
    // A line ends where the next piece starts further left.
    const lines = [];
    for (const piece of pieces) {
      const line = lines.at(-1);
      if (line && piece.left >= line.at(-1).right - 0.5) line.push(piece);
      else lines.push([piece]);
    }
    const problems = [];
    // The formula starts on the marker's line, unless its first piece wraps.
    const marker = mark.getBoundingClientRect();
    const wrapsFirst = pieces[0].left < marker.right - 0.5;
    if (!wrapsFirst && Math.abs(pieces[0].baseline - marker.bottom) > 0.5) problems.push('off the text baseline');
    for (const [i, line] of lines.entries()) {
      if ((i > 0 || wrapsFirst) && Math.abs(line[0].left - left) > 0.5) problems.push(`line ${i + 1} indented by ${(line[0].left - left).toFixed(1)}px`);
      if (line.some((piece) => Math.abs(piece.baseline - line[0].baseline) > 0.5)) problems.push(`line ${i + 1} off its baseline`);
      if (line.length > 1 && line.at(-1).right > left + width + 0.5) problems.push(`line ${i + 1} overflows`);
    }
    if (width === 40 && lines.length < 2) problems.push('no line breaks');
    if (problems.length > 0) failed.push(`${width}px: ${problems.join(', ')}`);
  }
  return failed;
}

const pages = new Map([['/wrap.html', wrapPage]]);
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (pages.has(path)) return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(pages.get(path));
  const file = normalize(join(root, path));
  if (!file.startsWith(join(root, 'fonts'))) return res.writeHead(404).end();
  try {
    res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : 'font/woff2' }).end(readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;

/**
 * Decodes an 8-bit, non-interlaced RGB or RGBA PNG to the darkest channel of
 * each pixel, so that colored ink counts like black.
 */
function decodePng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let bpp = 0;
  const chunks = [];
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bpp = { 2: 3, 6: 4 }[data[9]];
    } else if (type === 'IDAT') {
      chunks.push(data);
    }
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * bpp;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[y * stride + i - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y > 0 ? px[(y - 1) * stride + i - bpp] : 0;
      const p = a + b - c;
      const paeth =
        Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      px[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + [0, a, b, (a + b) >> 1, paeth][filter]) & 255;
    }
  }
  const lum = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) lum[i] = Math.min(px[i * bpp], px[i * bpp + 1], px[i * bpp + 2]);
  return { width, height, lum };
}

/** Encodes luminances as a grayscale PNG, for inspecting failures. */
function encodePng(width, height, lum) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) lum.subarray(y * width, (y + 1) * width).forEach((v, x) => (raw[y * (width + 1) + 1 + x] = v));
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    let crc = ~0;
    for (const byte of out.subarray(4, 8 + data.length)) {
      crc ^= byte;
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    out.writeUInt32BE(~crc >>> 0, 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The share of either image's ink without ink of the other within a pixel. */
function mismatch(a, b, x0, y0, w, h) {
  const ink = (img, x, y) => img.lum[y * img.width + x] < 128;
  const near = (img, x, y) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < img.width && ny < img.height && ink(img, nx, ny)) return true;
      }
    }
    return false;
  };
  let total = 0;
  let missed = 0;
  for (let y = y0; y < Math.min(y0 + h, a.height, b.height); y++) {
    for (let x = x0; x < Math.min(x0 + w, a.width, b.width); x++) {
      for (const [img, other] of [
        [a, b],
        [b, a],
      ]) {
        if (!ink(img, x, y)) continue;
        total++;
        if (!near(other, x, y)) missed++;
      }
    }
  }
  return total === 0 ? 0 : missed / total;
}

const outDir = join(tmpdir(), 'typlet-visual');
mkdirSync(outDir, { recursive: true });
const browsers = { chromium, firefox, webkit };
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(browsers);
const comparable = formulas.filter((f) => f.svg);
let failures = 0;
for (const name of names) {
  const browser = await browsers[name].launch(LAUNCH[name]);
  const tab = await browser.newPage({ viewport: { width: COLUMNS * CELL.width, height: ROWS * CELL.height } });
  let failed = [];
  for (let start = 0; start < comparable.length; start += COLUMNS * ROWS) {
    const batch = comparable.slice(start, start + COLUMNS * ROWS);
    const images = {};
    for (const engine of ['typst', 'typlet']) {
      pages.set(`/${engine}.html`, page(batch, engine));
      await tab.goto(`${base}/${engine}.html`);
      await tab.evaluate(() => document.fonts.ready);
      images[engine] = decodePng(await tab.screenshot());
    }
    batch.forEach((f, i) => {
      const x = (i % COLUMNS) * CELL.width;
      const y = Math.floor(i / COLUMNS) * CELL.height;
      const share = mismatch(images.typst, images.typlet, x, y, CELL.width, CELL.height);
      if (share > ALLOWANCE[name]) {
        failed.push(`${f.id} (${(share * 100).toFixed(1)}%): ${f.src}`);
        const crop = (img) => {
          const out = new Uint8Array(CELL.width * CELL.height);
          for (let r = 0; r < CELL.height; r++) out.set(img.lum.subarray((y + r) * img.width + x, (y + r) * img.width + x + CELL.width), r * CELL.width);
          return out;
        };
        const both = new Uint8Array(CELL.width * CELL.height * 2);
        both.set(crop(images.typst), 0);
        both.set(crop(images.typlet), CELL.width * CELL.height);
        writeFileSync(join(outDir, `${name}-${f.id.replace(/\//g, '_')}.png`), encodePng(CELL.width, CELL.height * 2, both));
      }
    });
  }
  await tab.goto(`${base}/wrap.html`);
  await tab.evaluate(() => document.fonts.ready);
  const wrapping = await tab.evaluate(checkWrapping);
  await browser.close();
  const within = ALLOWANCE[name] === MAX_MISMATCH ? '' : ` within ${ALLOWANCE[name] * 100}%`;
  console.log(`${name}: ${comparable.length - failed.length}/${comparable.length} match${within}`);
  for (const line of failed) console.log(`  ${line}`);
  console.log(`${name}: wrapping ${wrapping.length === 0 ? 'ok' : `fails at ${wrapping.length} widths`}`);
  for (const line of wrapping.slice(0, 10)) console.log(`  ${line}`);
  failures += failed.length + wrapping.length;
}
server.close();
if (failures > 0) {
  console.error(`${failures} mismatch(es); images in ${outDir}`);
  process.exit(1);
}
