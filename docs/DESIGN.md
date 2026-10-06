# Typlet design

Typlet renders Typst math in the browser and in Node, the way KaTeX renders LaTeX: one small JavaScript file plus split web fonts, a synchronous API, and no WASM or compiler. This document explains how it works and why. [CONTRIBUTING.md](../CONTRIBUTING.md) has the commands and the repository layout, and [UPSTREAM.md](UPSTREAM.md) maps each module to the Typst source it ports.

## 1. Goals and limits

**Goals.**
- **Drop-in like KaTeX:** `render(src, element)`, `renderToString(src)`, auto-render, Markdown plugins, and server-side rendering in Node.
- **Typst's syntax and semantics** for a published subset, with Typst's error messages.
- **The embedded code formulas actually use:** values, styling functions, `#let` definitions and math `set` rules, safe for untrusted input (§6).
- **Typst's layout,** checked against the real compiler rather than by eye (§5).
- **Good output:** accessible, selectable, themeable, with no global styles (§2).

**Not goals.**
- Documents, packages, show rules, introspection and file access (§6.3).
- Pixel-identical output in every case.
- LaTeX input.
- Raster output such as PNG.

Real-world formulas use core syntax. In a sample of 30,000 formulas converted to Typst from LaTeX datasets, 11% contain `#`, and the only identifiers after it are `none`, `left` and `right`. The most used functions are `bold`, `upright`, `dot`, `attach`, `cal`, `mat`, `hat`, `sqrt`, `tilde` and `lr`, all from the `math` module.

## 2. Outputs

Typlet processes each formula once, through parsing, evaluation and the math IR, and emits its outputs from that IR. The MathML backend reads the IR directly. The layout engine turns the IR into a frame of positioned glyphs and rules, and the HTML backend draws that frame.

The modes follow KaTeX's `output` option:

| `output` | Visual rendering | Screen readers get | Same in every browser | Needs `typlet.css` and fonts | Best for |
|---|---|---|---|---|---|
| `htmlAndMathml` (default) | HTML laid out by Typlet | MathML | Yes | Yes | Websites, documentation, chat |
| `html` | HTML laid out by Typlet | An `aria-label` with the source | Yes | Yes | Pages that need fewer bytes |
| `mathml` | MathML laid out by the browser | MathML | No | Recommended | EPUB, MathML tools, the smallest pages |

All outputs share these properties:
- **Colors follow the text.** Glyphs and rules use `currentColor`, so formulas work in dark mode. Explicit colors such as `text(fill: …)` are kept.
- **No global CSS.** Every rule in `typlet.css` is scoped under `.typlet`.
- **The source is kept.** It travels in a MathML `<annotation encoding="application/x-typst">` or an `aria-label`. The copy-typst extension puts it on the clipboard.
- **Errors can render in place.** With `throwOnError: false`, the source is shown in `errorColor` with the message as a tooltip, as in KaTeX.
- **Input never reaches the output as raw markup.** All text is escaped, and `link` needs `trust` ([SECURITY.md](../SECURITY.md)).

### 2.1 `htmlAndMathml` (default)

This is KaTeX's layout: one `<span class="typlet">` with two children. Screen readers get the MathML, which is visually hidden. The visual HTML is marked `aria-hidden`.

```html
<!-- The output for x^2, indented. The 2 is a script-size glyph at a private code point. -->
<span class="typlet">
  <span class="typlet-mathml">
    <math><semantics>
      <msup><mi>𝑥</mi><mn>2</mn></msup>
      <annotation encoding="application/x-typst">x^2</annotation>
    </semantics></math>
  </span>
  <span class="typlet-html" aria-hidden="true">
    <span class="f" style="width:1.0263em;height:0.683em;vertical-align:0em">
      <span class="g" style="left:0em;top:-0.317em">𝑥</span>
      <span class="g" style="font-size:0.7em;left:0.8171em;top:-0.5429em">&#xE13A;</span>
    </span>
  </span>
</span>
```

