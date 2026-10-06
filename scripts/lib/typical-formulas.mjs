// Formulas with the constructs most pages use: letters, numbers and
// operators, scripts, fractions, roots, sums and integrals with limits, named
// operators, symbols, delimiters, accents, styled letters, text, a matrix,
// cases and an aligned equation. The build compiles the functions they call
// along with the bundle (scripts/lib/eager.mjs), so the list should stay
// short: a function marked here is compiled on every page, whether a formula
// calls it or not.
//
// Checked against 2,000 formulas of IBEM-im2typst (docs/DESIGN.md §5.2): these
// formulas call all but one of the 564 functions that at least a quarter of
// those call.

export const TYPICAL_FORMULAS = [
  { src: 'a + b^2 - x_(i,j)^2 = 0' },
  { src: 'e^(i pi) + 1/2 != (a + b)/c' },
  { src: 'x = (-b plus.minus sqrt(b^2 - 4 a c)) / (2 a)', display: true },
  { src: 'sum_(k=1)^n k = (n (n + 1)) / 2', display: true },
  { src: 'integral_0^oo e^(-x^2) dif x = sqrt(pi) / 2' },
  { src: "f(x) = sin(alpha) + cos(beta), quad lim_(x -> 0) f'(x)" },
  { src: 'hat(x) + tilde(y) + dot(z) + bold(v) + cal(A) + upright(d) + bb(R)' },
  { src: 'mat(a, b; c, d) vec(x, y) = "text"', display: true },
  { src: 'abs(x) = cases(x "if" x >= 0, -x "otherwise")', display: true },
  { src: '(a + b)^2 &= a^2 + 2 a b + b^2 \\ &= c^2', display: true },
];
