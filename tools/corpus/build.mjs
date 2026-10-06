// Builds the test corpus in test/corpus/ from its sources (docs/DESIGN.md §5.2).
//
//   node tools/corpus/build.mjs [--only name,name] [--labels FILE [--sample N]]
//
// Corpus files (committed):
//   paired.jsonl       The 81 formulas of the paired corpus (paired.mjs).
//   typst-docs.jsonl   Equations from the examples in Typst's math docs.
//   typstpad.jsonl     TypstPad's symbol picker and templates.
//   symbols.jsonl      One formula per variant of every Typst symbol.
//   code.jsonl         Formulas exercising embedded code Level 1.
//   levels.jsonl       Formulas exercising embedded code Levels 2 and 3.
//   features.jsonl     Formulas exercising each feature of math evaluation and MathML.
//   expressions.jsonl  Code expressions for values and operators, Levels 1 to 3.
//   syntax.jsonl       Parser edge cases in math, code and markup mode.
//
// --labels samples a local file of Typst formulas, such as IBEM-im2typst's
// training labels, into test/corpus/local/labels.jsonl. That directory is not
// committed: the labels come from several datasets with different licenses.
//
// Sources that live outside this repository (Typst's source, TypstPad) are
// optional; when one is missing its corpus file is left as it is.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { cratePath } from '../lib/cargo.mjs';
import { writeJsonl } from '../lib/jsonl.mjs';
import { runOracle } from '../lib/oracle.mjs';
import { codeFormulas, expressionSources } from './expressions.mjs';
import { levelExpressions, levelFormulas } from './levels.mjs';
import { featureFormulas } from './features.mjs';
import { syntaxCases } from './syntax-cases.mjs';

const root = resolve(import.meta.dirname, '../..');
const out = join(root, 'test/corpus');
const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const parsed = { only: null, labels: null, sample: 2000 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') parsed.only = new Set(argv[++i].split(','));
    else if (argv[i] === '--labels') parsed.labels = argv[++i];
    else if (argv[i] === '--sample') parsed.sample = Number(argv[++i]);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return parsed;
}

const hash = (text) => createHash('sha256').update(text).digest('hex');
const wanted = (name) => !args.only || args.only.has(name);

function save(name, records) {
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.id)) throw new Error(`${name}: duplicate id ${record.id}`);
    ids.add(record.id);
  }
  writeJsonl(join(out, `${name}.jsonl`), records);
  console.log(`${name}.jsonl: ${records.length} records`);
}

/** Splits Typst documents into formulas with the oracle; returns them by document id. */
function splitDocuments(docs) {
  const formulas = runOracle(['split'], docs);
  const byDoc = new Map();
  for (const formula of formulas) {
    if (formula.error) throw new Error(`split failed: ${formula.error}`);
    const docId = formula.id.replace(/-\d+$/, '');
    if (!byDoc.has(docId)) byDoc.set(docId, []);
    byDoc.get(docId).push(formula);
  }
  return byDoc;
}

