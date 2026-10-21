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
<<<<<<< Updated upstream
=======
  // Recursion that follows the formula's structure, which the parser bounds
  // only for nesting (docs/DESIGN.md §6.6).
  ['a flat chain of 3,000 additions', '#(' + Array(3000).fill('1').join('+') + ')', {}],
  ['a recursive macro with a long body', '#f(79)', { preamble: '#let f(n) = if n == 0 { 0 } else { f(n - 1)' + ' + 1'.repeat(30) + ' }' }],
  ['1,500 set rules in a block', '#{' + 'set text(fill: blue);'.repeat(1500) + '$x$}', {}],
  ['1,200 nested definitions', '#x1200', { preamble: nestedDefinitions(1200) }],
  ['a deep equation number', 'x', { displayMode: true, preamble: nestedDefinitions(1200, (name) => `[a #${name}]`) + '\n#set math.equation(numbering: n => x1200)' }],
  ['a box whose body is a box', '#box()', { preamble: '#set box(box())' }],
  ['an attachment whose top is an attachment', 'attach(x)', { preamble: '#set math.attach(t: math.attach([x]))' }],
  ['2,000 nested attachments', '#x2000', { preamble: nestedDefinitions(2000, (name) => `math.attach(${name}, t: [1])`) }],
  // Stops at the expression depth: the evaluator follows the chain of
  // branches. The parser follows it without recursion, which
  // test/syntax.test.ts checks at a length that overflowed the stack, out of
  // reach of the stopwatch: parsing is linear in the source, and 10,000
  // branches took the whole 50 ms on a slow CI runner.
  ['3,000 else-if branches', '#{' + 'if false{}else '.repeat(3000) + '{}}', {}],
  ['a closure whose body is a chain of 3,000 additions', '#{ let f() = (' + '1+'.repeat(3000) + '1); 1 }', {}],
  // Values that share parts take exponential work to compare or show.
  ['shared arrays compared', '#(x30 == x30)', { preamble: doubling('(1,)', (x) => `(${x}, ${x})`) }],
  ['shared arrays shown', '#x30', { preamble: doubling('(1,)', (x) => `(${x}, ${x})`) }],
  ['shared content compared', '#(x30 == x30)', { preamble: doubling('[a]', (x) => `strong[#${x} #${x}]`) }],
  ['a huge number of primes', 'primes(#9223372036854775807)', {}],
  // Each delimiter of a chain of binomials is taller than the last, and a
  // stretched glyph is assembled from parts, up to a thousand: the parts
  // have a budget.
  ['120 nested binomials', '#x120', { preamble: nestedDefinitions(120, (name) => `math.binom(${name}, 1)`) }],
  ['a roman numeral of a huge number', 'x', { displayMode: true, preamble: '#set math.equation(numbering: "I")', equationCounter: { value: 1e16 } }],
  // Every length written to the output is within the size budget, whatever
  // computed it.
  ['a huge row gap', 'vec(gap: #1e9em, 1, 2)', {}],
  ['huge tracking', '#text(tracking: 1e9pt)[xy]', {}],
  ['a huge stroke', '#box(stroke: 1e9pt)[x]', {}],
  ['a huge baseline shift', '#text(baseline: 1e9pt)[x]', {}],
>>>>>>> Stashed changes
];

/** Formulas that stop with Typst's own errors: `[name, source, options, kind, message]`. */
export const TYPST_LIMIT_CASES = [
  ['endless recursion', '#f(0)', { preamble: '#let f(n) = f(n + 1)' }, 'eval', 'maximum function call depth exceeded'],
  ['deep nesting', '('.repeat(2000) + 'x' + ')'.repeat(2000), {}, 'syntax', 'maximum parsing depth exceeded'],
];