How the visual part is built:
- **Typst's layout rules and font.** Typlet's layout, a port of `typst-layout/src/math`, places every glyph and rule using New Computer Modern Math's metrics. These are the font and rules Typst uses for its PDF output. The result does not depend on the browser's MathML support.
- **One inline-block per piece,** sized by the layout. A display formula is one piece, and an inline formula is split into pieces where lines may break. Each piece is lowered by its descent with `vertical-align`, so it sits on the text baseline.
- **Absolutely positioned glyphs.** Each glyph is a span positioned in `em`. Browsers round the font's ascent to whole pixels, so a span's `::before` is a strut 1em tall that puts its baseline exactly 1em below its top. Adjacent glyphs merge into one text run when their positions equal the accumulated advances, with the browser's kerning and ligatures turned off.
- **Stretched glyphs.** Large delimiters, radicals and wide accents use size variants and glyph assemblies, which the font pipeline maps to private code points (§4).
- **Rules and strokes.** Fraction bars, radical overbars, matrix lines and the diagonal strokes of `cancel` are spans with a `currentColor` background, rotated where needed.
- **Wrapping.** Inline formulas are split where Typst allows line breaks, after binary operators and relations. The space after the operator is its piece's right margin, as in KaTeX, so it stays at the end of a line and never indents the next one. Typst drops that space where a line breaks, so a line can break one piece earlier than Typst would.
- **No wait for fonts.** The metrics are in the JavaScript, so positions are correct before the woff2 files arrive.

What the HTML can't draw yet, such as a character New Computer Modern Math lacks or raw text in a monospace font, is drawn as MathML with a warning, never drawn wrong.

### 2.2 `html`

This mode emits the visual part alone, with `role="img"` and an `aria-label` that holds the Typst source. It saves the MathML, about 0.4 KB per formula.

### 2.3 `mathml`

This mode emits MathML Core only, and the browser lays it out.

- **The markup follows Typst's own MathML export** (`typst-html/src/mathml.rs`), so it can be tested against Typst directly: styled letters are Unicode math alphanumerics, such as `𝑥`; `lspace` and `rspace` are set where Typst's spacing differs from the browser default; `mtable` classes mark `cases` and aligned equations.
- **Typlet keeps decorations that Typst's export drops:** color, `cancel` (as `<menclose>`), `overline` and `underline`, box borders and fills, and `hide` (as `<mphantom>`). They are on when rendering, and off when comparing with Typst's export.
- **It is the smallest and fastest mode.** The `typlet/mathml` entry point leaves out the layout engine and the metrics.
- **Its limits come from the browser:** each browser lays out MathML differently; stretchy delimiters need a math font on the page, which `typlet.css` provides along with workarounds for known browser quirks; and inline formulas cannot wrap.

### 2.4 Planned: `svg`

One standalone SVG per formula, built from the same layout as the HTML, with glyphs as outline paths. It would need no fonts or CSS, use `fill="currentColor"`, and carry `role="img"` with a `<title>` holding the source.

### 2.5 Programmatic results

`parse(src)` returns the syntax tree, with typst-syntax's kinds and spans, for editors and linters. A `layout(src)` that returns the frame of positioned glyphs and rules is planned.

## 3. Pipeline

Typlet mirrors Typst's math pipeline module by module:

```text
source
  → syntax   lexer, parser → syntax tree with typst-syntax's kinds and spans
  → eval     math evaluation and embedded code (§6) → tree of math elements
  → ir       resolve, process → MathItem tree (classes, spacing, alignment rows)
  ├→ mathml  MathItem → MathML Core                        (§2.3)
  └→ layout  MathItem → frame (positioned glyphs, rules)
       └→ html                                             (§2.1, §2.2)
```

Typst resolves an equation into an IR of `MathItem`s (Group, Fenced, Fraction, Scripts, Table, Accent, Glyph and others) in `typst-library/src/math/ir`, and both of its backends consume it: `typst-layout/src/math` for paged output and `typst-html/src/mathml.rs` for MathML. Typlet ports each of these files, and [UPSTREAM.md](UPSTREAM.md) records which file each module ports and the version it was last synced with.

