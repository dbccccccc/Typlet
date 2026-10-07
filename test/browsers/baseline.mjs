// Checks that Chromium, Firefox and WebKit draw Typlet's fonts where its
// metrics say (docs/DESIGN.md §4). Glyphs placed by hand from the metrics, as
// Typlet's HTML output will place them, must have their ink exactly where
// their bounding boxes put it, and so sit on the same baseline in every
// browser: a letter, its script-size alternate, a size variant, the parts of
// a glyph assembly, a wide accent and a large operator.
//
//   node test/browsers/baseline.mjs [chromium] [firefox] [webkit]
//
// Needs the fonts (`npm run fonts`) and Playwright's browsers
// (`npx playwright install chromium firefox webkit`).

import { readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';

const root = resolve(import.meta.dirname, '../..');
const SIZE = 100; // px per em
const TOP = 150; // px
const SPACING = 320; // px
const TOLERANCE = 1.5; // px, for antialiasing

// The font metrics, from the same module the layout will use.
const bundle = join(tmpdir(), `typlet-baseline-${process.pid}.mjs`);
await build({
  stdin: { contents: `export * from './src/layout/font.ts';`, resolveDir: root, loader: 'ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  logLevel: 'error',
});
const font = await import(pathToFileURL(bundle).href);
rmSync(bundle, { force: true });
const em = (units) => (units / font.UNITS_PER_EM) * SIZE;

// The probes: glyphs, each drawn alone from its code point.
const paren = font.glyphIndex('(');
const parenVertical = font.glyphConstruction(paren, 'vertical');
const hat = font.glyphIndex('̂');
const sum = font.glyphIndex('∑');
const x = font.glyphIndex('𝑥');
const probes = [
  ['letter 𝑥', x],
  ['script-size 𝑥', font.shapeMath('𝑥', 1, false)[0]],
  ['size variant of (', parenVertical.variants[4].glyph],
  ...parenVertical.assembly.parts.map((part, i) => [`assembly part ${i + 1} of (`, part.glyph]),
  ['wide hat', font.glyphConstruction(hat, 'horizontal').variants[3].glyph],
  ['display ∑', font.glyphConstruction(sum, 'vertical').variants[1].glyph],
].map(([name, id], i) => {
  const left = 120 + i * SPACING;
  const baseline = TOP + em(font.FONT_METRICS.ascender * font.UNITS_PER_EM);
  const box = font.boundingBox(id);
  return {
    name,
    id,
    text: String.fromCodePoint(font.drawingCodePoint(id)),
    left,
    // The ink box the metrics predict, in CSS pixels.
    expected: [left + em(box.xMin), baseline - em(box.yMax), left + em(box.xMax), baseline - em(box.yMin)],
  };
});

const page = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="/fonts/typlet.css">
<style>
  body { margin: 0; background: #fff; }
  .probe {
    position: absolute;
    top: ${TOP}px;
    font-family: "Typlet NewCM Math";
    font-size: ${SIZE}px;
    line-height: 1;
    white-space: pre;
    color: #000;
  }
</style>
${probes.map((p) => `<div class="probe" style="left: ${p.left}px">${p.text}</div>`).join('\n')}
`;

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page);
  }
  const file = normalize(join(root, path));
  if (!file.startsWith(join(root, 'fonts'))) return res.writeHead(404).end();
  try {
    const type = file.endsWith('.css') ? 'text/css' : 'font/woff2';
    res.writeHead(200, { 'content-type': type }).end(readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG. */
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
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG');
      bpp = { 2: 3, 6: 4 }[data[9]];
    } else if (type === 'IDAT') {
      chunks.push(data);
    }
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[y * stride + i - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y > 0 ? out[(y - 1) * stride + i - bpp] : 0;
      const p = a + b - c;
      const paeth =
        Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const predictor = [0, a, b, (a + b) >> 1, paeth][filter];
      out[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + predictor) & 255;
    }
  }
  return { width, height, bpp, data: out };
}

/** The bounding box of the dark pixels between two columns. */
function inkBox(image, from, to) {
  let box = null;
  for (let y = 0; y < image.height; y++) {
    for (let x = Math.max(0, from); x < Math.min(image.width, to); x++) {
      const i = (y * image.width + x) * image.bpp;
      const luminance = (image.data[i] + image.data[i + 1] + image.data[i + 2]) / 3;
      if (luminance >= 128) continue;
      box = box
        ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x + 1), Math.max(box[3], y + 1)]
        : [x, y, x + 1, y + 1];
    }
  }
  return box;
}

const browsers = { chromium, firefox, webkit };
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(browsers);
let failures = 0;
for (const name of names) {
  const browser = await browsers[name].launch();
  const tab = await browser.newPage({ viewport: { width: 120 + probes.length * SPACING, height: 650 } });
  await tab.goto(url);
  const ascent = await tab.evaluate(async (texts) => {
    await Promise.all(texts.map((text) => document.fonts.load('100px "Typlet NewCM Math"', text)));
    await document.fonts.ready;
    const context = document.createElement('canvas').getContext('2d');
    context.font = '100px "Typlet NewCM Math"';
    const m = context.measureText('x');
    return [m.fontBoundingBoxAscent, m.fontBoundingBoxDescent];
  }, probes.map((p) => p.text));
  const image = decodePng(await tab.screenshot());
  await browser.close();

  console.log(`${name}: font ascent ${ascent[0]} px, descent ${ascent[1]} px (expected ${em(806)}, ${em(194)})`);
  // Browsers report these in whole pixels, rounded either way (Firefox on
  // macOS rounds up), so allow anything short of a pixel.
  if (Math.abs(ascent[0] - em(806)) >= 1 || Math.abs(ascent[1] - em(194)) >= 1) failures++;
  for (const probe of probes) {
    const ink = inkBox(image, probe.left - SPACING / 2 + 20, probe.left + SPACING / 2 + 20);
    const off = ink ? ink.map((v, i) => v - probe.expected[i]) : null;
    const ok = off !== null && off.every((d) => Math.abs(d) <= TOLERANCE);
    if (!ok) failures++;
    const fmt = (v) => v.toFixed(1).padStart(6);
    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'} ${probe.name.padEnd(24)} ink ${ink ? ink.map(fmt).join(' ') : 'none'}  expected ${probe.expected.map(fmt).join(' ')}`,
    );
  }
}
server.close();
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
