// Differential fuzzing of Typlet's parser against typst-syntax (docs/DESIGN.md §5.3).
//
//   node tools/fuzz-syntax.mjs [--count N] [--seed S]
//
// Generates random inputs from a mix of Typst tokens and character-level
// mutations, parses each with the oracle and with Typlet, and compares the
// syntax trees. Failures are written to the OS temp directory, shrunk to a
// small reproduction. Requires the oracle (`npm run oracle:build`).

import { rmSync, writeFileSync } from 'node:fs';
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
const count = arg('--count', 100_000);
const seed = arg('--seed', 1);

// Bundle the parser and the tree dump so this script can run them directly.
const bundle = join(tmpdir(), `typlet-fuzz-${process.pid}.mjs`);
await build({
  stdin: {
    contents: `export { parse, parseCode, parseMath } from './src/syntax/index.ts'; export { dumpCst } from './test/cst.ts';`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  logLevel: 'error',
});
const { parse, parseCode, parseMath, dumpCst } = await import(pathToFileURL(bundle).href);
rmSync(bundle, { force: true });
const parsers = { math: parseMath, code: parseCode, markup: parse };

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

const MATH_TOKENS = [
  'x', 'y', 'a', 'f', 'pi', 'alpha', 'arrow', 'arrow.r', 'arrow.r.long', 'sum', 'mat', 'sqrt', 'abs', 'cases',
  'lr', 'bold', 'dif', 'é', 'x̂', '𝑥', 'α', 'ℝ', '中', '😀', '🇺🇸', 'ab_c', 'a-b',
  '1', '12', '3.14', '1.', '.5', '١٢', '²', '½', '1.2.3',
  '+', '-', '*', '/', '^', '_', "'", "''", '!', '=', '<', '>', '<=', '>=', '!=', '->', '=>', '<->', '|->',
  '~', '...', ':', ':=', '::=', '|', '||', '[|', '|]', '<<', '>>', '<<<', '>>>', '~~>', '-->', '<==>', '=:',
  '(', ')', '[', ']', '{', '}', '⟨', '⟩', '⌊', '⌋', ',', ';', '&', '\\', ' ', '  ', '\n', '\t', '\r\n',
  '\\#', '\\$', '\\u{41}', '\\u{zz}', '\\u{', '\\u{110000}', '"text"', '"a\\"b"', '"unclosed', '√', '∛', '∜',
  '#', '#x', '#(1 + 2)', '#none', '#true', '#1em', '#-1', '#h(1em)', '#f(x)[y]', '#[content *b* _e_]',
  '#{let x = 1; x}', '#let x = 1;', '#set text(red)', '#show: x', '#"s"', '#(a: 1, b: 2)', '#(1,)', '#(..a)',
  '#x.y', '#x.y()', '#1.5e3', '#0x1F', '#0b102', '#0o', '#12p', '#1e', '#1e5em', '#(x) => x', '#(a, b) = (1, 2)',
  '#if x {y} else {z}', '#for x in y {z}', '#for x, y in z {}', '#while x {y}', '#import "a": b',
  '#import "a": (b, c)', '#context x', '#$x$', '#`raw`', '#```lang code```', '#<label>', '#]', '#)', '#;',
  '//c\n', '/* c */', '/* unclosed', '*/', '..', '..a', 'delim: "["', 'augment: #2', '_: x', 'f(a, b; c)',
  'mat(1, 2; 3, 4)', 'f(x)', 'x(y)', '(a)/(b)', '$', '#let f(x) = x', '#(a: 1, a: 2)', '#(x: 1, 2)',
  '#f(a: 1, a: 2)', '#f(1: 2)', '#let (a, ..b, ..c) = d', '#let (a: b) = c', '#(x, y) => x', '#_ = 1',
  '#{1 + 2 * 3 == 4 and not 5 in 6}', '#{a not 1}', '#{x\n.y}', '#{if x {} \n else {}}', '#&&', '#||', '#~=',
  '#!', '##', '#@', '#[*]', '#[_x_]', '#[= heading]', '#[- item\n  - nested]', '#[+ e]', '#[/ t: d]',
  '#[@ref]', '#[https://typst.org)]', '#[a\\\nb]', '#[x ~ y -- z --- w]', '#[``]', '#[```\n  a\n b\n  ```]',
];

const CHARS = [...'abxy01_.,;:!?#$%&*+-/<=>@[]{}()^|~\'"`\\ \n\t'].concat(['α', '√', '中', '⟨', '😀']);

// Templates that put generated content (`@`) into every syntactic context:
// math calls and their named, spread and 2D arguments, delimiters,
// attachments, fractions, and embedded code, content and equations.
const TEMPLATES = [
  'f(@)', 'mat(@)', 'mat(@; @)', 'f(@, @)', 'f(..@)', 'f(@: @)', 'f(name: @)', 'f(_: @)', 'f(a: @, a: @)',
  'lr(@)', '(@)', '[@]', '{@}', '[|@|]', '@/@', '@^@', '@_@', "@'", '√@', '@!',
  '#(@)', '#{@}', '#[@]', '#f(@)', '#f(@)[@]', '$@$', '#$@$', '#$ @ $', '#let @ = @', '#let f(@) = @',
  '#set f(@)', '#show @: @', '#if @ {@} else {@}', '#for @ in @ {@}', '#(@) => @', '#(@, @) = @',
  '#{let x = @; @}', '#[*@*]', '#[_@_]', '#[= @]', '#[- @]', '#[@ <label>]', '#context @', '#import @: @',
];

function soup(depth) {
  const n = 1 + Math.floor(random() * (depth > 0 ? 4 : 8));
  let text = '';
  for (let i = 0; i < n; i++) {
    if (depth < 3 && random() < 0.3) {
      text += pick(TEMPLATES).replace(/@/g, () => soup(depth + 1));
    } else {
      text += pick(MATH_TOKENS);
    }
    if (random() < 0.3) text += ' ';
  }
  return text;
}

function generate() {
  // Nested token soup, sometimes mutated at the character level.
  let text = soup(0);
  const mutations = random() < 0.4 ? 1 + Math.floor(random() * 3) : 0;
  for (let i = 0; i < mutations; i++) {
    const at = Math.floor(random() * (text.length + 1));
    if (random() < 0.5) text = text.slice(0, at) + pick(CHARS) + text.slice(at);
    else text = text.slice(0, at) + text.slice(at + 1);
  }
  // Don't leave a lone surrogate behind after a deletion.
  return text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '');
}