Two simplifications keep the port small:
- **Styles are Typst's, without show rules.** Each style property sets one field of one element, and a chain links lists of properties from the innermost outward, as in `styles.rs`. Show rules and revocations are left out (§6.3).
- **Content is plain data.** Math elements are nodes with typed fields, with no general element system.

**The runtime is TypeScript with no dependencies.** Compiling typst-syntax to WASM was considered and rejected: it would bring back a WASM download, async initialization and `'wasm-unsafe-eval'` under a strict Content Security Policy; typst-syntax alone weighs about 112 KB brotli as WASM; and it would only reuse the parser, which is the cheap part, since resolution and layout depend on typst-library's `Engine`, `StyleChain` and `Content` and must be rewritten in any language. Everything that changes as data is generated from the Rust crates at build time instead (`npm run codegen`): symbols, alphanumeric styling, math classes, the MathML operator dictionary, and the names and signatures of Typst's scopes.

## 4. Fonts

HTML can only address characters, but OpenType MATH size variants and assembly parts are glyphs without code points. KaTeX solved this with purpose-built fonts. Typlet derives its fonts from New Computer Modern Math, Typst's default math font, in its Book weight (`NewCMMath-Book`), with a pipeline in `tools/fonts` that uses Python and fontTools (`npm run fonts`):

1. **Subset** to the supported characters and the variation sequences `cal` and `scr` produce, plus every MATH variant, assembly part, `ssty` and `dtls` form reachable from them.
2. **Remap** those unencoded glyphs to Private Use Area code points.
3. **Normalize the vertical metrics.** Set the hhea, typo and win metrics to the same values and turn on `USE_TYPO_METRICS`, so every browser places the baseline at the same offset. The HTML output's positioning depends on this.
4. **Split** into woff2 files with `unicode-range`, so a page downloads only what it uses: a file per math alphabet style, a `main` file with the characters most formulas use, and files for the rest of each Unicode block.
5. **Convert the outlines** from CFF to unhinted TrueType curves, within one font unit. In woff2 they are a third smaller. Typst's own output is unhinted too.
6. **Generate the metrics module** (`tools/codegen/metrics.mjs`). It holds the MATH constants and, per glyph: advance and bounds, italic correction and top accent attachment, math kerning, variants and assemblies, and how shaping with `ssty` and `dtls` maps characters to glyphs. The core module covers the math blocks and every symbol's characters; rarer scripts, such as Devanagari, are in a separate module.
7. **Generate `typlet.css`** with the `@font-face` rules and base styles, including Typst's styles for MathML.

The metrics are generated from the oracle's dump of the font as Typst reads it, through ttf-parser and rustybuzz, and the tests check them against it. Text runs such as `"if"` or `argmax` use the extracted advances and kerning pairs, and the browser shapes them. Bold text needs New Computer Modern Math Bold, so the pipeline adds a small Latin subset of it, declared with `font-weight: bold`, which browsers load only when a page shows bold text.

The font is under the GUST Font License, which allows modification and redistribution and asks that derived fonts be renamed. The fonts therefore ship as "Typlet NewCM Math", with the license and a manifest.

`npm run test:browsers` checks the result in Chromium, Firefox and WebKit: a glyph, a script-size alternate, a size variant, the parts of an assembly, a wide accent and a display operator, each placed from the metrics, must draw within a pixel of their predicted ink.

## 5. Testing against Typst

### 5.1 The oracle

`oracle/` is a native Rust CLI on the typst crates from crates.io, pinned to one Typst version, so the fixtures reflect official Typst and one compiler produces all of them. It reads formulas and expressions as JSON Lines and writes, for each one:

| Output | Content | Tests |
|---|---|---|
| `cst` | typst-syntax tree: kinds and spans | Parser |
| `content` | The evaluated equation, as Typst serializes it | Eval |
| `mathml` | typst-html output | IR, MathML |
| `frame` | Glyphs (font, glyph ID, x, y, size, fill) and shapes, relative to the formula's box | Layout |
| `svg` | typst-svg output | Visual diffs |
| `diagnostics` | Errors and warnings, with spans in the formula or its preamble | Error messages |
| `value` | For expressions: type, `repr` and exact numbers | Code values |

