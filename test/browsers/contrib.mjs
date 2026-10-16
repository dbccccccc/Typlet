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

  // These synthetic events need no system clipboard or DataTransfer support.
  const clipboardProblems = [];
  let clipboardCases = 0;
  const verifyCopy = (ok, message) => { if (!ok) clipboardProblems.push(message); };
  const fragmentOf = (html) => {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content;
  };
  const syntheticCopy = (target, range) => {
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const data = new Map();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: (type, value) => data.set(type, value) } });
    target.dispatchEvent(event);
    return { event, data };
  };

  const mixed = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = 'bold';
  const em = document.createElement('em');
  em.textContent = 'italic';
  mixed.append('<em>text</em> &amp; ', fragmentOf(typlet.renderToString('x')), ' ', strong, ' ', em, ' ',
    fragmentOf(typlet.renderToString('y', { displayMode: true, preamble: '#set math.equation(numbering: "(1)")' })), ' tail &amp;');
  document.body.append(mixed);
  const mixedRange = document.createRange();
  mixedRange.selectNodeContents(mixed);
  const originalMixed = mixed.innerHTML;
  const mixedCopy = syntheticCopy(mixed, mixedRange);
  const mixedHtml = fragmentOf(mixedCopy.data.get('text/html') ?? '');
  const mixedPlain = '<em>text</em> &amp; $x$ bold italic $ y $ tail &amp;';
  verifyCopy(mixedCopy.event.defaultPrevented, 'mixed synthetic copy was not intercepted');
  verifyCopy(mixedCopy.data.get('text/plain') === mixedPlain, 'mixed plain text changed');
  verifyCopy(mixedHtml.firstChild?.nodeType === Node.TEXT_NODE && mixedHtml.firstChild.textContent === '<em>text</em> &amp; ', 'literal tag/entity became HTML');
  verifyCopy(mixedHtml.querySelectorAll('em').length === 1 && mixedHtml.querySelector('em')?.textContent === 'italic', 'literal em tag or real em formatting changed');
  verifyCopy(mixedHtml.querySelectorAll('strong').length === 1 && mixedHtml.querySelector('strong')?.textContent === 'bold', 'real strong formatting changed');
  verifyCopy(mixedHtml.querySelector('.typlet-display.n')?.textContent.includes('(1)'), 'numbered display HTML changed');
  verifyCopy(typletCopyTypst.typletReplaceWithSource(mixedHtml).textContent === mixedPlain, 'reparsed mixed HTML text changed');
  verifyCopy(mixed.innerHTML === originalMixed, 'copy changed the source DOM');
  mixed.remove();
  clipboardCases++;

  const boundaries = document.createElement('p');
  boundaries.append('before ', fragmentOf(typlet.renderToString('x')), ' between ', fragmentOf(typlet.renderToString('y')), ' after');
  document.body.append(boundaries);
  const [firstFormula, lastFormula] = boundaries.querySelectorAll('.typlet-html');
  const boundaryRange = document.createRange();
  boundaryRange.setStart(firstFormula, 0);
  boundaryRange.setEnd(lastFormula, 0);
  const boundaryCopy = syntheticCopy(boundaries, boundaryRange);
  const boundaryHtml = fragmentOf(boundaryCopy.data.get('text/html') ?? '');
  verifyCopy(boundaryCopy.event.defaultPrevented && boundaryCopy.data.get('text/plain') === '$x$ between $y$', 'formula range was not expanded');
  verifyCopy(boundaryHtml.querySelectorAll('.typlet').length === 2 && typletCopyTypst.typletReplaceWithSource(boundaryHtml).textContent === '$x$ between $y$', 'expanded HTML did not retain both formulas');
  verifyCopy(boundaryRange.startContainer === firstFormula && boundaryRange.startOffset === 0 && boundaryRange.endContainer === lastFormula && boundaryRange.endOffset === 0, 'copy changed the original range');
  boundaries.remove();
  clipboardCases++;

  const textOnly = document.createElement('p');
  textOnly.textContent = '<em>literal</em> &amp;';
  document.body.append(textOnly);
  const textRange = document.createRange();
  textRange.selectNodeContents(textOnly);
  const textCopy = syntheticCopy(textOnly, textRange);
  verifyCopy(!textCopy.event.defaultPrevented && textCopy.data.size === 0, 'copy intercepted a selection without formulas');
  textOnly.remove();
  clipboardCases++;

  for (const [markup, expected] of [
    ['<p>First FORMULA</p><p>Second OTHER</p>', 'First $x$\n\nSecond $y$'],
    ['<div>First FORMULA<br>Second OTHER</div>', 'First $x$\nSecond $y$'],
    ['<ul><li>First FORMULA</li><li>Second OTHER</li></ul>', 'First $x$\nSecond $y$'],
    ['<table><tr><td>First FORMULA</td><td>Second OTHER</td></tr></table>', 'First $x$\tSecond $y$'],
    ['<table><tr><td></td><td>FORMULA</td><td></td></tr><tr><td>OTHER</td><td></td><td>C</td></tr></table>', '\t$x$\t\n$y$\t\tC'],
    ['<table><tr><th></th></tr><tr><th>FORMULA</th><th></th><th></th><th>OTHER</th></tr><tr><td></td></tr></table>', '\n$x$\t\t\t$y$\n'],
  ]) {
    const target = document.createElement('div');
    target.innerHTML = markup.replace('FORMULA', typlet.renderToString('x')).replace('OTHER', typlet.renderToString('y'));
    document.body.append(target);
    const original = target.innerHTML;
    const range = document.createRange();
    range.selectNodeContents(target);
    const copied = syntheticCopy(target, range);
    verifyCopy(copied.data.get('text/plain') === expected, 'document separators changed');
    verifyCopy(fragmentOf(copied.data.get('text/html') ?? '').querySelectorAll('.typlet').length === 2, 'structured copy lost formulas');
    verifyCopy(target.innerHTML === original, 'structured copy changed the source DOM');
    target.remove();
    clipboardCases++;
  }
  const customNumber = document.createElement('p');
  customNumber.innerHTML = typlet.renderToString(' x + y\r\n ', {
    output: 'html', displayMode: true, preamble: '#set math.equation(numbering: n => [ #n ])',
  });
  document.body.append(customNumber);
  const customRange = document.createRange();
  customRange.selectNodeContents(customNumber);
  const customCopy = syntheticCopy(customNumber, customRange);
  verifyCopy(customCopy.data.get('text/plain') === '$  x + y\r\n  $', 'custom equation number leaked into source');
  customNumber.remove();
  clipboardCases++;

  const partialTable = document.createElement('div');
  partialTable.innerHTML = '<table><tr><td>' + typlet.renderToString('x') + '</td><td></td><td>C</td></tr></table>';
  document.body.append(partialTable);
  const partialRange = document.createRange();
  partialRange.setStart(partialTable.querySelector('.typlet-html'), 0);
  partialRange.setEnd(partialTable.querySelectorAll('td')[2].firstChild, 1);
  verifyCopy(syntheticCopy(partialTable, partialRange).data.get('text/plain') === '$x$\t\tC', 'partial table selection lost empty columns');
  partialTable.remove();
  clipboardCases++;

  const elements = [...document.querySelectorAll('typlet-math')];
  const asyncProblems = [];
  let asyncCases = 0;
  const verify = (ok, message) => { if (!ok) asyncProblems.push(message); };
  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };
  const source = '#context [x]';

  const entityTarget = document.createElement('div');
  const entityJob = deferred();
  const entitySource = '#context [<>&"\'😀]';
  typlet.render(entitySource, entityTarget, { fallback: () => entityJob.promise });
  verify(entityTarget.querySelector('.typlet-pending')?.textContent === entitySource, 'entity pending source');
  entityJob.resolve('<b>entity resolved</b>');
  await Promise.resolve();
  verify(entityTarget.innerHTML === '<b>entity resolved</b>', 'entity-normalized pending did not resolve');
  asyncCases++;

  for (const oldFirst of [true, false]) {
    const target = document.createElement('div');
    const older = deferred();
    const newer = deferred();
    typlet.render(source, target, { displayMode: false, fallback: () => older.promise });
    typlet.render(source, target, { displayMode: true, fallback: () => newer.promise });
    if (oldFirst) {
      older.resolve('<b>old</b>');
      await Promise.resolve();
      verify(!!target.querySelector('.typlet-pending'), 'old same-source promise took over pending');
      newer.resolve('<b>new</b>');
    } else {
      newer.resolve('<b>new</b>');
      await Promise.resolve();
      older.resolve('<b>old</b>');
    }
    await Promise.resolve();
    verify(target.innerHTML === '<b>new</b>', 'same-source promise completion order changed latest result');
    asyncCases++;
  }

  const typedTarget = document.createElement('div');
  const typedJob = deferred();
  typlet.render(source, typedTarget, { maxOutputSize: 64, fallback: () => typedJob.promise });
  typedJob.reject(new typlet.TypletError('eval', [{ severity: 'error', message: 'typed failure', hints: [], span: null, in: 'formula' }], source));
  await Promise.resolve();
  verify(typedTarget.querySelector('.typlet-error')?.textContent === source && typedTarget.innerHTML.length <= 64, 'typed rejection was not bounded');
  asyncCases++;

  for (const error of [new Error('private native details'), null]) {
    const target = document.createElement('div');
    const job = deferred();
    typlet.render(source, target, { fallback: () => job.promise });
    job.reject(error);
    await Promise.resolve();
    verify(target.querySelector('.typlet-error')?.getAttribute('title') === 'TypletError: fallback failed', 'unknown rejection did not use the generic error');
    verify(!target.querySelector('.typlet-pending'), 'unknown rejection left pending markup');
    asyncCases++;
  }

  const reentrantTarget = document.createElement('div');
  const outer = deferred();
  const inner = deferred();
  typlet.render(source, reentrantTarget, { fallback: () => {
    typlet.render(source, reentrantTarget, { fallback: () => inner.promise });
    return outer.promise;
  } });
  outer.reject(new Error('obsolete outer rejection'));
  await Promise.resolve();
  verify(!!reentrantTarget.querySelector('.typlet-pending'), 'expired reentrant rejection changed pending');
  inner.resolve('<b>inner</b>');
  await Promise.resolve();
  verify(reentrantTarget.innerHTML === '<b>inner</b>', 'outer cleanup expired the inner invocation');
  asyncCases++;

  const editedTarget = document.createElement('div');
  const editedJob = deferred();
  typlet.render(source, editedTarget, { fallback: () => editedJob.promise });
  editedTarget.innerHTML = '<i>external edit</i>';
  editedJob.resolve('<b>obsolete</b>');
  await Promise.resolve();
  verify(editedTarget.innerHTML === '<i>external edit</i>', 'fallback overwrote an external DOM edit');
  asyncCases++;

  const custom = document.createElement('typlet-math');
  const firstCustom = deferred();
  const secondCustom = deferred();
  const customJobs = [firstCustom, secondCustom];
  let customCalls = 0;
  const previousFallback = typletElement.elementOptions.fallback;
  try {
    typletElement.elementOptions.fallback = () => customJobs[customCalls++].promise;
    custom.source = source;
    document.body.append(custom);
    custom.setAttribute('display', '');
    verify(customCalls === 2, 'custom-element attribute update did not render again');
    firstCustom.resolve('<b>old custom</b>');
    await Promise.resolve();
    verify(!!custom.querySelector('.typlet-pending'), 'old custom-element invocation took over');
    secondCustom.resolve('<b>new custom</b>');
    await Promise.resolve();
    verify(custom.innerHTML === '<b>new custom</b>', 'custom element did not keep its latest result');
  } finally {
    custom.remove();
    if (previousFallback === undefined) delete typletElement.elementOptions.fallback;
    else typletElement.elementOptions.fallback = previousFallback;
  }
  asyncCases++;

  const depthProblems = [];
  let depthCases = 0;
  const preamble = '#let f(n) = if n == 0 { 0 } else { f(n - 1)' + ' + 1'.repeat(30) + ' }';
  for (const output of ['html', 'htmlAndMathml', 'mathml']) {
    for (const [source, options] of [
      ['#f(79)', { preamble }],
      ['x', { preamble: preamble + '\n#f(79)' }],
      ['#{ ' + preamble.slice(1) + '; f(79) }', {}],
      ...(output === 'mathml' ? [] : [['cancel(x, angle: #(a => { let result = f(79); a }))', { preamble }]]),
    ]) {
      try {
        let error;
        try { typlet.renderToString(source, { ...options, output, strict: 'ignore' }); }
        catch (caught) { error = caught; }
        if (!(error instanceof typlet.TypletError) || error.kind !== 'limit' || !error.message.includes('evaluation depth')) throw new Error('expected a typed evaluation-depth limit, got ' + String(error));
        const diagnostic = error.diagnostics[0];
        const expectedFile = options.preamble ? 'preamble' : 'formula';
        const expectedSource = options.preamble ?? source;
        if (diagnostic?.in !== expectedFile || !error.span || error.span.start < 0 || error.span.end > expectedSource.length || error.span.end <= error.span.start) throw new Error('missing source-located ' + expectedFile + ' diagnostic');
        const result = typlet.renderToResult(source, { ...options, output, strict: 'ignore', throwOnError: false });
        if (result.drawnAs !== 'error' || !result.markup.includes('typlet-error')) throw new Error('missing controlled error markup');
        const safe = typlet.renderToString('#f(1)', { preamble, output: 'mathml', strict: 'ignore' });
        if (!safe.includes('<mn>30</mn>')) throw new Error('cached preamble did not recover');
      } catch (error) {
        depthProblems.push(output + ': ' + error.name + ': ' + error.message);
      }
      depthCases++;
    }
    const simple = '#let f(n) = if n == 0 { 0 } else { f(n - 1) }';
    try {
      typlet.renderToString('#f(79)', { preamble: simple, output, strict: 'ignore' });
      let error;
      try { typlet.renderToString('#f(80)', { preamble: simple, output, strict: 'ignore' }); }
      catch (caught) { error = caught; }
      if (!(error instanceof typlet.TypletError) || error.kind !== 'eval' || error.message !== 'maximum function call depth exceeded') throw new Error('function depth boundary changed');
    } catch (error) {
      depthProblems.push(output + ': ' + error.name + ': ' + error.message);
    }
    depthCases++;
  }

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
    clipboardProblems,
    clipboardCases,
    asyncProblems,
    asyncCases,
    depthProblems,
    depthCases,
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
  expect(result.clipboardCases === 11 && result.clipboardProblems.length === 0, `synthetic copy: ${result.clipboardProblems.join('; ')}`);
  expect(result.depthCases === 14 && result.depthProblems.length === 0, 'evaluation depth: ' + result.depthProblems.join('; '));
  expect(result.asyncProblems.length === 0, `async fallbacks: ${result.asyncProblems.join('; ')}`);
  expect(pageErrors.length === 0, `page errors: ${pageErrors.join('; ')}`);

  const copyNote = String(result.copied).startsWith('unavailable') ? ` (legacy ClipboardEvent probe not checked: ${result.copied})` : '';
  console.log(`${name}: ${problems.length === 0 ? 'ok' : `${problems.length} problem(s)`}; ${result.depthCases} evaluation depth cases; ${result.asyncCases} async fallback cases; ${result.clipboardCases} clipboard cases${copyNote}`);
  for (const problem of problems) console.log(`  ${problem}`);
  failures += problems.length;
}
server.close();
if (failures > 0) process.exitCode = 1;
