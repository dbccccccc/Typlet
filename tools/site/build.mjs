// Builds the documentation site into site/, rendered with Typlet itself
// (docs/DESIGN.md): the pages in docs/site/, the generated list of supported
// features (docs/supported.md) and SECURITY.md, through markdown-it and
// markdown-it-typlet with Typst's syntax for formulas; a gallery of the paired
// corpus; a playground; and a page that renders the corpus with Typlet or
// with KaTeX in the reader's browser, and times it (tools/site/compare.js).
// A formula that fails or warns fails the build.
//
//   npm run build && npm run docs:build

import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import katex from 'katex';
import MarkdownIt from 'markdown-it';

const root = resolve(import.meta.dirname, '../..');
const out = join(root, 'site');

// The plugin imports `typlet`, which is the package itself: bundle it with
// the built package.
const pluginBundle = join(tmpdir(), `typlet-site-${process.pid}.mjs`);
await build({
  entryPoints: [join(root, 'packages/markdown-it-typlet/index.js')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: pluginBundle,
  alias: { typlet: join(root, 'dist/index.js') },
  external: ['markdown-it'],
  logLevel: 'error',
});
const { default: markdownItTyplet } = await import(pathToFileURL(pluginBundle).href);
rmSync(pluginBundle, { force: true });
const typlet = await import(pathToFileURL(join(root, 'dist/index.js')).href);

// The site's own formulas: any that fails or warns fails the build.
const md = new MarkdownIt({ html: true }).use(markdownItTyplet, { delimiters: 'typst', throwOnError: true, strict: 'error', trust: true });

/** Renders the examples of docs/supported.md's tables above their source. */
const withExamples = (markdown) =>
  markdown.replace(/^\| (`[^`]+`) \| `([^`]+)` \|/gm, (_, name, example) => `| ${name} | $${example}$<br>\`${example}\` |`);

const PAGES = [
  ['index', 'Typlet', 'docs/site/index.md'],
  ['guide', 'Guide', 'docs/site/guide.md'],
  ['code', 'Embedded code', 'docs/site/code.md'],
  ['integrations', 'Integrations', 'docs/site/integrations.md'],
  ['supported', 'Supported features', 'docs/supported.md'],
  ['gallery', 'Gallery', null],
  ['playground', 'Playground', null],
  ['compare', 'Compare', null],
  ['security', 'Security', 'SECURITY.md'],
];

const escape = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** A page of the site. The comparison page loads Typlet's stylesheet itself, to time it. */
function page(name, title, body, scripts = '', typletStyles = true) {
  const nav = PAGES.map(([n, t]) => `<a href="${n}.html"${n === name ? ' aria-current="page"' : ''}>${n === 'index' ? 'Home' : t}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title === 'Typlet' ? 'Typlet: Typst math for the web' : `${title} · Typlet`)}</title>${typletStyles ? '\n<link rel="stylesheet" href="fonts/typlet.css">' : ''}
<link rel="stylesheet" href="site.css">
</head>
<body>
<header><a class="brand" href="index.html">Typlet</a><nav>${nav}</nav></header>
<main>
${body}
</main>
<footer>Typlet is an independent project, not affiliated with Typst GmbH. Rendered with Typlet ${escape(typlet.version)} for Typst ${escape(typlet.typstVersion)}.</footer>
${scripts}
</body>
</html>
`;
}

const CATEGORIES = {
  basics: 'Basics',
  fractions: 'Fractions',
  'big-ops': 'Big operators',
  delimiters: 'Delimiters',
  matrices: 'Matrices',
  alignment: 'Alignment',
  accents: 'Accents',
  fonts: 'Fonts',
  symbols: 'Symbols',
  layout: 'Layout',
  realistic: 'Real formulas',
  extensions: 'Extensions',
  'typst-only': 'Only in Typst',
};

/** The paired corpus: formulas in Typst and, for most, in LaTeX. */
const paired = readFileSync(join(root, 'test/corpus/paired.jsonl'), 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));

/** The paired corpus, rendered, with each formula's source, by category. */
function gallery() {
  const formulas = paired;
  let refused = 0;
  const sections = new Map();
  for (const f of formulas) {
    let rendered;
    try {
      rendered = typlet.renderToString(f.src, { displayMode: !!f.display, preamble: f.preamble, trust: true, strict: 'ignore' });
    } catch (e) {
      if (e.kind !== 'unsupported') throw e;
      refused++;
      rendered = `<span class="refused">Refused: ${escape(e.message)}</span>`;
    }
    const source = f.preamble ? `${f.preamble}\n$ ${f.src} $` : f.display ? `$ ${f.src} $` : `$${f.src}$`;
    const row = `<tr><td><code>${escape(source)}</code></td><td>${rendered}</td></tr>`;
    const category = CATEGORIES[f.cat] ?? f.cat;
    sections.set(category, [...(sections.get(category) ?? []), row]);
  }
  const tables = [...sections].map(
    ([category, rows]) => `<h2>${escape(category)}</h2>
<table class="gallery"><thead><tr><th>Typst</th><th>Typlet</th></tr></thead><tbody>
${rows.join('\n')}
</tbody></table>`,
  );
  return `<h1>Gallery</h1>
<p>The ${formulas.length} formulas of the paired corpus, each written in Typst and in LaTeX to compare renderers, as Typlet renders them. Typlet refuses ${refused}, which use features it doesn't support.</p>
${tables.join('\n')}`;
}

/**
 * The formulas of the comparison page: those of the paired corpus that both
 * Typlet and KaTeX render, each from its own source, without a preamble.
 */
function comparedFormulas() {
  const renders = (render) => {
    try {
      render();
      return true;
    } catch {
      return false;
    }
  };
  return paired
    .filter((f) => f.tex && !f.preamble)
    .filter((f) => renders(() => typlet.renderToString(f.src, { displayMode: !!f.display, strict: 'ignore' })))
    .filter((f) => renders(() => katex.renderToString(f.tex, { displayMode: !!f.display, throwOnError: true })))
    .map((f) => ({ category: CATEGORIES[f.cat] ?? f.cat, typ: f.src, tex: f.tex, display: !!f.display }));
}

const compare = (count) => `<h1>Typlet and KaTeX compared</h1>
<p>This page renders ${count} formulas in your browser, with Typlet from their Typst source or with KaTeX from their LaTeX source, and times each step. They are the formulas of the <a href="gallery.html">gallery</a> that both can draw. Choosing a renderer loads the page again, so that every measurement starts from a fresh page.</p>
<noscript><p>The comparison needs JavaScript.</p></noscript>
<div class="compare-controls">
<span id="engines" class="choice" role="group" aria-label="Renderer"><a data-engine="typlet" href="?engine=typlet">Typlet</a><a data-engine="katex" href="?engine=katex">KaTeX</a><a data-engine="both" href="?engine=both">Both, side by side</a></span>
<label><input type="checkbox" id="fresh" checked> As on a first visit: fetch the library again, past the browser's cache</label>
<button id="again" type="button" disabled>Render again</button>
</div>
<div id="results" aria-live="polite"><p class="headline">Rendering…</p></div>
<details class="notes">
<summary>What the times measure</summary>
<ul>
<li><strong>The library</strong> is ready when the browser has fetched its script and its stylesheet and has run the script. On a first visit this includes compiling the script.</li>
<li><strong>The first formula</strong> runs the renderer's code for the first time, which takes longer than the formulas after it. <strong>All formulas</strong> is the time in the calls to <code>render</code>, the first among them, which put each formula's HTML into the page.</li>
<li><strong>The layout</strong> is the browser's own work to style and place what was rendered, before the fonts arrive.</li>
<li><strong>Render again</strong> empties the formulas and renders them once more, now that the browser has compiled the code they run.</li>
<li>The sizes are what the browser fetched, compressed if the server compresses. Both renderers load only the fonts that the page's characters need.</li>
<li>With both side by side, the two run one after the other in one page, Typlet first. For a measurement of one alone, choose it alone.</li>
</ul>
<p>Both render their default output: HTML to look at, and MathML for screen readers. Typlet draws formulas at the size of the text around them and KaTeX at 1.21 times that, so this page shows Typlet's at KaTeX's size.</p>
</details>
<div id="formulas"></div>`;

const COMPARE_SCRIPT = '<script src="js/compare-data.js"></script>\n<script src="js/compare.js"></script>';

const PLAYGROUND = `<h1>Playground</h1>
<p>Type a formula without its dollar signs. It renders as you type, in your browser, with Typlet's browser bundle.</p>
<div class="playground">
<label>Formula <textarea id="source" rows="3" spellcheck="false">sum_(i=1)^n i = (n(n+1))/2</textarea></label>
<label>Preamble <textarea id="preamble" rows="2" spellcheck="false" placeholder="#let RR = $bb(R)$"></textarea></label>
<div class="controls">
<label><input type="checkbox" id="display" checked> Display</label>
<label>Output <select id="output"><option>htmlAndMathml</option><option>html</option><option>mathml</option></select></label>
<span id="size"></span>
</div>
<div id="preview" class="preview"></div>
<pre id="message" class="message"></pre>
</div>`;

const PLAYGROUND_SCRIPT = `<script src="js/typlet.min.js"></script>
<script src="js/copy-typst.min.js"></script>
<script>
const $ = (id) => document.getElementById(id);
const describe = (label, d) => label + d.message + (d.hints || []).map((h) => '\\nhint: ' + h).join('');
function update() {
  const warnings = [];
  const strict = (warning) => (warnings.push(describe('warning: ', warning)), 'ignore');
  const options = { displayMode: $('display').checked, output: $('output').value, preamble: $('preamble').value || undefined, strict };
  try {
    const html = typlet.renderToString($('source').value, options);
    $('preview').innerHTML = html;
    $('message').textContent = warnings.join('\\n');
    $('message').className = 'message warning';
    $('size').textContent = html.length + ' characters of HTML';
  } catch (e) {
    $('preview').textContent = '';
    $('size').textContent = '';
    $('message').textContent = describe(e.kind ? e.kind + ' error: ' : '', e);
    $('message').className = 'message';
  }
}
for (const id of ['source', 'preamble', 'display', 'output']) $(id).addEventListener('input', update);
update();
</script>`;

const SITE_CSS = `:root { color-scheme: light dark; --fg: #1d1d1f; --bg: #fff; --muted: #5f6368; --line: #e3e3e6; --code: #f4f4f6; --accent: #2156b5; --warning: #8a5300; }
@media (prefers-color-scheme: dark) { :root { --fg: #e8e8ea; --bg: #141416; --muted: #a0a0a8; --line: #2c2c30; --code: #1f1f23; --accent: #8fb3ff; --warning: #e3a64a; } }
* { box-sizing: border-box; }
body { margin: 0; color: var(--fg); background: var(--bg); font: 17px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { display: flex; flex-wrap: wrap; gap: 0.5em 1.5em; align-items: baseline; padding: 0.8em 1.5em; border-bottom: 1px solid var(--line); }
header .brand { font-weight: 700; font-size: 1.2em; color: var(--fg); text-decoration: none; }
nav { display: flex; flex-wrap: wrap; gap: 0.3em 1em; }
nav a { color: var(--muted); text-decoration: none; }
nav a[aria-current] { color: var(--fg); font-weight: 600; }
main { max-width: 52em; margin: 0 auto; padding: 1em 1.5em 3em; }
a { color: var(--accent); }
h1 { font-size: 2em; margin: 0.6em 0 0.4em; }
h2 { margin-top: 1.8em; border-bottom: 1px solid var(--line); padding-bottom: 0.2em; }
code { background: var(--code); padding: 0.1em 0.3em; border-radius: 4px; font: 0.88em/1.5 ui-monospace, "Cascadia Code", Menlo, Consolas, monospace; }
pre { background: var(--code); padding: 0.8em 1em; border-radius: 6px; overflow-x: auto; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--line); padding: 0.4em 0.6em; text-align: left; vertical-align: top; }
table.gallery td:first-child { width: 45%; }
table.gallery code { white-space: pre-wrap; }
.typlet-display { overflow-x: auto; overflow-y: hidden; }
.refused { color: var(--muted); font-style: italic; }
.playground label { display: block; margin: 0.6em 0; }
.playground textarea { display: block; width: 100%; font: 15px/1.4 ui-monospace, monospace; padding: 0.5em; color: var(--fg); background: var(--code); border: 1px solid var(--line); border-radius: 6px; }
.playground .controls { display: flex; flex-wrap: wrap; gap: 1em; align-items: center; color: var(--muted); }
.playground .controls label { display: inline; margin: 0; }
.preview { font-size: 1.4em; min-height: 3em; padding: 0.5em; border: 1px solid var(--line); border-radius: 6px; margin-top: 0.6em; overflow-x: auto; }
.message { color: #cc0000; background: none; white-space: pre-wrap; }
.message.warning { color: var(--warning); }
.compare-controls { display: flex; flex-wrap: wrap; gap: 0.6em 1.2em; align-items: center; margin: 1.2em 0; }
.choice { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.choice a { padding: 0.25em 0.9em; color: var(--fg); text-decoration: none; border-left: 1px solid var(--line); }
.choice a:first-child { border-left: 0; }
.choice a[aria-current] { background: var(--accent); color: var(--bg); }
.compare-controls button { font: inherit; padding: 0.25em 0.9em; color: var(--fg); background: var(--code); border: 1px solid var(--line); border-radius: 6px; cursor: pointer; }
.compare-controls button:disabled { opacity: 0.5; cursor: default; }
.headline { font-size: 1.15em; margin: 0.4em 0; }
.timings th { font-weight: 600; }
.timings th[scope="row"] { font-weight: 400; }
.timings td, .timings tr:first-child th { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.notes { color: var(--muted); font-size: 0.92em; }
.notes summary { cursor: pointer; }
.formula { display: grid; grid-template-columns: repeat(var(--columns, 1), minmax(0, 1fr)); gap: 0.4em 2em; align-items: start; padding: 0.9em 0; border-bottom: 1px solid var(--line); }
.formula.columns { position: sticky; top: 0; z-index: 1; padding: 0.4em 0; font-weight: 600; background: var(--bg); }
.formula .out { min-height: 1.5em; overflow-x: auto; overflow-y: hidden; }
.formula [data-engine="Typlet"] .out { font-size: 1.21em; }
.formula .source { display: block; margin-top: 0.5em; padding: 0; color: var(--muted); background: none; font-size: 0.78em; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 40em) {
  .formula { grid-template-columns: minmax(0, 1fr); }
  .formula.columns { display: none; }
  .both .cell::before { content: attr(data-engine); display: block; color: var(--muted); font-size: 0.78em; }
}
footer { max-width: 52em; margin: 0 auto; padding: 1em 1.5em 2em; color: var(--muted); font-size: 0.85em; border-top: 1px solid var(--line); }
`;

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fonts'), { recursive: true });
mkdirSync(join(out, 'js'), { recursive: true });
for (const file of readdirSync(join(root, 'fonts'))) {
  if (file.endsWith('.woff2') || file.endsWith('.css') || file.endsWith('.txt')) copyFileSync(join(root, 'fonts', file), join(out, 'fonts', file));
}
copyFileSync(join(root, 'dist/typlet.min.js'), join(out, 'js/typlet.min.js'));
for (const name of ['auto-render', 'copy-typst', 'element']) copyFileSync(join(root, `dist/contrib/${name}.min.js`), join(out, `js/${name}.min.js`));
writeFileSync(join(out, 'site.css'), SITE_CSS);

// The comparison page: its script and formulas, and KaTeX as its package
// ships it, with the fonts in the format browsers choose and its license.
const compared = comparedFormulas();
copyFileSync(join(root, 'tools/site/compare.js'), join(out, 'js/compare.js'));
writeFileSync(join(out, 'js/compare-data.js'), `var COMPARE_FORMULAS = ${JSON.stringify(compared)};\n`);
const katexDir = dirname(createRequire(import.meta.url).resolve('katex/package.json'));
mkdirSync(join(out, 'katex/fonts'), { recursive: true });
for (const file of ['dist/katex.min.js', 'dist/katex.min.css', 'LICENSE']) copyFileSync(join(katexDir, file), join(out, 'katex', file.replace('dist/', '')));
for (const file of readdirSync(join(katexDir, 'dist/fonts'))) {
  if (file.endsWith('.woff2')) copyFileSync(join(katexDir, 'dist/fonts', file), join(out, 'katex/fonts', file));
}

for (const [name, title, source] of PAGES) {
  let body;
  let scripts = '<script src="js/typlet.min.js"></script>\n<script src="js/copy-typst.min.js"></script>';
  if (name === 'gallery') body = gallery();
  else if (name === 'playground') {
    body = PLAYGROUND;
    scripts = PLAYGROUND_SCRIPT;
  } else if (name === 'compare') {
    body = compare(compared.length);
    scripts = COMPARE_SCRIPT;
  } else {
    const markdown = readFileSync(join(root, source), 'utf8');
    body = md.render(name === 'supported' ? withExamples(markdown) : markdown, {});
  }
  writeFileSync(join(out, `${name}.html`), page(name, title, body, scripts, name !== 'compare'));
}
console.log(`Built site/ with ${PAGES.length} pages.`);