/** Page settings don't apply to a formula renderer, so they leave the preamble. */
function preambleOf(statements) {
  const kept = statements.filter((s) => !/^#set\s+page\s*\(/.test(s));
  return kept.length > 0 ? kept.join('\n') : undefined;
}

// --- paired.jsonl ---------------------------------------------------------

async function paired() {
  const { corpus } = await import(pathToFileURL(join(import.meta.dirname, 'paired.mjs')).href);
  // Entries marked `typMarkup` are whole documents: statements, then one equation.
  const markup = corpus.filter((e) => e.typMarkup).map((e) => ({ id: e.id, doc: e.typ }));
  const split = splitDocuments(markup);

  return corpus.map((e) => {
    const record = { id: e.id, cat: e.cat };
    if (e.typMarkup) {
      const [formula, ...rest] = split.get(e.id) ?? [];
      if (!formula || rest.length > 0) throw new Error(`paired ${e.id}: expected one equation`);
      Object.assign(record, { src: formula.src, display: formula.display, preamble: preambleOf(formula.preamble) });
    } else {
      Object.assign(record, { src: e.typ, display: Boolean(e.display) });
    }
    if (e.tex) record.tex = e.tex;
    if (e.note) record.note = e.note;
    return record;
  });
}

// --- typst-docs.jsonl -----------------------------------------------------

function typstLibraryDir() {
  try {
    return cratePath('typst-library');
  } catch {
    return null;
  }
}

/** The ```example blocks in a Rust file's doc comments, compiled as Typst would. */
function docExamples(rust) {
  const examples = [];
  let current = null;
  for (const raw of rust.split(/\r?\n/)) {
    const match = /^\s*\/\/\/ ?(.*)$/.exec(raw);
    if (!match) {
      current = null;
      continue;
    }
    const line = match[1];
    if (current === null) {
      if (/^```example\b/.test(line)) current = [];
    } else if (/^```/.test(line)) {
      examples.push(current.join('\n'));
      current = null;
    } else if (line.startsWith('>>>')) {
      current.push(line.slice(3).replace(/^ /, '')); // compiled, hidden in the docs
    } else if (!line.startsWith('<<<')) {
      current.push(line); // `<<<` lines are shown in the docs but not compiled
    }
  }
  return examples;
}

function typstDocs() {
  const dir = typstLibraryDir();
  if (!dir) return null;
  const mathDir = join(dir, 'src/math');
  const docs = readdirSync(mathDir)
    .filter((f) => f.endsWith('.rs'))
    .sort()
    .flatMap((file) =>
      docExamples(readFileSync(join(mathDir, file), 'utf8')).map((doc, i) => ({
        id: `${basename(file, '.rs')}-${i + 1}`,
        doc,
      })),
    );
  const split = splitDocuments(docs);
  return docs.flatMap(({ id }) =>
    (split.get(id) ?? []).map((formula) => ({
      id: formula.id,
      src: formula.src,
      display: formula.display,
      preamble: preambleOf(formula.preamble),
    })),
  );
}

// --- typstpad.jsonl -------------------------------------------------------

async function typstpad() {
  const dir = resolve(process.env.TYPSTPAD_DIR ?? join(root, '../../TypstPad'));
  const entry = join(dir, 'src/data/mathPicker.ts');
  if (!existsSync(entry)) return null;

  // The picker data is TypeScript with helper functions; bundle it and read
  // the real values instead of scraping the source.
  const bundled = join(tmpdir(), `typlet-typstpad-${process.pid}.mjs`);
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: bundled, logLevel: 'error' });
  const { mathPickerGroups } = await import(pathToFileURL(bundled).href);
  const { mathSymbolCategories } = await import(pathToFileURL(bundled).href).catch(() => ({}));
  rmSync(bundled, { force: true });

  const seen = new Map();
  const add = (category, symbol) => {
    if (!symbol.code || seen.has(symbol.code)) return;
    seen.set(symbol.code, { category, tooltip: symbol.tooltip });
  };
  for (const group of mathPickerGroups) {
    for (const category of group.categories) {
      for (const symbol of category.symbols) add(`${group.id}/${category.id}`, symbol);
    }
  }
  for (const category of mathSymbolCategories ?? []) {
    for (const symbol of category.symbols) add(`symbols/${category.id}`, symbol);
  }

  // TypstPad renders picker entries and simplified-mode input as display equations.
  return [...seen].map(([code, meta]) => ({
    id: `tp-${hash(code).slice(0, 10)}`,
    src: code,
    display: true,
    meta,
  }));
}

// --- symbols.jsonl --------------------------------------------------------

function symbols() {
  return runOracle(['symbols']).map((s) => {
    const path = [s.module, s.name, s.modifiers].filter(Boolean).join('.');
    const record = { id: path, src: path, display: false, meta: { value: s.value } };
    const deprecated = s.deprecated ?? s.bindingDeprecated;
    if (deprecated) record.meta.deprecated = deprecated;
    return record;
  });
}

// --- code.jsonl and expressions.jsonl ----------------------------------------

function code() {
  return codeFormulas.map(([id, src]) => ({ id, src, display: false }));
}

function expressions() {
  return [...new Set([...expressionSources(), ...levelExpressions])].map((expr) => ({ id: `x-${hash(expr).slice(0, 12)}`, expr }));
}

// --- local labels -------------------------------------------------------------

/**
 * Samples `count` distinct labels from a JSON Lines file whose records have a
 * `label` field. Picks the labels with the smallest hashes, so the sample is
 * deterministic and spread across the file.
 */
async function sampleLabels(file, count) {
  const labels = new Map();
  const lines = createInterface({ input: createReadStream(file) });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const label = JSON.parse(line).label;
    if (typeof label === 'string' && label.trim() !== '') labels.set(hash(label), label);
  }
  return [...labels]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(0, count)
    // The labels don't say whether a formula was inline or displayed; multi-line
    // ones need display mode for their alignment.
    .map(([h, label]) => ({ id: `l-${h.slice(0, 12)}`, src: label, display: /\\\s*$|\\\n| \\ |&/.test(label) }));
}

// --- main -----------------------------------------------------------------

mkdirSync(out, { recursive: true });
if (wanted('paired')) save('paired', await paired());
if (wanted('typst-docs')) {
  const records = typstDocs();
  if (records) save('typst-docs', records);
  else console.warn('typst-docs: typst-library source not found; skipped');
}
if (wanted('typstpad')) {
  const records = await typstpad();
  if (records) save('typstpad', records);
  else console.warn('typstpad: TypstPad not found (set TYPSTPAD_DIR); skipped');
}
if (wanted('symbols')) save('symbols', symbols());
if (wanted('code')) save('code', code());
if (wanted('levels')) save('levels', levelFormulas());
if (wanted('features')) save('features', featureFormulas());
if (wanted('expressions')) save('expressions', expressions());
if (wanted('syntax')) save('syntax', syntaxCases.map(([id, mode, src]) => ({ id, mode, src })));
if (args.labels) {
  mkdirSync(join(out, 'local'), { recursive: true });
  const records = await sampleLabels(args.labels, args.sample);
  writeJsonl(join(out, 'local/labels.jsonl'), records);
  writeFileSync(join(out, 'local/SOURCE.txt'), `Sampled ${records.length} labels from ${args.labels}\n`);
  console.log(`local/labels.jsonl: ${records.length} records (not committed)`);
}
