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
  ['retained function calls', '#f(0)', { preamble: '#let g(x) = x\n#let f(x) = g(x)', maxCalls: 1 }],
  ['literal array growth', '#(1, 2, 3, 4)', { maxCollectionSize: 3 }],
  ['literal dictionary growth', '#(a: 1, b: 2)', { maxCollectionSize: 1 }],
  ['argument sink growth', '#f(0, 1, 2, 3)', { preamble: '#let f(a, ..rest) = rest', maxCollectionSize: 2 }],
  ['argument spread growth', '#f(..(1, 2), 3)', { preamble: '#let f(..rest) = rest', maxCollectionSize: 2 }],

];

/** Computations that must succeed promptly: `[name, source, options, expected markup]`. */
export const BOUNDED_CASES = [
  ['empty array at a huge count', '#(() * 9223372036854775807)', {}, '()'],
  ['bounded string construction', '#("abc" * 1000)', {}, 'abcabc'],
  ['macro with basic collection spread', 'vec(..#("a", "b"))', {}, '<mtext>a</mtext>'],
];

/** Formulas that stop with Typst's own errors: `[name, source, options, kind, message]`. */
export const TYPST_LIMIT_CASES = [
  ['endless recursion', '#f(0)', { preamble: '#let f(n) = f(n + 1)' }, 'eval', 'maximum function call depth exceeded'],
  ['deep nesting', '('.repeat(2000) + 'x' + ')'.repeat(2000), {}, 'syntax', 'maximum parsing depth exceeded'],
];

// These jobs run only in disposable processes, never in the synchronous tests.
/** @type {import('../scripts/lib/budget-runner.mjs').BudgetJob[]} */
export const ISOLATED_BUDGET_CASES = [
  {
    name: 'flat malformed formula diagnostics', source: '#(' + Array(12000).fill('1').join('+') + '+)',
    options: {}, expect: { kind: 'error', errorKind: 'syntax', message: 'expected expression' },
  },
  {
    name: 'flat closure body syntax depth', source: '#((x) => ' + Array(12000).fill('1').join('+') + ')',
    options: {}, expect: { kind: 'error', errorKind: 'limit' },
  },
  {
    name: 'flat formula syntax depth', source: '#(' + Array(12000).fill('1').join('+') + ')',
    options: {}, expect: { kind: 'error', errorKind: 'limit' },
  },
  {
    name: 'flat preamble syntax depth', source: 'x',
    options: { preamble: '#let value = ' + Array(12000).fill('1').join('+') },
    expect: { kind: 'error', errorKind: 'limit' },
  },
  {
    name: 'layout callback shares call work',
    source: 'cancel(x, angle: #(a => { let f(n) = if n == 0 { 0 } else { f(n - 1) + f(n - 1) }; let value = f(8); a }))',
    options: { maxCalls: 100 }, expect: { kind: 'error', errorKind: 'limit' },
  },
  {
    name: 'cross callbacks share value work',
    source: 'cancel(x, cross: #true, angle: #(a => { let same = x15 == x15; a }))',
    options: { preamble: doubling('(1,)', (x) => `(${x}, ${x})`).split('\n').slice(0, 16).join('\n') }, expect: { kind: 'error', errorKind: 'limit', message: 'Typlet stopped after 100000 value visits' },
  },
  ...['html', 'htmlAndMathml', 'mathml'].flatMap((output) => [
    {
      name: `prime integer bound in ${output}`, source: ['primes(#', '9223372036854775807', ')'].join(''),
      options: { output }, expect: { kind: 'error', errorKind: 'limit' },
    },
    {
      name: `prime boxes accumulate in ${output}`, source: '#box[$primes(#6000)$] #box[$primes(#6000)$]',
      options: { output, maxOutputSize: 5_000_000 }, expect: { kind: 'error', errorKind: 'limit' },
    },
    {
      name: `prime output bound in ${output}`, source: 'primes(#1000000)',
      options: { output, maxElements: 2_000_000, maxOutputSize: 10_000 }, expect: { kind: 'error', errorKind: 'limit' },
    },
  ]),
  {
    name: 'shared array comparison work', source: '#(x30 == x30)',
    options: { preamble: doubling('(1,)', (x) => `(${x}, ${x})`) },
    expect: { kind: 'error', errorKind: 'limit' },
  },
  {
    name: 'shared dictionary comparison work', source: '#(x30 == x30)',
    options: { preamble: doubling('(a: 1)', (x) => `(a: ${x}, b: ${x})`) },
    expect: { kind: 'error', errorKind: 'limit' },
  },
  {
    name: 'deep value comparison', source: '#(x300 == x300)',
    options: { preamble: '#let x0 = 1\n' + Array.from({ length: 300 }, (_, i) => `#let x${i + 1} = (x${i},)`).join('\n') },
    expect: { kind: 'error', errorKind: 'limit' },
  },
  {
    name: 'shared array representation work', source: '#x30',
    options: { preamble: doubling('(1,)', (x) => `(${x}, ${x})`) },
    expect: { kind: 'error', errorKind: 'limit' },
  },
  {
    name: 'shared dictionary representation work', source: '#x30',
    options: { preamble: doubling('(a: 1)', (x) => `(a: ${x}, b: ${x})`) },
    expect: { kind: 'error', errorKind: 'limit' },
  },
  {
    name: 'cumulative array comparison work',
    source: '#{ let same = x15 == x15; x15 == x15 }', options: { preamble: doubling('(1,)', (x) => `(${x}, ${x})`).split('\n').slice(0, 16).join('\n') },
    expect: { kind: 'error', errorKind: 'limit' },
  },
  {
    name: 'shared content JSON comparison work', source: '#(x30 == x30)',
    options: { preamble: doubling('[a]', (x) => `strong[#${x} #${x}]`) },
    expect: { kind: 'error', errorKind: 'limit' },
  },
  {
    name: 'deep value representation', source: '#x300',
    options: { preamble: '#let x0 = 1\n' + Array.from({ length: 300 }, (_, i) => `#let x${i + 1} = (x${i},)`).join('\n') },
    expect: { kind: 'error', errorKind: 'limit' },
  },
  {
    name: 'repeated array spread growth',
    source: '#{ let a = (' + Array.from({ length: 64 }, (_, i) => i).join(', ') + '); (' + Array.from({ length: 64 }, () => '..a').join(', ') + ') }',
    options: { maxCollectionSize: 128, maxCalls: 1000 },
    expect: { kind: 'error', errorKind: 'limit', message: 'Typlet stopped at a collection of more than 128 items' },
  },
  {
    name: 'dictionary merge growth',
    source: '#((' + Array.from({ length: 65 }, (_, i) => `a${i}: ${i}`).join(', ') + ') + (' + Array.from({ length: 65 }, (_, i) => `b${i}: ${i}`).join(', ') + '))',
    options: { maxCollectionSize: 128, maxCalls: 1000 },
    expect: { kind: 'error', errorKind: 'limit', message: 'Typlet stopped at a collection of more than 128 items' },
  },
  {
    name: 'arguments merge amplification',
    source: '#x30',
    options: { maxCollectionSize: 128, maxCalls: 1000, preamble: '#let capture(..args) = args\n' + doubling('capture(' + Array.from({ length: 64 }, (_, i) => i).join(', ') + ')', (x) => `${x} + ${x}`) },
    expect: { kind: 'error', errorKind: 'limit', message: 'Typlet stopped at a collection of more than 128 items' },
  },
  {
    name: 'empty array at the integer count bound',
    source: '#(() * 9223372036854775807)',
    options: { maxCalls: 4 },
    expect: { kind: 'success', contains: '()' },
  },
];