function generateMode() {
  const r = random();
  return r < 0.7 ? 'math' : r < 0.85 ? 'code' : 'markup';
}

const typletTree = (src, mode) => {
  try {
    return JSON.stringify(dumpCst(parsers[mode](src)));
  } catch (error) {
    return `CRASH: ${error.message}`;
  }
};

/** How many inputs per mode were fuzzed, and how many produced syntax errors. */
const stats = { math: [0, 0], code: [0, 0], markup: [0, 0] };
const hasError = (tree) => tree[0] === 'Error' || (Array.isArray(tree[3]) && tree[3].some(hasError));

/** Runs cases through both parsers; returns the ones that differ. */
function compare(cases, record = false) {
  const oracle = runOracle(['parse'], cases.map((c, i) => ({ id: String(i), src: c.src, mode: c.mode })));
  if (record) {
    cases.forEach((c, i) => {
      stats[c.mode][0]++;
      if (hasError(oracle[i].cst)) stats[c.mode][1]++;
    });
  }
  return cases.filter((c, i) => JSON.stringify(oracle[i].cst) !== typletTree(c.src, c.mode));
}

/** Shrinks a failing case by deleting characters while it keeps failing. */
function shrink(failure) {
  let { src } = failure;
  let changed = true;
  while (changed) {
    changed = false;
    const candidates = [...src].map((_, i) => [...src].filter((__, j) => j !== i).join(''));
    const failing = compare(candidates.map((s) => ({ src: s, mode: failure.mode })));
    if (failing.length > 0) {
      src = failing.reduce((a, b) => (b.src.length < a.src.length ? b : a)).src;
      changed = true;
    }
  }
  return { ...failure, src };
}

const started = performance.now();
const failures = [];
const BATCH = 5000;
for (let done = 0; done < count; done += BATCH) {
  const cases = Array.from({ length: Math.min(BATCH, count - done) }, () => ({ src: generate(), mode: generateMode() }));
  failures.push(...compare(cases, true));
  process.stdout.write(`\r${Math.min(done + BATCH, count)} / ${count} inputs, ${failures.length} mismatches`);
}
console.log(` (${((performance.now() - started) / 1000).toFixed(1)} s, seed ${seed})`);
for (const [mode, [total, erroneous]] of Object.entries(stats)) {
  console.log(`  ${mode.padEnd(6)} ${total} inputs, ${erroneous} with syntax errors`);
}

if (failures.length > 0) {
  const unique = [...new Map(failures.map((f) => [`${f.mode}:${f.src}`, f])).values()];
  const shrunk = unique.slice(0, 20).map(shrink);
  const out = join(tmpdir(), 'typlet-fuzz-failures.json');
  writeFileSync(
    out,
    JSON.stringify(
      shrunk.map((f) => ({
        ...f,
        oracle: runOracle(['parse'], [{ id: '0', src: f.src, mode: f.mode }])[0].cst,
        typlet: JSON.parse(typletTree(f.src, f.mode).replace(/^CRASH: (.*)$/, '"CRASH: $1"')),
      })),
      null,
      1,
    ),
  );
  console.log(`Shrunk reproductions of the first ${shrunk.length} distinct failures:`);
  for (const f of shrunk) console.log(`  [${f.mode}] ${JSON.stringify(f.src)}`);
  console.log(`Details: ${out}`);
  process.exit(1);
}