It also splits documents into formulas, dumps the codex symbols, and dumps the math font as Typst reads it (§4). Content trees use the technique of wrapping each formula in `#metadata($…$)` and reading the evaluated content back as JSON. Formulas can carry a preamble, for set rules and definitions (§6.3). [oracle/README.md](../oracle/README.md) documents the formats.

Fixtures are committed per Typst version under `test/fixtures/typst-0.15.1/`, so the Node test suite uses them without compiling Typst. CI builds the oracle for Rust unit tests, visual comparisons and differential fuzzing. The Oracle workflow regenerates the corpus, fixtures and generated data to check that they are current.

### 5.2 The corpus

| Source | Use |
|---|---|
| A paired corpus of 81 formulas, each written in Typst and in LaTeX for KaTeX | Headline coverage; benchmarks against KaTeX |
| Examples in Typst's math docs | Per-function behavior, including set rules and `#let` |
| Every variant of every Typst symbol | The symbol table and font coverage |
| Formulas for each feature and each code level, and generated code expressions | Embedded code (§6.8) |

[test/corpus/README.md](../test/corpus/README.md) describes the files. Larger label sets can be sampled locally with `npm run corpus -- --labels FILE`; they mix datasets with different licenses, so they stay out of the repository.

### 5.3 What is compared

| Layer | Compared with | Passes when |
|---|---|---|
| Syntax | Oracle `cst` | Kinds and spans are identical |
| Code values | Oracle `value` | Same `repr`, or the same error |
| Eval | Oracle `content` | Identical after normalization |
| IR, MathML | Oracle `mathml` | Identical after normalization |
| Metrics | Oracle font dump | Identical |
| Layout | Oracle `frame` | Same glyphs, positions within the fixtures' rounding |
| Visual | Oracle `svg`, in Chromium, Firefox and WebKit | At most a small share of either's ink lacks a match within a pixel |
| Errors | Oracle `diagnostics` | Typst's message for Typst errors; `unsupported` for code outside Levels 1–3 |
| Budgets | Adversarial inputs | A `limit` error within 50 ms (§6.6) |

Two differential fuzzers look for what the corpus misses. `npm run fuzz` compares the parser with typst-syntax on random input in math, code and markup, most of it exercising error recovery. `npm run fuzz:eval` renders random formulas of Levels 1 to 3, with and without preambles, and compares MathML, diagnostics and frames with Typst's. CI runs both with a new seed on every run, and `--replay FILE` checks a failure report's formulas again.

The visual test (`npm run test:visual`) draws each formula Typlet lays out as Typst's SVG and as Typlet's HTML at 32 px per em, and compares their ink. It also wraps a long inline formula at every paragraph width from 40 to 640 px. Linux hints fonts and Windows doesn't, which changes Typlet's text but not Typst's outlines, so on Linux the test turns hinting off in Chromium (`--font-render-hinting=none`) and Firefox (`test/browsers/no-hinting.conf`), and allows WebKit, which ignores both, a larger difference.

## 6. Embedded code

Embedded code is Typst code inside a formula or in the document around it: `#` expressions, the code semantics of math-call arguments, content blocks, and statements such as `#let` and `#set`. This section defines what Typlet evaluates, how, and under which limits.

### 6.1 Where code appears

| Where | Example | Notes |
|---|---|---|
| `#` expressions in math | `#none`, `#h(-1em/6)`, `#box(stroke: 0.5pt, $x$)`, `#sym.arrow.r` | Switch to code mode for one expression |
| Arguments of math calls | `mat(delim: "[", augment: #2, ..rows)` | Named arguments, spreads and `;` rows behave like code, even without `#` |
| Content blocks | `#strong[bold]`, `#hide[$x y z$]` | Switch from code to markup, which can contain equations again |
| Statements | `#let norm(x) = $lr(\|\| #x \|\|)$`, `#set math.mat(delim: "[")` | Inside a formula, or in the document around it (the preamble, §6.3) |

