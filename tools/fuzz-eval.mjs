// Differential fuzzing of Typlet's evaluation, MathML and layout against
// Typst (docs/DESIGN.md §5.3).
//
//   node tools/fuzz-eval.mjs [--count N] [--seed S]
//   node tools/fuzz-eval.mjs --replay FILE
//
// Generates random formulas from a grammar of math and embedded code, Levels
// 1 to 3, with and without preambles. The oracle and Typlet render each, and
// their MathML, diagnostics and frames are compared as the tests compare the
// corpus. Formulas Typlet refuses as unsupported are skipped. Every render,
// in every output, must finish within a second, or fail with a TypletError.
// Failures are written to the OS temp directory, and `--replay` checks the
// formulas of such a file again, or of any JSON array of formulas
// (`{id, src, display, preamble?}`). Requires the oracle
// (`npm run oracle:build`).

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { runOracle } from './lib/oracle.mjs';

const root = resolve(import.meta.dirname, '..');
const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
};
const replayArg = process.argv.indexOf('--replay');
const replay =
  replayArg === -1 ? null : JSON.parse(readFileSync(process.argv[replayArg + 1], 'utf8')).map((entry) => entry.formula ?? entry);
const count = replay ? replay.length : arg('--count', 5_000);
const seed = arg('--seed', 1);

