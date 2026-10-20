// Abusive formulas: those that must stop with a `limit` error (docs/DESIGN.md
// §6.6 and §6.8), and those whose work must stay linear in their size, so that
// they render. test/budgets.test.ts checks the errors and the rendering;
// scripts/check-budgets.mjs checks that the built bundle finishes each within
// 50 ms.

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

/** A chain of `n` field accesses. */
const chain = (n) => 'x' + '.x'.repeat(n);

/**
 * Formulas that must render, within the time budget, as their work is linear
 * in their size: `[name, source, options]`. Raw code tagged as Typst is parsed
 * and highlighted again. Highlighting followed a chain of field accesses by
 * recursion, which overflowed the stack at a few thousand, and found siblings
 * in time that grew with the code's width. At these sizes it took seconds or
 * overflowed; each renders in a few milliseconds now, which leaves the budget
 * room for slower machines.
 */
export const BOUNDED_CASES = [
  ['a deep chain in raw code', '#[```typc ' + chain(3000) + '```]', {}],
  ['wide raw code', '#[```typc ' + 'x; '.repeat(2000) + '```]', {}],
  ['a hashed chain in raw markup', '#[```typ #' + chain(3000) + '```]', {}],
  ['many hashes in raw markup', '#[```typ ' + '#x '.repeat(2000) + '```]', {}],
  ['a chain in raw math', '#[```typm ' + chain(3000) + '```]', {}],
];