### 6.2 How Typst evaluates it

These rules come from typst-syntax's parser and typst-eval, and Typlet's evaluator reproduces them:
- **`#` takes one atomic expression:** a literal, identifier, parenthesized expression, block or statement, plus directly attached calls and field accesses. Operators need parentheses, as in `#(a + b)`. `#-x` is an error, with a hint to add parentheses.
- **Named arguments keep their type only when they are a single expression.** `augment: #2` passes an integer. `augment: 2` passes content, which then fails to cast. Strings stay strings: `delim: "["`.
- **Math calls on non-functions don't fail.** If `alpha` is not a function, `alpha(x)` displays as α followed by the arguments in parentheses. Symbols such as `hat` and `floor` are callable, as accents and delimiters.
- **Every value is displayed as content:** `none` becomes nothing; integers, floats and strings become text; symbols become the symbol; content stays itself; anything else, such as `#true` or `#1em`, becomes monospace code text.
- **Names are looked up in two scopes.** A bare identifier in math looks in local bindings, then in the math scope: the `math` module and all symbols. An identifier after `#` looks in local bindings, then in the standard library. User definitions therefore work as math identifiers: after `#let Real = $bb(R)$`, writing `Real` in math works.
- **Single letters are never looked up.** Identifiers in math need at least two characters. After `#let x = 5`, `$x$` still shows x, and `$#x$` shows 5.
- **Limits:** calls nest at most 80 deep, and the parser nests at most 256 deep.

### 6.3 Levels

Typlet supports code in levels. It refuses everything else with a clear error.

**Level 1, values.**
- Literals: `none`, `auto`, booleans, integers, floats, lengths (`pt`, `mm`, `cm`, `in`, `em`), angles, ratios and strings.
- Parenthesized expressions with Typst's operators for these types, such as `-1em/6` and `50% + 1em`.
- Arrays and dictionaries, and spreading them into math calls: `mat(..#rows)`.
- Standard-library constants: alignments such as `left`, `top` and `left + top`, and named colors, plus `rgb` and `luma`.
- Field access on modules: `#sym.arrow.r`, `#math.frac`.
- Calls from code to the `math` module and to `h`: `#math.frac(1, 2)`, `#h(-1em/6)`.
- Casting arguments to parameter types, with Typst's error messages, such as "expected integer, found content".

**Level 2, content and styling.**
- Content blocks with a markup subset: text, `*strong*`, `_emph_`, escapes, shorthands, smart quotes, raw text, labels, nested `$…$` and `#` expressions.
- Equations as code values: `#$x$`.
- Functions: `box` (width, height, baseline, fill, stroke, radius, inset, outset); `text` (fill, size, weight, style, tracking, spacing and baseline, and the language and region, which choose the quotes); `strong`, `emph` and `highlight`; `hide`; and `link`, only when `trust` allows it.
- Strokes, such as `0.5pt + red` and stroke dictionaries.

**Level 3, definitions and settings.**
- `#let` for values and functions, with positional and named parameters and defaults, plus arrow closures. Functions defined this way work in math: `norm(x)`.
- `if`/`else` expressions and code blocks `#{ … }`. Recursion is allowed within the budgets (§6.6).
- `set` rules for math elements and text: `#set math.mat(delim: "[")`, and likewise for `math.vec` and `math.cases`; `#set math.equation(numbering: "(1)")`; `#set text(fill: blue, size: 1.2em)`. As in Typst, a set rule in a formula goes in a content or code block, such as `#[#set text(fill: red); $x$]`, and styles the rest of the block. Directly in math, it is an error.
- **The `preamble` option:** Typst code with `let` and `set` statements, evaluated once. Its definitions and settings apply to every formula rendered with the same options. It replaces KaTeX's `macros`.
- **Equation numbers** come from a counter that the caller controls. Auto-render numbers a page's equations in order.

