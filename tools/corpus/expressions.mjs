// Generates code expressions for embedded code Level 1 (docs/DESIGN.md §6.3), and
// formulas that use them. The oracle evaluates each one, so Typlet's value
// model, operators and error messages can be compared with Typst's.

const literals = [
  'none', 'auto', 'true', 'false',
  '0', '1', '-3', '1.5', '1e3', '0.25',
  '1pt', '2.5mm', '1cm', '0.5in', '1em', '-1em',
  '90deg', '1rad', '50%', '120%', '1fr',
  '"a"', '"[\\"]"',
  '()', '(1,)', '(1, 2)', '(:)', '(a: 1)', '(hline: 1, vline: 1)',
];

const unary = ['-1em', '+1pt', '-50%', 'not true', 'not 1', '-(1pt + 1em)', '-"a"'];

// Every pair of these operands under every binary operator, valid or not:
// Typlet must match Typst's results and its error messages.
const operands = [
  '2', '2.5', '1pt', '1em', '50%', '90deg', '1fr', '"a"', 'true', 'none', 'auto',
  '(1, 2)', '(a: 1)', 'red', 'left', 'top', '(50% + 1pt)',
];
const operators = ['+', '-', '*', '/', '==', '!=', '<', '<=', '>', '>=', 'and', 'or', 'in'];

const specific = [
  '1em/6', '-1em/6', '2 * 1pt', '1pt / 2pt', '(1em + 2pt) * 2', '1pt + 1em - 1pt', '1pt * 1pt',
  'left + top', 'top + left', 'left + right', 'center + horizon', 'start + top', 'left + 1pt',
  'rgb("#ff0000")', 'rgb("#f00")', 'rgb(255, 0, 0)', 'rgb(50%, 0%, 0%)', 'rgb("nope")',
  'luma(50%)', 'luma(128)',
  'sym.arrow.r', 'sym.arrow.r.double', 'sym.arrow.double.r', 'sym.arrow.foo', 'sym.foo',
  'sym.alpha', 'sym.RR', 'sym.gt.tri',
  'math.frac', 'math.foo',
  'h(1em)', 'h(-1em/6)', 'h(1fr)', 'h(1pt, weak: true)', 'h("a")',
  'math.frac(1, 2)', 'math.frac([1], [2])', 'math.frac(1)',
  'math.attach("x", t: "2")', 'math.mat((1, 2), (3, 4))', 'math.op("argmax", limits: true)',
  'math.lr([(x)], size: 120%)', 'math.cases([a], [b], reverse: true)', 'math.root([3], [x])',
  'math.vec(1, 2, delim: "[")', 'math.vec(1, 2, delim: none)', 'math.vec(1, 2, delim: "x")',
  'math.mat(augment: 2, (1, 2, 3))', 'math.mat(augment: (hline: 1, vline: 1), (1, 2), (3, 4))',
  'math.cancel([x], inverted: true)', 'math.class("relation", sym.suit.heart)',
  'math.class("nonsense", [x])',
];

// Typst's named colors (typst-library visualize/color.rs, adapted from colors.css).
const colors = [
  'black', 'gray', 'silver', 'white', 'navy', 'blue', 'aqua', 'teal', 'eastern',
  'purple', 'fuchsia', 'maroon', 'red', 'orange', 'yellow', 'olive', 'green', 'lime',
];

export function expressionSources() {
  const pairs = operands.flatMap((a) => operators.flatMap((op) => operands.map((b) => `${a} ${op} ${b}`)));
  return [...new Set([...literals, ...unary, ...pairs, ...specific, ...colors])];
}

/**
 * Formulas whose behavior depends on Level 1 code: how values display in
 * math, math-call arguments, callable symbols, and common errors.
 */
export const codeFormulas = [
  ['display-none', '#none'],
  ['display-auto', '#auto'],
  ['display-bool', '#true'],
  ['display-int', '#2'],
  ['display-float', '#2.5'],
  ['display-str', '#"text"'],
  ['display-length', '#1em'],
  ['display-ratio', '#50%'],
  ['display-array', '#(1, 2)'],
  ['display-color', '#red'],
  ['display-alignment', '#left'],
  ['display-symbol', '#sym.arrow.r'],
  ['display-content', '#math.frac(1, 2)'],
  ['paren-expr', '#(1 + 2)'],
  ['unary-needs-parens', '#-1'],
  ['spacing-h', 'a #h(1em) b'],
  ['spacing-h-negative', 'a #h(-1em/6) b'],
  ['spread-rows', 'mat(..#((1, 2), (3, 4)))'],
  ['spread-dict', 'mat(..#(delim: "["), 1, 2)'],
  ['named-int', 'mat(augment: #2, 1, 2, 3)'],
  ['named-content-fails', 'mat(augment: 2, 1, 2, 3)'],
  ['named-string', 'mat(delim: "[", 1, 2)'],
  ['named-none', 'mat(delim: #none, 1, 2)'],
  ['named-dict', 'mat(augment: #(hline: 1, vline: 1), a, b; c, d)'],
  ['named-alignment', 'mat(align: #left, 1, 22)'],
  ['named-duplicate', 'mat(delim: "[", delim: "(", 1)'],
  ['call-non-function', 'alpha(x)'],
  ['call-callable-accent', 'hat(x)'],
  ['call-callable-delimiter', 'floor(x)'],
  ['call-unknown', 'foo(x)'],
  ['unknown-variable', 'foo'],
  ['single-letter-literal', 'x(y)'],
  ['field-on-symbol', 'arrow.r.double'],
  ['field-unknown-modifier', 'arrow.nope'],
  ['deprecated-symbol', 'gt.tri'],
  ['math-module-call', '#math.attach("x", t: "2")'],
  ['sym-module', '#sym.alpha + #sym.RR'],
];
