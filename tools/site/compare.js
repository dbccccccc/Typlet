// The comparison page of the documentation site (tools/site/build.mjs): it
// renders the same formulas with Typlet or with KaTeX in the reader's
// browser and times each step, like the speed test that KaTeX's site links
// to. js/compare-data.js defines the formulas, COMPARE_FORMULAS.
//
// The page's address chooses the renderer (`?engine=typlet`, `katex` or
// `both`), so choosing one loads the page again, and every measurement starts
// from a fresh page. This script loads the renderer's files itself, to time
// that too, and fetches them anew each time, as on a first visit, unless the
// address says `cached`.

(() => {
  'use strict';

  const FORMULAS = COMPARE_FORMULAS;

  // Both render their default output, the HTML with MathML for screen readers.
  const ENGINES = {
    typlet: {
      name: 'Typlet',
      script: 'js/typlet.min.js',
      styles: 'fonts/typlet.css',
      owns: (path) => !path.includes('/katex/') && /\/(js\/typlet\.min\.js|fonts\/[^/]+)$/.test(path),
      source: (formula) => formula.typ,
      version: () => typlet.version,
      render: (formula, element) => typlet.render(formula.typ, element, { displayMode: formula.display, throwOnError: false, strict: 'ignore' }),
    },
    katex: {
      name: 'KaTeX',
      script: 'katex/katex.min.js',
      styles: 'katex/katex.min.css',
      owns: (path) => path.includes('/katex/'),
      source: (formula) => formula.tex,
      version: () => katex.version,
      render: (formula, element) => katex.render(formula.tex, element, { displayMode: formula.display, throwOnError: false }),
    },
  };

  const params = new URLSearchParams(location.search);
  const choice = ['typlet', 'katex', 'both'].includes(params.get('engine')) ? params.get('engine') : 'typlet';
  const cached = params.has('cached');
  const engines = choice === 'both' ? [ENGINES.typlet, ENGINES.katex] : [ENGINES[choice]];
  const address = (engine, useCache) => `?engine=${engine}${useCache ? '&cached' : ''}`;

  const $ = (id) => document.getElementById(id);
  function element(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // --- The controls --------------------------------------------------------------

  for (const link of $('engines').querySelectorAll('a')) {
    link.href = address(link.dataset.engine, cached);
    if (link.dataset.engine === choice) link.setAttribute('aria-current', 'true');
  }
  $('fresh').checked = !cached;
  $('fresh').addEventListener('change', () => {
    location.search = address(choice, !$('fresh').checked);
  });

  // --- The page's formulas ---------------------------------------------------------

  /** Lays out the page with an empty element per formula and renderer, and returns those elements per renderer. */
  function skeleton() {
    const list = $('formulas');
    list.classList.toggle('both', engines.length > 1);
    list.style.setProperty('--columns', String(engines.length));
    if (engines.length > 1) {
      const head = element('div', 'formula columns');
      for (const engine of engines) head.append(element('div', '', engine.name));
      list.append(head);
    }
    const targets = engines.map(() => []);
    let category = null;
    for (const formula of FORMULAS) {
      if (formula.category !== category) {
        category = formula.category;
        list.append(element('h2', '', category));
      }
      const row = element('div', 'formula');
      engines.forEach((engine, k) => {
        // The renderer is an attribute, not a class: `typlet` and `katex` are the renderers' own classes.
        const cell = element('div', 'cell');
        cell.dataset.engine = engine.name;
        const out = element('div', 'out');
        cell.append(out, element('code', 'source', engine.source(formula)));
        row.append(cell);
        targets[k].push(out);
      });
      list.append(row);
    }
    return targets;
  }

  // --- Measuring ---------------------------------------------------------------------

  /** Loads a renderer's stylesheet and script, and resolves when both are ready. */
  function load(engine) {
    const fresh = cached ? '' : `?fresh=${Date.now().toString(36)}`;
    const ready = (e) =>
      new Promise((resolve, reject) => {
        e.onload = resolve;
        e.onerror = () => reject(new Error(`Could not load ${e.src || e.href}.`));
      });
    const styles = element('link');
    styles.rel = 'stylesheet';
    styles.href = engine.styles + fresh;
    const script = element('script');
    script.src = engine.script + fresh;
    const both = Promise.all([ready(styles), ready(script)]);
    document.head.append(styles, script);
    return both;
  }

  /** Renders every formula into its element, then has the browser lay the page out. */
  function render(engine, targets) {
    const start = performance.now();
    let first = 0;
    for (let i = 0; i < FORMULAS.length; i++) {
      engine.render(FORMULAS[i], targets[i]);
      if (i === 0) first = performance.now() - start;
    }
    const rendered = performance.now();
    // Reading a size makes the browser style and lay out what was rendered.
    void document.body.offsetHeight;
    return { first, all: rendered - start, layout: performance.now() - rendered };
  }

  /** What the browser fetched for a renderer: the bytes of its script and stylesheet, and of its fonts. */
  function downloads(engine) {
    const sizes = { script: 0, styles: 0, fonts: 0, fontFiles: 0 };
    for (const entry of performance.getEntriesByType('resource')) {
      const path = new URL(entry.name).pathname;
      if (!engine.owns(path)) continue;
      if (path.endsWith('.js')) sizes.script += entry.encodedBodySize;
      else if (path.endsWith('.css')) sizes.styles += entry.encodedBodySize;
      else {
        sizes.fonts += entry.encodedBodySize;
        sizes.fontFiles++;
      }
    }
    return sizes;
  }

  // --- The results -------------------------------------------------------------------

  const ms = (time) => `${time.toFixed(1)} ms`;
  const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;

  const ROWS = [
    ['The library: its script and stylesheet fetched, and the script run', (r) => ms(r.library)],
    ['The first formula', (r) => ms(r.first)],
    [`All ${FORMULAS.length} formulas`, (r) => ms(r.all)],
    ['Their layout by the browser', (r) => ms(r.layout)],
    ['All formulas and their layout again, now that the code has run', (r) => (r.again ? ms(r.again.all + r.again.layout) : '')],
    ['The script and the stylesheet, as the server sends them', (r) => (r.sizes ? `${kb(r.sizes.script)} + ${kb(r.sizes.styles)}` : '')],
    ['The fonts these formulas need', (r) => (r.sizes ? `${kb(r.sizes.fonts)} in ${r.sizes.fontFiles} files` : '')],
  ];

  /** Whether the page was out of view at some point while it was measured. */
  let background = document.hidden;

  /** Shows the measurements so far: a sentence per renderer, and the table. */
  function show(results) {
    const box = $('results');
    box.replaceChildren();
    if (background) {
      box.append(element('p', 'message warning', 'This page was in the background while it rendered. Browsers slow such pages down, so these times are longer than those of a page in view.'));
    }
    for (const r of results) {
      const total = element('strong', '', ms(r.all + r.layout));
      const sentence = element('p', 'headline');
      sentence.append(`${r.engine.name} ${r.engine.version()} rendered and laid out this page's formulas in `, total, '.');
      box.append(sentence);
    }
    const table = element('table', 'timings');
    const head = element('tr');
    head.append(element('td'));
    for (const r of results) head.append(element('th', '', r.engine.name));
    table.append(head);
    for (const [label, value] of ROWS) {
      const values = results.map(value);
      if (values.every((v) => v === '')) continue;
      const row = element('tr');
      const th = element('th', '', label);
      th.scope = 'row';
      row.append(th);
      for (const v of values) row.append(element('td', '', v));
      table.append(row);
    }
    box.append(table);
  }

  async function run() {
    const targets = skeleton();
    const results = [];
    for (const [k, engine] of engines.entries()) {
      const start = performance.now();
      await load(engine);
      const library = performance.now() - start;
      results.push({ engine, library, ...render(engine, targets[k]) });
    }
    background ||= document.hidden;
    show(results);

    // The fonts arrive after the formulas are drawn.
    await document.fonts.ready;
    for (const r of results) r.sizes = downloads(r.engine);
    show(results);

    $('again').disabled = false;
    $('again').addEventListener('click', () => {
      for (const list of targets) for (const target of list) target.textContent = '';
      // Lay out the emptied page first, so that only the rendering is timed.
      void document.body.offsetHeight;
      results.forEach((r, k) => (r.again = render(r.engine, targets[k])));
      show(results);
    });
  }

  run().catch((error) => {
    $('results').replaceChildren(element('p', 'message', error.message));
  });
})();