**Level 4, collections and loops (planned, if users ask).** `for` and `while` loops, `range`, and methods on arrays, dictionaries and strings, such as `map`, `join`, `at` and `len`, under the same budgets.

**Never supported.**
- **`show` rules.** They rewrite content during layout and need Typst's realization engine. The two common uses map to options instead: an equation color maps to CSS `color`, and a math font would map to a font option.
- **Introspection:** `context`, `state`, `counter`, `query`, `locate`, `measure` and `here`. These need multi-pass document layout.
- **I/O and nondeterminism:** `import`, `include`, packages, `read`, data loaders such as `json` and `csv`, `plugin`, `eval`, `sys.inputs` and `datetime.today`.
- **Document elements:** `heading`, `figure`, `ref`, `footnote`, `page`, `grid`, `table`, `place` and `block`.

### 6.4 Coverage

Level 1 alone covers the sampled real-world formulas, whose code is `#none`, `#left` and `#right`. Of the paired corpus's 81 formulas, 19 use code, and Levels 1 to 3 render 78 of the 81; the other 3 use a loop (Level 4) and show rules.

### 6.5 How the evaluator works

The evaluator ports typst-eval's structure for the supported subset: code, calls, operators, math, markup, set rules, bindings and control flow.
- **Values** mirror Typst's types: none, auto, bool, int, float, length, angle, ratio, relative length, color, string, content, array, dictionary, symbol, function, alignment, stroke and module. Integers are exact up to ±2^53. Beyond that, Typlet raises an error where Typst would still compute.
- **Operators** port the rules of typst-library's `ops.rs` for these types, including the error messages, such as "cannot add length and string".
- **Builtins** are declared once, as signatures in a registry: positional and named parameters, types, defaults and variadic parameters. Argument checking and casting work the same way for every function, and the [list of supported features](supported.md) is generated from the registry.
- **Content** from builtins is Typst's elements. For layout, `strong`, `emph`, `highlight`, `link` and `hide` become styles, as their show rules make them in Typst's paged output. For MathML, they become `<strong>`, `<em>`, `<mark>` and `<a>`, as in Typst's HTML export. A `box` is laid out on its own and placed as one item.
- **Set rules** add style properties to the chain (§3). In a block, they style the rest of the block. In the preamble, they style every formula, with the equation's own show-set rule inside them, as in a document.
- **Closures** capture their defining scope by value, as in Typst. Calls check argument counts and names the way Typst does.
- **Equations inside content blocks** follow Typst's resolver. Text-styled equations merge into the surrounding math, and boxes are laid out separately and placed as one item.

### 6.6 Budgets for untrusted input

Formulas from chat, comments or shared links are untrusted. Levels 1 and 2 always terminate, since they have no loops or user functions. Level 3 adds recursion, so the evaluator runs under budgets:

| Budget | Default | Why |
|---|---|---|
| Call depth | 80 | Typst's own limit, with Typst's error message |
| Parser nesting | 256 | Typst's own limit |
| Function calls | 30,000 per formula | Bounds recursion: an exponential recursion stops within about 30 ms |
| Collection size | 10,000 items; 100,000 characters per string | Stops repetition such as `"x" * 100000000`, and doubling with `+` |
| Content elements | 10,000 per formula | Stops content that doubles, such as a chain of `#let x1 = [#x0 #x0]` |
| Sizes of spacing, boxes and text | 1,000 em | Stops `#h(1e9pt)` and `#text(size: 1e6pt)` |
| Output size | 1 MB per formula | A last line of defense |

Typst has no budget on calls. Computation that Typst would finish slowly fails in Typlet with a `limit` error. Each budget can be changed through options: `maxCalls`, `maxCollectionSize`, `maxStringLength`, `maxElements`, `maxSize` and `maxOutputSize`.

### 6.7 Errors and fallback

