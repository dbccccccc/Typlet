// Checks the extensions' browser bundles in Chromium, Firefox and WebKit, as
// a page loads them with script tags: auto-render, the `<typlet-math>`
// element, defined before the parser reaches its text, and copy-typst.
//
//   npm run build && node test/browsers/contrib.mjs [chromium] [firefox] [webkit]
//
// Needs Playwright's browsers (`npx playwright install chromium firefox webkit`).

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, normalize, resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const root = resolve(import.meta.dirname, '../..');

const page = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/fonts/typlet.css">
<script src="/dist/typlet.min.js"></script>
<script src="/dist/contrib/auto-render.min.js"></script>
<script src="/dist/contrib/copy-typst.min.js"></script>
<script src="/dist/contrib/element.min.js"></script>
</head>
<body style="font-size: 20px">
<p id="inline">Let $x^2 + y^2$ be a sum, and \\$5 a price.</p>
<div id="display">$ sum_(i=1)^n i = (n(n+1))/2 $</div>
<pre id="pre">$z$</pre>
<p id="element">An element: <typlet-math>a/b</typlet-math> and <typlet-math display>c^2</typlet-math>.</p>
<p id="error">A typo: $foo$.</p>
</body>
</html>`;

const types = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page);
  }
  const file = normalize(join(root, path));
  if (!file.startsWith(join(root, 'fonts')) && !file.startsWith(join(root, 'dist'))) return res.writeHead(404).end();
  try {
    const type = types[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;

/** Runs in the page: renders, copies, and reports what it finds. */
async function check() {
  const errors = [];
  renderMathInElement(document.body, { errorCallback: (message) => errors.push(message) });
  await document.fonts.ready;
  const inline = document.getElementById('inline');
  const box = (el) => el.getBoundingClientRect();
  const formulas = [...inline.querySelectorAll('.typlet')];

  // Copy a selection from inside the first formula to the end of the paragraph.
  let copied = null;
  try {
    const range = document.createRange();
    range.setStart(inline.querySelector('.typlet-html'), 0);
    range.setEnd(inline.lastChild, inline.lastChild.textContent.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    // Firefox gives a synthetic event a copy of the data it is created with: read the event's.
    const event = new ClipboardEvent('copy', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
    inline.dispatchEvent(event);
    copied = event.clipboardData.getData('text/plain');
  } catch (e) {
    copied = `unavailable: ${e.message}`;
  }

  const elements = [...document.querySelectorAll('typlet-math')];
  return {
    inlineFormulas: formulas.map((f) => f.querySelector('annotation')?.textContent),
    inlineText: inline.textContent.includes('$5 a price'),
    inlineHeight: formulas[0] ? box(formulas[0].querySelector('.typlet-html')).height : 0,
    display: document.querySelector('#display .typlet-display annotation')?.textContent ?? null,
    displayCentered: (() => {
      const d = document.querySelector('#display .typlet-html .f');
      const outer = box(document.getElementById('display'));
      const inner = d ? box(d) : null;
      return inner ? Math.abs(inner.left - outer.left - (outer.right - inner.right)) < 2 : false;
    })(),
    pre: document.getElementById('pre').textContent,
    elements: elements.map((e) => [e.querySelector('annotation')?.textContent ?? null, !!e.querySelector('.typlet-display')]),
    error: document.getElementById('error').textContent,
    errors,
    copied,
  };
}

const browsers = { chromium, firefox, webkit };
const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(browsers);
let failures = 0;
for (const name of names) {
  const browser = await browsers[name].launch();
  const tab = await browser.newPage();
  const pageErrors = [];
  tab.on('pageerror', (e) => pageErrors.push(e.message));
  await tab.goto(url);
  const result = await tab.evaluate(check);
  await browser.close();

  const problems = [];
  const expect = (ok, message) => ok || problems.push(message);
  expect(JSON.stringify(result.inlineFormulas) === JSON.stringify(['x^2 + y^2']), `inline formulas: ${JSON.stringify(result.inlineFormulas)}`);
  expect(result.inlineText, 'the escaped dollar sign is not a dollar sign');
  expect(result.inlineHeight > 10, `the inline formula is ${result.inlineHeight}px tall`);
  expect(result.display === ' sum_(i=1)^n i = (n(n+1))/2 ', `display formula: ${result.display}`);
  expect(result.displayCentered, 'the display formula is not centered');
  expect(result.pre === '$z$', `pre: ${result.pre}`);
  expect(JSON.stringify(result.elements) === JSON.stringify([['a/b', false], ['c^2', true]]), `elements: ${JSON.stringify(result.elements)}`);
  expect(result.error === 'A typo: $foo$.' && result.errors.length === 1, `error: ${result.error} ${JSON.stringify(result.errors)}`);
  if (!String(result.copied).startsWith('unavailable')) {
    expect(result.copied === '$x^2 + y^2$ be a sum, and $5 a price.', `copied: ${JSON.stringify(result.copied)}`);
  }
  expect(pageErrors.length === 0, `page errors: ${pageErrors.join('; ')}`);

  const copyNote = String(result.copied).startsWith('unavailable') ? ` (copy not checked: ${result.copied})` : '';
  console.log(`${name}: ${problems.length === 0 ? 'ok' : `${problems.length} problem(s)`}${copyNote}`);
  for (const problem of problems) console.log(`  ${problem}`);
  failures += problems.length;
}
server.close();
if (failures > 0) process.exitCode = 1;
