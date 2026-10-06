// Abusive formulas, which must stop with a `limit` error (docs/DESIGN.md §6.6 and
// §6.8). test/budgets.test.ts checks the errors; scripts/check-budgets.mjs
// checks that the built bundle stops each within 50 ms.

/** `#let` lines that double a value 30 times, starting from `start`. */
function doubling(start, join) {
  const lines = [`#let x0 = ${start}`];
  for (let i = 1; i <= 30; i++) lines.push(`#let x${i} = ${join(`x${i - 1}`)}`);
  return lines.join('\n');
}

/** `[name, source, options]` */
export const BUDGET_CASES = [
  ['an exponential recursion', '#f(30)', { preamble: '#let f(n) = if n == 0 { 0 } else { f(n - 1) + f(n - 1) }' }],
  ['a repeated string', '#("x" * 100000000)', {}],
  ['a repeated array', '#((1,) * 100000000)', {}],
  ['a doubled string', 'x', { preamble: doubling('"ab"', (x) => `${x} + ${x}`) }],
  ['a doubled array', 'x', { preamble: doubling('(1, 2)', (x) => `${x} + ${x}`) }],
  ['doubled content', 'x', { preamble: doubling('[a]', (x) => `${x} + ${x}`) }],
  ['content that refers to itself twice', '#x30', { preamble: doubling('[a]', (x) => `[#${x} #${x}]`) }],
  ['a huge space', 'a #h(1e9pt) b', {}],
  ['huge text', '#text(size: 1e6pt)[x]', {}],
  ['a huge box', '#box(width: 1e6pt)', {}],
];

/** Formulas that stop with Typst's own errors: `[name, source, options, kind, message]`. */
export const TYPST_LIMIT_CASES = [
  ['endless recursion', '#f(0)', { preamble: '#let f(n) = f(n + 1)' }, 'eval', 'maximum function call depth exceeded'],
  ['deep nesting', '('.repeat(2000) + 'x' + ')'.repeat(2000), {}, 'syntax', 'maximum parsing depth exceeded'],
];