/** Deep trees built without deep syntax or removed runtime features. */
export function nestedDefinitions(count, build = (name) => `math.sqrt(${name})`) {
  return '#let x0 = $x$\n' + Array.from({ length: count }, (_, i) => `#let x${i + 1} = ${build(`x${i}`)}`).join('\n');
}

// All expensive structural cases use the same bounded child runner as the gate.
for (const entry of ['index', 'mathml']) {
  for (const output of (entry === 'mathml' ? ['mathml'] : ['html', 'htmlAndMathml', 'mathml'])) {
    for (const [name, source, options] of [
      ['repeated text expansion', '#([#("x" * 100000)] * 20)', {}],
      ['repeated number expansion', '#([#("1" * 100000)] * 20)', {}],
      ['boxed text expansion', '#box[#([#("x" * 100000)] * 20)]', {}],
      ['nested equation text expansion', '#box[$#([#("x" * 100000)] * 20)$]', {}],
      ['nested mathematical glyph expansion', Array(30).fill('#box[$' + 'x '.repeat(400) + '$]').join(' '), {}],
      ['external text expansion', '#strong[#([#("x" * 100000)] * 20)]', {}],
      ['raw text expansion', '#box[`' + 'x'.repeat(100000) + '`]', {}],
      ['shared equation number expansion', 'x', { displayMode: true, preamble: doubling('[a]', (x) => `[#${x}#${x}]`) + '\n#set math.equation(numbering: n => x30)' }],
    ]) {
      ISOLATED_BUDGET_CASES.push({
        name: `${name} in ${entry}/${output}`, source, options: { ...options, output }, entry, verifyRecovery: true,
        expect: { kind: 'error', errorKind: 'limit' },
      });
    }
    for (const [name, source, options] of [
      ['code rule chain', '#{' + 'set text(fill: blue);'.repeat(6000) + '$x$}', {}],
      ['markup rule chain', '#[' + '#set text(fill: blue);'.repeat(6000) + '$x$]', {}],
      ['preamble rule chain', 'x', { preamble: '#let bad = [' + '#set text(fill: blue);'.repeat(6000) + '$x$]' }],
      ['generated roots', '#x1200', { preamble: nestedDefinitions(1200) }],
      ['generated boxes', '#x1200', { preamble: nestedDefinitions(1200, (name) => `box(${name})`) }],
      ['deep equation number', 'x', { displayMode: true, preamble: nestedDefinitions(1200) + '\n#set math.equation(numbering: n => x1200)' }],
    ]) {
      ISOLATED_BUDGET_CASES.push({
        name: `${name} in ${entry}/${output}`, source, options: { ...options, output }, entry, verifyRecovery: true,
        expect: { kind: 'error', errorKind: 'limit' },
      });
    }
  }
}