const bundle = join(tmpdir(), `typlet-fuzz-eval-${process.pid}.mjs`);
await build({
  stdin: {
    contents: `
      export { renderToString, TypletError } from './src/index.ts';
      export { evalCorpusFormula, isPreambleWarning } from './test/eval-helpers.ts';
      export { equationToMathml } from './src/mathml/index.ts';
      export { SourceError } from './src/eval/diag.ts';
      export { frameDiff, layoutFlat } from './test/layout-helpers.ts';
      export { parseMath } from './src/syntax/parser.ts';`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  logLevel: 'error',
});
const T = await import(pathToFileURL(bundle).href);
rmSync(bundle, { force: true });

// A small, seeded PRNG (mulberry32), so failures reproduce.
let state = seed >>> 0;
function random() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (list) => list[Math.floor(random() * list.length)];

const ATOMS = [
  'x', 'y', 'a', 'b', 'n', 'i', 'k', 'f(x)', '1', '2', '10', '3.14', '1/2', 'pi', 'alpha', 'beta', 'theta', 'omega',
  'Gamma', 'infinity', 'dots', 'dots.c', 'RR', 'NN', 'ZZ', 'emptyset', 'arrow.r', 'arrow.l.double', 'partial', 'nabla',
  'sum', 'product', 'integral', 'plus.minus', 'times', 'dot', 'eq.not', 'lt.eq', 'gt', 'approx', 'prime', 'dif',
  '"text"', '"if "', '"for all"', 'sin', 'cos', 'log', 'ln', 'max', 'lim', 'det', 'quad', 'thin', 'wide', 'hat', 'tilde',
  '#none', '#1', '#(1 + 2)', '#(2 * 3em)', '#"s"', '#(1, 2).len()', '#true', '#1em', '#(a: 1)', '#red', '#left',
  'foo', 'xy', 'x_1', 'a_(i j)', "f'", 'oo', '#x', 'ℝ', 'α', '∑', '中',
];
const JOINS = [' + ', ' - ', ' = ', ' < ', ' <= ', ' -> ', ' => ', ' times ', ' dot ', ', ', ' ', ' ', ' &= ', ' & ', ' \\\n ', '; ', ' / ', '^', '_'];
const TEMPLATES = [
  '@/@', '(@)/(@)', '@^@', '@_@', '@^(@)_(@)', "@'", "@''", '@!', 'sqrt(@)', 'root(3, @)', 'abs(@)', 'norm(@)',
  'floor(@)', 'ceil(@)', 'vec(@, @)', 'vec(@, @, delim: "[")', 'mat(@, @; @, @)', 'mat(delim: "[", @, @)',
  'mat(@, @; @, @, augment: #1)', 'cases(@, @)', 'cases(@ &"if" @, @ &"else")', 'binom(@, @)', 'lr((@))', 'lr([@], size: #150%)',
  '(@)', '[@]', '{@}', '|@|', 'hat(@)', 'tilde(@)', 'arrow(@)', 'dot(@)', 'overline(@)', 'underline(@)',
  'overbrace(@, @)', 'underbrace(@, @)', 'overbracket(@)', 'cancel(@)', 'cancel(@, inverted: #true)', 'bold(@)',
  'cal(@)', 'upright(@)', 'italic(@)', 'bb(@)', 'frak(@)', 'sans(@)', 'mono(@)', 'op("@")', 'op("lim", limits: #true)_(@)',
  'limits(@)_(@)', 'scripts(sum)_(@)', 'attach(@, t: @, b: @)', 'attach(@, tl: @, br: @)', 'display(@)', 'inline(@)',
  'script(@)', 'sscript(@)', 'stretch(=)^(@)', 'sum_(@)^(@) @', 'integral_(@)^(@) @ dif x', 'lim_(@ -> @) @',
  'class("relation", @)', 'serif(@)', 'accent(@, ->)', 'primes(2)', 'lr(⟨ @ ⟩)', 'mid(|)',
  // Embedded code, Levels 1 to 3.
  '#h(1em) @', '@ #h(-1em/6) @', '#text(fill: red, $@$)', '#text(size: 1.2em)[$@$]', '#text(weight: "bold")[ab]',
  '#text(tracking: 1pt)[ab c]', '#text(baseline: 2pt, $@$)', '#box(stroke: 0.5pt, inset: 2pt, $@$)',
  '#box(fill: yellow, width: 2em, $@$)', '#box(stroke: blue + 1pt, outset: 1pt)[@]', '#strong[$@$]', '#strong[text]',
  '#emph[text]', '#highlight[$@$]', '#hide[$@$]', '#link("https://typst.app")[$@$]', '#[a *b* _c_ "d" -- e]',
  '#[text $@$ text]', '#$@$', '#{let z = 2; z * 3}', '#{let (p, q) = (1, 2); p + q}', '#((u) => u + 1)(2)',
  '#if 1 < 2 [yes] else [no]', '#if 1 > 2 {1} else {2}', '#[#set text(fill: blue); $@$]',
  '#{set math.mat(delim: "["); $mat(@)$}', '#{let f(n) = if n < 2 { n } else { f(n - 1) + f(n - 2) }; f(8)}',
  '#let g = 3; #g', '#(1em + 2pt)', '#calc.pow(2, 3)', '#(-1)', '#("a" + "b")', '#(1, 2, 3).map(x => x)',
];
const PREAMBLES = [
  '#let RR = $bb(R)$',
  '#let norm(x) = $lr(|| #x ||)$',
  '#set math.mat(delim: "[")',
  '#set math.vec(gap: 1em)',
  '#set math.cases(reverse: true)',
  '#set text(fill: blue)',
  '#set text(size: 1.2em)',
  '#set math.equation(numbering: "(1)")',
  '#let f(x) = x + 1\n#let c = 3',
  '#set text(tracking: 1pt)',
];

function expr(depth) {
  const n = 1 + Math.floor(random() * (depth > 0 ? 2 : 4));
  let text = '';
  for (let i = 0; i < n; i++) {
    if (i > 0) text += pick(JOINS);
    text += depth < 3 && random() < 0.45 ? pick(TEMPLATES).replace(/@/g, () => expr(depth + 1)) : pick(ATOMS);
  }
  return text;
}

function generate(id) {
  const formula = { id: String(id), src: expr(0), display: random() < 0.5 };
  if (random() < 0.25) formula.preamble = pick(PREAMBLES);
  return formula;
}

const simplify = (d) => ({
  severity: d.severity,
  message: d.message,
  ...(d.hints && d.hints.length > 0 ? { hints: d.hints } : {}),
  ...(d.span ? { span: d.span } : {}),
});
const fromTyplet = (d) => simplify({ ...d, span: d.span ? [d.span.start, d.span.end] : null });

/** Typlet's MathML and diagnostics for a formula, as the MathML test compares them. */
function typletMathml(formula) {
  const warnings = [];
  try {
    const result = T.evalCorpusFormula(formula);
    warnings.push(...result.warnings.filter((d) => !T.isPreambleWarning(d)));
    const mathml = [T.equationToMathml(result.equation, warnings, undefined, result.styles)];
    return { mathml, diagnostics: warnings.map(fromTyplet) };
  } catch (e) {
    if (!(e instanceof T.SourceError)) return { crash: e.stack ?? String(e) };
    if (e.diagnostics.some((d) => d.kind === 'unsupported')) return 'unsupported';
    return { mathml: null, diagnostics: e.diagnostics.map(fromTyplet) };
  }
}

/** Renders a formula in every output; returns a crash or hang, if any. */
function renderAll(formula) {
  for (const output of ['htmlAndMathml', 'html', 'mathml']) {
    const start = performance.now();
    try {
      T.renderToString(formula.src, { output, displayMode: formula.display, preamble: formula.preamble, strict: 'ignore' });
    } catch (e) {
      if (!(e instanceof T.TypletError)) return `crash in ${output}: ${e.stack ?? e}`;
    }
    const ms = performance.now() - start;
    if (ms > 1000) return `hang in ${output}: ${ms.toFixed(0)} ms`;
  }
  return null;
}

const stats = { formulas: 0, syntaxErrors: 0, unsupported: 0, mathml: 0, typstErrors: 0, frames: 0, failures: 0 };
const failures = [];
const fail = (formula, kind, detail) => {
  stats.failures++;
  failures.push({ kind, formula, detail });
};

const BATCH = 500;
for (let done = 0; done < count; done += BATCH) {
  const formulas = replay ? replay.slice(done, done + BATCH) : Array.from({ length: Math.min(BATCH, count - done) }, (_, i) => generate(done + i));
  const oracle = new Map(runOracle(['run', '--outputs', 'mathml,frame'], formulas).map((r) => [r.id, r]));
  for (const formula of formulas) {
    stats.formulas++;
    const problem = renderAll(formula);
    if (problem) fail(formula, problem.split(':')[0], problem);
    if (T.parseMath(formula.src).erroneous()) {
      stats.syntaxErrors++;
      continue;
    }
    const want = oracle.get(formula.id);
    const got = typletMathml(formula);
    if (got === 'unsupported') {
      stats.unsupported++;
      continue;
    }
    if (got.crash) {
      fail(formula, 'crash', got.crash);
      continue;
    }
    stats.mathml++;
    if (want.mathml == null) stats.typstErrors++;
    const expected = JSON.stringify({
      mathml: want.mathml ?? null,
      diagnostics: (want.mathmlDiagnostics ?? []).filter((d) => d.at === 'src' || d.severity === 'error').map(simplify),
    });
    const actual = JSON.stringify(got);
    if (actual !== expected) {
      fail(formula, 'mathml', `want ${expected}\n  got  ${actual}`);
      continue;
    }
    if (!want.frame) continue;
    let frame;
    try {
      frame = T.layoutFlat(formula);
    } catch (e) {
      if (e instanceof T.SourceError && e.diagnostics.some((d) => d.kind === 'unsupported')) continue;
      fail(formula, 'layout', String(e.stack ?? e));
      continue;
    }
    stats.frames++;
    const diff = T.frameDiff(frame, want.frame);
    if (diff) fail(formula, 'frame', diff);
  }
  process.stdout.write(`\r${stats.formulas} formulas, ${stats.failures} failures`);
}
process.stdout.write('\n');

console.log(
  `${stats.formulas} formulas (${replay ? 'replayed' : `seed ${seed}`}): ${stats.syntaxErrors} syntax errors, ${stats.unsupported} unsupported; ` +
    `${stats.mathml} MathML compared, ${stats.typstErrors} of them errors in Typst; ${stats.frames} frames compared.`,
);
if (failures.length > 0) {
  const file = join(tmpdir(), `typlet-fuzz-eval-${replay ? 'replay' : seed}.json`);
  writeFileSync(file, JSON.stringify(failures, null, 1));
  const kinds = new Map();
  for (const f of failures) kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1);
  console.log(`${failures.length} failures (${[...kinds].map(([k, n]) => `${n} ${k}`).join(', ')}), written to ${file}. The first:`);
  for (const f of failures.slice(0, 8)) console.log(`- ${f.kind}: ${JSON.stringify(f.formula)}\n  ${f.detail.split('\n').slice(0, 3).join('\n  ')}`);
  process.exitCode = 1;
}