- **Supported constructs fail like Typst.** Unknown variables, failed casts, unknown fields, and missing or unexpected arguments produce Typst's messages and hints. For example, `foo` in math gives "unknown variable: foo", with Typst's hint to add spaces or quotes.
- **Unsupported constructs are refused, not misrendered.** They raise a `TypletError` of kind `unsupported` that names the construct at its source span, such as "Typlet does not support `show` rules".
- **A `fallback(source, error)` option** receives refused formulas and returns markup, or a promise of markup. `render` shows the source until a promise resolves, so an application can load the full Typst compiler only when it needs it.
- **The HTML output refuses what it can't draw yet,** and draws those formulas as MathML with a warning (§2.1).
- **Budget errors have the kind `limit`,** so callers can tell abuse apart from unsupported features.

### 6.8 Testing

- **Values:** Typlet's `repr` of an expression is compared with Typst's. A generator produces thousands of expressions over literals and operators, including invalid ones, whose error messages must match too.
- **Formulas with code:** content trees, MathML, frames and diagnostics, as for any formula (§5.3).
- **Preambles and set rules:** the oracle compiles the preamble and the formula together.
- **Budgets:** adversarial inputs (`test/budget-cases.mjs`), such as deep nesting, recursion bombs and huge repetition, must fail with a `limit` error within 50 ms.

## 7. Size and startup

**Size budgets.** CI checks the brotli size of each entry point against `scripts/size-budgets.json`: 120 KB for the full browser bundle and 70 KB for `typlet/mathml`, which leaves out the layout and metrics. KaTeX's script is about 61 KB, plus its CSS. Typlet's extra size is mostly the parser for all of Typst's syntax, Typst's error messages, embedded code and the font metrics.

**Compact metrics.** The metrics of the 7,500 glyphs Typst reaches are columns of characters, decoded as glyphs are used: numbers are two base-92 digits per glyph, read where they are, and the tables few glyphs have are comma-separated fields, found by skipping from the nearest of a column's steps. Nothing is decoded at import.

**Compiling with the script.** A page's first formula calls several hundred functions, and V8 compiles each when it is first called, which took most of that formula's time. V8 compiles a function expression in parentheses while it compiles the script, so the build marks the functions typical formulas call: `scripts/build.mjs` bundles each entry point once unminified, renders the formulas of `scripts/lib/typical-formulas.mjs` with it in a separate process, asks V8's coverage which functions they called (`scripts/lib/profile-formulas.mjs`), and puts those in parentheses (`scripts/lib/eager.mjs`) before minifying. The list of typical formulas stays short, since every marked function is compiled on every page. `npm run build -- --no-eager` builds without the marking, to compare. This moves compilation from the first formula into the import: in Node, the first formula takes about 4 ms, close to KaTeX's.

`bench/` measures speed against KaTeX in Node (`bench/bench.mjs`) and on the web (`bench/web.mjs`), and the documentation site's comparison page lets a reader time both in their own browser.

## 8. License

Typlet is MIT-licensed. Parts of it are ported from Typst and codex, which are Apache-2.0. Apache-2.0 allows a derivative work to be distributed under other terms, such as MIT, if its conditions are met (Apache-2.0 §4). Typlet meets them this way:
- **License text.** The repository and the npm package include `LICENSES/Apache-2.0.txt`.
- **Notices.** [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) credits each third-party work and its license.
- **Changed files are marked.** Every ported file starts with a header that names the upstream file and says the file was modified. `npm run check` rejects ported files without one (`scripts/check-headers.mjs`).
- **Bundles keep the notices.** The minified builds carry a license comment that points to `THIRD_PARTY_NOTICES.md`.

This is how projects commonly meet Apache-2.0's conditions. It is not legal advice.

## 9. Tracking Typst releases

Each Typlet minor version targets one Typst minor version. To upgrade:
1. Bump the oracle's typst crates (`oracle/Cargo.toml`).
2. Regenerate the fixtures (`npm run fixtures`). Their diff shows how Typst's behavior changed.
3. Regenerate the data (`npm run codegen`). Symbol renames and deprecations come from codex, and old names keep working with a warning, as in Typst.
4. Port the upstream diff of the files listed in [UPSTREAM.md](UPSTREAM.md).