for (const output of ['html', 'htmlAndMathml', 'mathml']) {
  for (const [name, source, preamble, mathmlOnlySuccess] of [
    ['inherited box cycle', '#box()', '#set box(box())', true],
    ['show-set box cycle', '#box()', '#show math.equation: set box(box())', true],
    ['inherited attachment cycle', 'attach(x)', '#set math.attach(t: math.attach([x]))', false],
    ['inherited spreader cycle', 'overbrace(x)', '#set math.overbrace(math.overbrace([x]))', false],
    ['inherited deep box body', '#box()', nestedDefinitions(1200) + '\n#set box([$#x1200$])', true],
  ]) {
    const entries = output === 'mathml' ? ['index', 'mathml'] : ['index'];
    for (const entry of entries) ISOLATED_BUDGET_CASES.push({
      name: `${name} in ${entry}/${output}`, source, options: { preamble, output }, entry,
      verifyRecovery: !(mathmlOnlySuccess && output === 'mathml'),
      expect: mathmlOnlySuccess && output === 'mathml' ? { kind: 'success' } : { kind: 'error', errorKind: 'limit' },
    });
  }
}

// Macro bodies can combine independent syntax and call depths into one stack.
for (const entry of ['index', 'mathml']) {
  for (const output of (entry === 'mathml' ? ['mathml'] : ['html', 'htmlAndMathml', 'mathml'])) {
    const definition = '#let f(n) = if n == 0 { 0 } else { f(n - 1)' + ' + 1'.repeat(30) + ' }';
    for (const [name, source, options] of [
      ['combined macro and expression depth', '#f(79)', { preamble: definition }],
      ['combined depth during preamble evaluation', 'x', { preamble: definition + '\n#f(79)' }],
      ['combined depth within a formula', '#{ ' + definition.slice(1) + '; f(79) }', {}],
      ['combined rule and macro depth', '#f(79)', { preamble: '#let f(n) = if n == 0 { $x$ } else { ' + 'set text(fill: blue);'.repeat(3) + ' (f(n - 1)) }' }],
      ...(output === 'mathml' ? [] : [['combined depth in a delayed callback', 'cancel(x, angle: #(a => { let result = f(79); a }))', { preamble: definition }]]),
    ]) ISOLATED_BUDGET_CASES.push({
      name: name + ' in ' + entry + '/' + output, source, options: { ...options, output }, entry, verifyRecovery: true,
      expect: { kind: 'error', errorKind: 'limit', message: 'Typlet stopped at an evaluation depth of more than 512' },
    });
    ISOLATED_BUDGET_CASES.push({
      name: 'call budget before combined depth in ' + entry + '/' + output, source: '#f(79)',
      options: { preamble: definition, maxCalls: 10, output }, entry, verifyRecovery: true,
      expect: { kind: 'error', errorKind: 'limit', message: 'Typlet stopped after 10 function calls' },
    }, {
      name: 'simple function depth79 in ' + entry + '/' + output, source: '#f(79)',
      options: { preamble: '#let f(n) = if n == 0 { 0 } else { f(n - 1) }', output }, entry,
      expect: { kind: 'success', contains: output === 'html' ? '>0</span>' : '<mn>0</mn>' },
    }, {
      name: 'bounded macro expression depth in ' + entry + '/' + output, source: '#f(79)',
      options: { preamble: '#let f(n) = if n == 0 { 0 } else { f(n - 1) + 1 }', output }, entry,
      expect: { kind: 'success', contains: output === 'html' ? '>9</span>' : '<mn>79</mn>' },
    }, {
      name: 'bounded flat expression depth in ' + entry + '/' + output, source: '#(' + Array(200).fill('1').join(' + ') + ')',
      options: { output }, entry, expect: { kind: 'success', contains: output === 'html' ? '>200</span>' : '<mn>200</mn>' },
    }, {
      name: 'simple function depth80 in ' + entry + '/' + output, source: '#f(80)',
      options: { preamble: '#let f(n) = if n == 0 { 0 } else { f(n - 1) }', output }, entry,
      expect: { kind: 'error', errorKind: 'eval', message: 'maximum function call depth exceeded' },
    });
  }
}
