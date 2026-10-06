// Paired corpus: the same formula written in LaTeX (for KaTeX) and in Typst
// math syntax, which tools/corpus/build.mjs turns into test/corpus/paired.jsonl.
// `typ: null` / `tex: null` means "no native way".
// `typMarkup: true` means `typ` is a full Typst markup snippet instead of a
// bare math body (used for features that need scripting / set rules).
// `display: true` renders in display mode.

export const corpus = [
  // ---- basics
  { id: 'sup-sub', cat: 'basics', tex: String.raw`a+b^2 - x_{i,j}^{2}`, typ: 'a+b^2 - x_(i,j)^2' },
  { id: 'euler', cat: 'basics', tex: String.raw`e^{i\pi}+1=0`, typ: 'e^(i pi)+1=0' },
  { id: 'primes', cat: 'basics', tex: String.raw`f'(x) + f''(x) + g'''`, typ: "f'(x) + f''(x) + g'''" },
  { id: 'quadratic', cat: 'basics', display: true, tex: String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`, typ: 'x = (-b plus.minus sqrt(b^2-4a c))/(2a)' },
  { id: 'unicode-input', cat: 'basics', tex: 'α+β=γ', typ: 'α+β=γ' },

  // ---- fractions & roots
  { id: 'frac-nested', cat: 'fractions', display: true, tex: String.raw`\frac{1}{1+\frac{1}{1+\frac{1}{x}}}`, typ: '1/(1+1/(1+1/x))' },
  { id: 'cfrac', cat: 'fractions', display: true, tex: String.raw`\cfrac{1}{1+\cfrac{1}{1+\cfrac{1}{x}}}`, typ: 'display(1/(1+display(1/(1+display(1/x)))))' },
  { id: 'binom', cat: 'fractions', tex: String.raw`\binom{n}{k} = \frac{n!}{k!(n-k)!}`, typ: 'binom(n, k) = (n!)/(k!(n-k)!)' },
  { id: 'root-n', cat: 'fractions', tex: String.raw`\sqrt[3]{x+1} + \sqrt{\sqrt{\sqrt{x}}}`, typ: 'root(3, x+1) + sqrt(sqrt(sqrt(x)))' },
  { id: 'pde', cat: 'fractions', display: true, tex: String.raw`\frac{\partial^2 u}{\partial t^2}=c^2\nabla^2u`, typ: '(partial^2 u)/(partial t^2) = c^2 nabla^2 u' },

  // ---- big operators
  { id: 'sum', cat: 'big-ops', display: true, tex: String.raw`\sum_{i=1}^{n} i^2 = \frac{n(n+1)(2n+1)}{6}`, typ: 'sum_(i=1)^n i^2 = (n(n+1)(2n+1))/6' },
  { id: 'gauss', cat: 'big-ops', display: true, tex: String.raw`\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt\pi}{2}`, typ: 'integral_0^infinity e^(-x^2) dif x = sqrt(pi)/2' },
  { id: 'oint', cat: 'big-ops', display: true, tex: String.raw`\oint_C \vec F\cdot d\vec r`, typ: 'integral.cont_C arrow(F) dot dif arrow(r)' },
  { id: 'iiint', cat: 'big-ops', display: true, tex: String.raw`\iiint_V f\,dV`, typ: 'integral.triple_V f dif V' },
  { id: 'euler-product', cat: 'big-ops', display: true, tex: String.raw`\prod_{p\text{ prime}} \frac{1}{1-p^{-s}}`, typ: 'product_(p "prime") 1/(1-p^(-s))' },
  { id: 'lim', cat: 'big-ops', display: true, tex: String.raw`\lim_{n\to\infty} \left(1+\frac1n\right)^n = e`, typ: 'lim_(n -> infinity) (1+1/n)^n = e' },
  { id: 'substack', cat: 'big-ops', display: true, tex: String.raw`\sum_{\substack{0<i<m\\0<j<n}} P(i,j)`, typ: 'sum_(0<i<m \\ 0<j<n) P(i,j)' },
  { id: 'sideset', cat: 'big-ops', display: true, tex: String.raw`\sideset{_a^b}{_c^d}\sum`, typ: 'attach(limits(sum), tl: b, bl: a, tr: d, br: c)' },
  { id: 'oiint', cat: 'big-ops', display: true, tex: String.raw`\oiint_S \mathbf{E}\cdot d\mathbf{A}`, typ: 'integral.surf_S bold(E) dot dif bold(A)' },

  // ---- delimiters
  { id: 'auto-paren', cat: 'delimiters', display: true, tex: String.raw`\left(\frac{a}{b}\right)^2 \left[\sum_i x_i\right]`, typ: '(a/b)^2 [sum_i x_i]' },
  { id: 'middle', cat: 'delimiters', display: true, tex: String.raw`\left\langle \frac{\psi}{2} \middle| H \middle| \phi \right\rangle`, typ: 'lr(chevron.l psi/2 mid(|) H mid(|) phi chevron.r)' },
  { id: 'big-sizes', cat: 'delimiters', tex: String.raw`\bigl( \Bigl( \biggl( \Biggl( x \Biggr) \biggr) \Bigr) \bigr)`, typ: 'lr(size: #120%, ( lr(size: #150%, ( lr(size: #190%, ( lr(size: #240%, (x)) )) )) ))' },
  { id: 'floor-ceil', cat: 'delimiters', tex: String.raw`\lfloor x \rfloor + \lceil y \rceil`, typ: 'floor(x) + ceil(y)' },
  { id: 'norm-abs', cat: 'delimiters', tex: String.raw`\|\mathbf{v}\| \le |x| + |y|`, typ: 'norm(bold(v)) <= abs(x) + abs(y)' },
  { id: 'braket', cat: 'delimiters', tex: String.raw`\langle\phi|\psi\rangle`, typ: 'chevron.l phi|psi chevron.r' },
  { id: 'null-delim', cat: 'delimiters', display: true, tex: String.raw`\left.\frac{df}{dx}\right|_{x=0}`, typ: 'lr(zws (dif f)/(dif x) |)_(x=0)' },

  // ---- matrices & arrays
  { id: 'pmatrix', cat: 'matrices', display: true, tex: String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`, typ: 'mat(a, b; c, d)' },
  { id: 'bmatrix-dots', cat: 'matrices', display: true, tex: String.raw`\begin{bmatrix}1&0&\cdots&0\\0&1&\cdots&0\\\vdots&\vdots&\ddots&\vdots\\0&0&\cdots&1\end{bmatrix}`, typ: 'mat(delim: "[", 1,0,dots.c,0; 0,1,dots.c,0; dots.v,dots.v,dots.down,dots.v; 0,0,dots.c,1)' },
  { id: 'vmatrix', cat: 'matrices', display: true, tex: String.raw`\det\begin{vmatrix}a&b\\c&d\end{vmatrix} = ad-bc`, typ: 'det mat(delim: "|", a, b; c, d) = a d - b c' },
  { id: 'vector', cat: 'matrices', display: true, tex: String.raw`\begin{pmatrix}x\\y\\z\end{pmatrix}`, typ: 'vec(x, y, z)' },
  { id: 'array-rules', cat: 'matrices', display: true, tex: String.raw`\left(\begin{array}{cc|c} 1 & 2 & 3 \\ 4 & 5 & 6 \end{array}\right)`, typ: 'mat(augment: #2, 1, 2, 3; 4, 5, 6)' },
  { id: 'array-hline', cat: 'matrices', display: true, tex: String.raw`\begin{array}{c|c} a & b \\ \hline c & d \end{array}`, typ: 'mat(delim: #none, augment: #(hline: 1, vline: 1), a, b; c, d)' },
  { id: 'smallmatrix', cat: 'matrices', tex: String.raw`\left(\begin{smallmatrix}a&b\\c&d\end{smallmatrix}\right)`, typ: 'script(mat(a, b; c, d))' },
  { id: 'cases', cat: 'matrices', display: true, tex: String.raw`f(x)=\begin{cases}x^2 & x\ge0\\-x & x<0\end{cases}`, typ: 'f(x) = cases(x^2 & x >= 0, -x & x < 0)' },
  { id: 'rcases', cat: 'matrices', display: true, tex: String.raw`\begin{rcases}a & x>0\\b & x<0\end{rcases} \Rightarrow c`, typ: 'cases(reverse: #true, a & x>0, b & x<0) => c' },

  // ---- alignment
  { id: 'aligned', cat: 'alignment', display: true, tex: String.raw`\begin{aligned}(a+b)^2&=(a+b)(a+b)\\&=a^2+2ab+b^2\end{aligned}`, typ: '(a+b)^2 &= (a+b)(a+b) \\ &= a^2 + 2a b + b^2' },
  { id: 'gathered', cat: 'alignment', display: true, tex: String.raw`\begin{gathered}a=b+c\\ d=e\end{gathered}`, typ: 'a = b + c \\ d = e' },
  { id: 'alignat', cat: 'alignment', display: true, tex: String.raw`\begin{alignedat}{2}10&x+&3&y=2\\3&x+&13&y=4\end{alignedat}`, typ: '10 & x + & 3 & y = 2 \\ 3 & x + & 13 & y = 4' },
  { id: 'tag', cat: 'alignment', display: true, tex: String.raw`E=mc^2 \tag{1}`, typMarkup: true, typ: '#set math.equation(numbering: "(1)")\n$ E = m c^2 $' },

  // ---- accents
  { id: 'accents', cat: 'accents', tex: String.raw`\hat{x}\,\tilde{y}\,\bar{z}\,\vec{v}\,\dot{a}\,\ddot{b}\,\check{c}\,\breve{d}\,\mathring{A}`, typ: 'hat(x) thin tilde(y) thin macron(z) thin arrow(v) thin dot(a) thin dot.double(b) thin caron(c) thin breve(d) thin circle(A)' },
  { id: 'wide-accents', cat: 'accents', tex: String.raw`\widehat{abc}\ \widetilde{xyz}\ \overrightarrow{AB}\ \overleftrightarrow{CD}`, typ: 'hat(a b c) space tilde(x y z) space arrow(A B) space accent(C D, arrow.l.r)' },
  { id: 'over-under-line', cat: 'accents', tex: String.raw`\overline{AB}\ \underline{CD}`, typ: 'overline(A B) space underline(C D)' },
  { id: 'braces', cat: 'accents', display: true, tex: String.raw`\overbrace{a+\cdots+a}^{n}\ \underbrace{1+2+\cdots+100}_{5050}`, typ: 'overbrace(a+dots.c+a, n) space underbrace(1+2+dots.c+100, 5050)' },
  { id: 'overset', cat: 'accents', tex: String.raw`a \overset{\text{def}}{=} b \stackrel{?}{\le} c`, typ: 'a attach(limits(=), t: "def") b attach(limits(<=), t: ?) c' },
  { id: 'dddot', cat: 'accents', tex: String.raw`\dddot{x}`, typ: 'dot.triple(x)' },

  // ---- fonts / alphabets
  { id: 'bb', cat: 'fonts', tex: String.raw`\mathbb{R}\,\mathbb{N}\,\mathbb{Z}\,\mathbb{1}`, typ: 'RR thin NN thin ZZ thin bb(1)' },
  { id: 'cal-scr-frak', cat: 'fonts', tex: String.raw`\mathcal{L}\,\mathscr{F}\,\mathfrak{g}`, typ: 'cal(L) thin scr(F) thin frak(g)' },
  { id: 'bold-sym', cat: 'fonts', tex: String.raw`\mathbf{x}\cdot\boldsymbol{\alpha}`, typ: 'bold(x) dot bold(alpha)' },
  { id: 'font-variants', cat: 'fonts', tex: String.raw`\mathrm{d}\,\mathit{x}\,\mathsf{A}\,\mathtt{B}`, typ: 'upright(d) thin italic(x) thin sans(A) thin mono(B)' },
  { id: 'text-in-math', cat: 'fonts', tex: String.raw`x = 1 \text{ if } y > 0 \text{ and } \textbf{bold}`, typ: 'x = 1 "if" y > 0 "and" #strong[bold]' },
  { id: 'operatorname', cat: 'fonts', display: true, tex: String.raw`\operatorname*{argmax}_x f(x) + \operatorname{tr}(A)`, typ: 'op("argmax", limits: #true)_x f(x) + op("tr")(A)' },

  // ---- symbols
  { id: 'greek', cat: 'symbols', tex: String.raw`\alpha\beta\gamma\Gamma\varepsilon\vartheta\varphi\Omega`, typ: 'alpha beta gamma Gamma epsilon.alt theta.alt phi Omega' },
  { id: 'misc-symbols', cat: 'symbols', tex: String.raw`\nabla\,\partial\,\infty\,\aleph_0\,\hbar\,\ell\,\Re\,\wp`, typ: 'nabla thin partial thin infinity thin aleph_0 thin planck thin ell thin Re thin pee' },
  { id: 'arrows', cat: 'symbols', tex: String.raw`A \Rightarrow B \iff C \leftarrow D \mapsto E \hookrightarrow F \leadsto G`, typ: 'A => B <=> C <- D |-> E arrow.r.hook F arrow.r.squiggly G' },
  { id: 'relations', cat: 'symbols', tex: String.raw`a \leq b \neq c \approx d \equiv e \pmod{n}`, typ: 'a <= b != c approx d equiv e (mod n)' },
  { id: 'sets', cat: 'symbols', tex: String.raw`A \subseteq B \supsetneq C,\ x \in A \setminus B,\ y\notin A \cup B \cap \emptyset`, typ: 'A subset.eq B supset.neq C, space x in A without B, space y in.not A union B inter emptyset' },
  { id: 'logic', cat: 'symbols', tex: String.raw`\forall x\,\exists y\ \neg(p\land q)\lor r \vdash s \models t`, typ: 'forall x thin exists y space not(p and q) or r tack.r s models t' },
  { id: 'negations', cat: 'symbols', tex: String.raw`a \not\equiv b,\ c \nleq d,\ e \nsubseteq f`, typ: 'a equiv.not b, space c lt.eq.not d, space e subset.eq.not f' },
  { id: 'xarrow', cat: 'symbols', tex: String.raw`A \xrightarrow[\text{under}]{\text{over}} B \xleftarrow{f} C`, typ: 'A stretch(->)^"over"_"under" B stretch(<-)^f C' },

  // ---- spacing & layout
  { id: 'spacing', cat: 'layout', tex: String.raw`a\,b\:c\;d\quad e\qquad f\!g`, typ: 'a thin b med c thick d quad e wide f #h(-1em/6) g' },
  { id: 'phantom', cat: 'layout', tex: String.raw`a + \phantom{xyz} + b`, typ: 'a + #hide[$x y z$] + b' },
  { id: 'displaystyle', cat: 'layout', tex: String.raw`\displaystyle\sum_{i=1}^n \textstyle\sum_{i=1}^n \scriptstyle x`, typ: 'display(sum_(i=1)^n) inline(sum_(i=1)^n) script(x)' },
  { id: 'cancel', cat: 'layout', tex: String.raw`\cancel{x}+\bcancel{y}+\xcancel{z}`, typ: 'cancel(x) + cancel(inverted: #true, y) + cancel(cross: #true, z)' },
  { id: 'boxed', cat: 'layout', tex: String.raw`\boxed{E=mc^2}`, typ: '#box(stroke: 0.5pt, inset: 3pt, $E=m c^2$)' },
  { id: 'color', cat: 'layout', tex: String.raw`\color{red}{x}+\textcolor{blue}{y}+\colorbox{yellow}{$z$}`, typ: '#text(fill: red, $x$) + #text(fill: blue, $y$) + #box(fill: yellow, $z$)' },
  { id: 'clap', cat: 'layout', display: true, tex: String.raw`\sum_{\mathclap{1\le i\le j\le n}} x_{ij}`, typ: 'sum_(1<=i<=j<=n) x_(i j)' },

  // ---- physics / realistic display equations
  { id: 'maxwell', cat: 'realistic', display: true, tex: String.raw`\nabla \times \vec{E} = -\frac{\partial \vec{B}}{\partial t}`, typ: 'nabla times arrow(E) = -(partial arrow(B))/(partial t)' },
  { id: 'taylor', cat: 'realistic', display: true, tex: String.raw`f(x)=\sum_{n=0}^\infty\frac{f^{(n)}(a)}{n!}(x-a)^n`, typ: 'f(x) = sum_(n=0)^infinity (f^((n))(a))/(n!) (x-a)^n' },
  { id: 'schrodinger', cat: 'realistic', display: true, tex: String.raw`i\hbar\frac{\partial}{\partial t}\Psi(\mathbf{r},t) = \left[-\frac{\hbar^2}{2m}\nabla^2 + V(\mathbf{r},t)\right]\Psi(\mathbf{r},t)`, typ: 'i planck partial/(partial t) Psi(bold(r),t) = [-planck^2/(2m) nabla^2 + V(bold(r),t)] Psi(bold(r),t)' },
  { id: 'fourier', cat: 'realistic', display: true, tex: String.raw`\hat{f}(\xi) = \int_{-\infty}^{\infty} f(x)\, e^{-2\pi i x \xi}\,dx`, typ: 'hat(f)(xi) = integral_(-infinity)^infinity f(x) e^(-2 pi i x xi) dif x' },
  { id: 'bayes', cat: 'realistic', display: true, tex: String.raw`P(A\mid B)=\frac{P(B\mid A)\,P(A)}{P(B)}`, typ: 'P(A mid(|) B) = (P(B mid(|) A) P(A))/P(B)' },
  { id: 'einstein', cat: 'realistic', display: true, tex: String.raw`R_{\mu\nu}-\tfrac{1}{2}Rg_{\mu\nu}+\Lambda g_{\mu\nu}=\frac{8\pi G}{c^4}T_{\mu\nu}`, typ: 'R_(mu nu) - inline(1/2) R g_(mu nu) + Lambda g_(mu nu) = (8 pi G)/c^4 T_(mu nu)' },
  { id: 'stirling', cat: 'realistic', display: true, tex: String.raw`n! \sim \sqrt{2\pi n}\left(\frac{n}{e}\right)^n`, typ: 'n! tilde.op sqrt(2 pi n) (n/e)^n' },

  // ---- ecosystem / extensions
  { id: 'cd', cat: 'extensions', display: true, tex: String.raw`\begin{CD} A @>f>> B \\ @VgVV @VVhV \\ C @>>k> D \end{CD}`, typ: 'mat(delim: #none, A, stretch(->)^f, B; stretch(arrow.b) g, , stretch(arrow.b) h; C, stretch(->)_k, D)', note: 'Typst: hand-built approximation; real CD needs the fletcher package' },
  { id: 'mhchem', cat: 'extensions', tex: String.raw`\ce{2H2 + O2 -> 2H2O}`, typ: '2"H"_2 + "O"_2 -> 2"H"_2"O"', note: 'KaTeX: mhchem contrib extension; Typst: hand-written (typsium/whalogen packages exist)' },
  { id: 'macros', cat: 'extensions', tex: String.raw`\newcommand{\RR}{\mathbb{R}} f: \RR^n \to \RR`, typMarkup: true, typ: '#let Real = $bb(R)$\n$f: Real^n -> Real$' },
  { id: 'href', cat: 'extensions', tex: String.raw`\href{https://typst.app}{x^2}`, typ: '#link("https://typst.app", $x^2$)', texOpts: { trust: true } },

  // ---- typst-only programmability (no KaTeX counterpart)
  { id: 'loop-matrix', cat: 'typst-only', display: true, typMarkup: true, tex: null, typ: '#let m = range(1, 5).map(i => range(1, 5).map(j => $a_(#i #j)$))\n$ mat(..#m) $', note: 'Matrix generated by a loop' },
  { id: 'computed', cat: 'typst-only', typMarkup: true, tex: null, typ: '#let fib(n) = if n < 2 { n } else { fib(n - 1) + fib(n - 2) }\n$F_20 = #fib(20)$', note: 'Value computed at compile time' },
  { id: 'show-rule', cat: 'typst-only', typMarkup: true, tex: null, typ: '#show math.equation: set text(fill: blue)\n#show "x": $xi$\n$x + y$', note: 'Show/set rules restyle math' },
  { id: 'math-font', cat: 'typst-only', typMarkup: true, tex: null, typ: '#show math.equation: set text(font: "Cambria Math")\n$sum_(i=1)^n x_i^2$', note: 'Switch OpenType math font' },
];
