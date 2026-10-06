// Generates docs/supported.md, the list of what Typlet supports, from the
// library it evaluates with (docs/DESIGN.md §6.5): the math and code functions with
// their parameters, the constants and symbols, and the names in Typst's
// global scope that Typlet lacks.
//
//   node tools/site/features.mjs [--check]
//
// With --check, fails if docs/supported.md is stale.

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const bundle = join(tmpdir(), `typlet-features-${process.pid}.mjs`);
await build({
  stdin: {
    contents: `
      export { LIBRARY } from './src/eval/library.ts';
      export { GLOBAL_NAMES } from './src/generated/names.ts';
      export { symModule } from './src/eval/symbol.ts';
      export { repr, longName } from './src/eval/value.ts';
      export { typstVersion } from './src/version.ts';`,
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

/** What a parameter accepts, as Typst's docs write it. */
function type(info) {
  switch (info.kind) {
    case 'any':
      return 'any';
    case 'type':
      return T.longName(info.type);
    case 'value':
      return T.repr(info.value);
    case 'union':
      return [...new Set(info.infos.map(type))].join(' or ');
  }
}

/** A function's signature: its parameters with their types and defaults. */
function signature(func) {
  const params = func.params.map((p) => {
    const name = p.variadic ? `..${p.name}` : p.name;
    const types = type(p.cast.info);
    if (p.positional && !p.named) return `${name}: ${types}`;
    let def = '';
    if (p.default) {
      try {
        // On one line: `repr` breaks long arrays and dictionaries.
        def = ` = ${T.repr(p.default())
          .replace(/\(\n\s*/g, '(')
          .replace(/,?\n\s*\)/g, ')')
          .replace(/\n\s*/g, ' ')}`;
      } catch {
        def = '';
      }
    }
    return `${name}: ${types}${def}`;
  });
  return `${func.name}(${params.join(', ')})`;
}

/** The names a module's scope binds, with their values. */
function bindings(module) {
  const scope = module.scope;
  return [...scope.names()].sort().map((name) => [name, scope.get(name).value]);
}

const escapeCell = (s) => s.replace(/\|/g, '\\|');
const code = (s) => `\`${escapeCell(s)}\``;

// An example of each function, which the documentation site renders
// (tools/site/build.mjs). Every function needs an entry; '' means none.
const EXAMPLES = {
  abs: 'abs(x)',
  accent: 'accent(a, arrow)',
  attach: 'attach(Pi, t: alpha, b: beta, tl: 1, br: 2)',
  bb: 'bb(R)',
  binom: 'binom(n, k)',
  bold: 'bold(A) + A',
  cal: 'cal(A)',
  cancel: 'cancel(x)',
  cases: 'cases(1 "if" x > 0, 0 "else")',
  class: 'a class("relation", ast) b',
  display: 'display(sum_i x_i)',
  equation: '',
  frac: 'frac(a, b)',
  frak: 'frak(P)',
  inline: 'inline(sum_i x_i)',
  italic: 'italic(Gamma)',
  limits: 'limits(A)_1^2',
  lr: 'lr(]a/b])',
  mat: 'mat(1, 2; 3, 4)',
  mid: 'lr({ x mid(bar.v) x > 0 })',
  mono: 'mono(x + 1)',
  norm: 'norm(x)',
  op: 'op("rank") A',
  overbrace: 'overbrace(1 + 2, n)',
  overbracket: 'overbracket(1 + 2, n)',
  overline: 'overline(z)',
  overparen: 'overparen(a b, n)',
  overshell: 'overshell(a b, n)',
  primes: 'attach(f, tr: primes(#2))',
  root: 'root(3, x)',
  round: 'round(x)',
  sans: 'sans(A)',
  scr: 'scr(L)',
  script: 'x script(x)',
  scripts: 'scripts(sum)_1^2',
  serif: 'serif(A B C)',
  sqrt: 'sqrt(x)',
  sscript: 'x sscript(x)',
  stretch: 'stretch(=)^"def"',
  text: 'text(fill: #red, x)',
  underbrace: 'underbrace(1 + 2, n)',
  underbracket: 'underbracket(1 + 2, n)',
  underline: 'underline(x)',
  underparen: 'underparen(a b, n)',
  undershell: 'undershell(a b, n)',
  upright: 'upright(x)',
  vec: 'vec(1, 2, 3)',
};
const CODE_EXAMPLES = {
  box: '#box(stroke: 0.5pt, inset: 2pt, $x$)',
  emph: '#emph[emphasis]',
  h: 'a #h(1em) b',
  hide: 'a #hide[b] c',
  highlight: '#highlight[$x$]',
  link: '#link("https://typst.app")[Typst]',
  luma: '#text(fill: luma(40%))[x]',
  rgb: '#text(fill: rgb("#2156b5"))[x]',
  strong: '#strong[strong]',
  text: '#text(fill: blue)[blue]',
};

/** A table row: the function, its example and its signature. */
function row([name, value], examples) {
  const example = examples[name];
  if (example === undefined) throw new Error(`tools/site/features.mjs: no example for \`${name}\``);
  if (/[|`]/.test(example)) throw new Error(`tools/site/features.mjs: the example for \`${name}\` has a pipe or a backtick`);
  return `| ${code(name)} | ${example ? code(example) : ''} | ${code(signature(value.v))} |`;
}

const math = bindings(T.LIBRARY.math);
const global = bindings(T.LIBRARY.global);
const mathFuncs = math.filter(([, v]) => v.type === 'function');
const globalFuncs = global.filter(([, v]) => v.type === 'function');
const operators = math.filter(([, v]) => v.type === 'content' && v.v.func === 'op').map(([n]) => n);
const spacings = math.filter(([, v]) => v.type === 'content' && v.v.func === 'h').map(([n]) => n);
const colors = global.filter(([, v]) => v.type === 'color').map(([n]) => n);
const alignments = global.filter(([, v]) => v.type === 'alignment').map(([n]) => n);

// Symbols: every name and variant in codex.
let symbolCount = 0;
let variantCount = 0;
const countSymbols = (defs) => {
  for (const def of defs.values()) {
    if (def.kind === 'module') countSymbols(def.defs);
    else {
      symbolCount++;
      variantCount += def.symbol.list.length;
    }
  }
};
countSymbols(T.symModule());

// Typst's global names Typlet lacks.
const typlet = new Set(global.map(([n]) => n));
const missing = T.GLOBAL_NAMES.split(' ')
  .map((entry) => entry.split(':'))
  .filter(([name]) => !typlet.has(name));
const byKind = (kind) => missing.filter(([, k]) => k === kind).map(([n]) => code(n));

const lines = [
  '<!-- Generated by tools/site/features.mjs from the library. Do not edit by hand. -->',
  '',
  '# Supported features',
  '',
  `Typlet renders Typst ${T.typstVersion}'s math, and the embedded code formulas use (docs/DESIGN.md §6). This list is generated from the library Typlet evaluates with.`,
  '',
  '## Math',
  '',
  `All of Typst's math syntax: attachments, fractions, roots, delimiters, alignment points and line breaks, shorthands such as \`->\` and \`!=\`, primes, and calls with named arguments, spreads and rows. All ${mathFuncs.length} functions of the \`math\` module:`,
  '',
  '| Function | Example | Parameters |',
  '|---|---|---|',
  ...mathFuncs.map((binding) => row(binding, EXAMPLES)),
  '',
  `Text operators, upright with spacing: ${operators.map(code).join(', ')}.`,
  '',
  `Spacings: ${spacings.map(code).join(', ')}.`,
  '',
  `Symbols: all ${symbolCount} symbols of the \`sym\` module, with ${variantCount} variants by modifier, as in codex 0.3.0, including deprecated names with Typst's warnings.`,
  '',
  '## Embedded code',
  '',
  'Code after `#`, in the arguments of math calls, and in a `preamble`:',
  '- **Values:** `none`, `auto`, booleans, integers, floats, lengths, angles, ratios, relative lengths, fractions, strings, arrays, dictionaries, colors, alignments, strokes, symbols, content, functions and modules, with Typst\'s operators and errors.',
  '- **Definitions:** `let` bindings with destructuring, functions with positional and named parameters, defaults and argument sinks, closures with captures, and recursion within the budgets.',
  '- **Control flow:** `if` and `else`, code blocks, `return`, `break` and `continue`.',
  '- **Markup in content blocks:** text, strong and emphasis, escapes, shorthands, smart quotes, raw text, labels, line breaks and nested equations.',
  '- **Set rules** for the functions below that have settable parameters, and for the math elements: in a content or code block, or in the preamble.',
  '',
  'Functions in code:',
  '',
  '| Function | Example | Parameters |',
  '|---|---|---|',
  ...globalFuncs.map((binding) => row(binding, CODE_EXAMPLES)),
  '',
  `Constants: the colors ${colors.map(code).join(', ')}, and the alignments ${alignments.map(code).join(', ')}. Modules: \`sym\` and \`math\`.`,
  '',
  '## Not supported',
  '',
  'Typlet refuses what it doesn\'t support with a `TypletError` of kind `unsupported`, which the `fallback` option can render another way. These names of Typst\'s global scope are not supported:',
  `- **Functions:** ${byKind('function').join(', ')}.`,
  `- **Types:** ${byKind('type').join(', ')}.`,
  `- **Modules:** ${byKind('module').join(', ')}.`,
  ...(byKind('direction').length > 0 ? [`- **Directions:** ${byKind('direction').join(', ')}.`] : []),
  '',
  'Nor are show rules, loops, methods of values, assignments, imports, and the markup of documents: headings, lists, references and figures. Loops, `range` and methods are the planned Level 4 (docs/DESIGN.md §6.3); show rules, introspection and file access are not planned.',
  '',
  'The HTML output also refuses what it can\'t draw yet, and draws those formulas as MathML with a warning: characters New Computer Modern Math lacks, raw text, fonts other than New Computer Modern Math, the Regular weight, bold math letters, text strokes, OpenType features, right-to-left text with punctuation at its ends, text that wraps in a box, clipped boxes, and boxes with sizes relative to the page.',
  '',
];
const markdown = `${lines.join('\n')}`;
const target = join(root, 'docs/supported.md');

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  } catch {}
  if (current !== markdown) {
    console.error('docs/supported.md is stale: run `npm run docs:features`');
    process.exit(1);
  }
  console.log('docs/supported.md is up to date.');
} else {
  writeFileSync(target, markdown);
  console.log(`Wrote docs/supported.md: ${mathFuncs.length} math functions, ${globalFuncs.length} code functions, ${symbolCount} symbols.`);
}
