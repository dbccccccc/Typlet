# Changelog

What each release of Typlet changes. The versions follow [semantic versioning](https://semver.org/): while they start with 0, a minor release may change the API, and each Typlet version reproduces one Typst version. `rehype-typlet` and `markdown-it-typlet` are released with Typlet, under the same version.

## Unreleased

- `renderToResult()` returns the markup with what drew the formula (`drawnAs`: `html`, `mathml`, `fallback` or `error`), the warnings and the equation number. Warnings have a `kind`: `fallback`, `approximation`, `deprecation` or `other`.
- The `html` output falls back to MathML, with a warning, for a formula the HTML can't draw, as the default output does. It threw an `unsupported` error before.
- Raw code tagged as Typst (`typ`, `typc` or `typm`) in a formula is highlighted in time linear in its length. A chain of a few thousand field accesses overflowed the stack, with an error that escaped `throwOnError: false`, and wide code took seconds.
- Formulas whose structure would overflow the native stack, or take exponential work, stop with a `limit` error: a chain of thousands of operators, definitions that nest content thousands deep, a chain of thousands of attachments, a closure whose body is such a chain, a style that feeds an element its own body such as `#set box(box())`, values that share parts such as `(x, x)` built thirty times over, and `primes` with a huge count. Three internal limits do this, with no option: 1,024 nested expressions, counted across the function calls in progress, 256 levels of nesting after evaluation, and 100,000 steps comparing or showing values. A chain of thousands of `else if` branches, which typst-syntax parses by recursion, is parsed in a loop.
- Every length the HTML and the MathML carry is checked against `maxSize` as it is written, whatever computed it: a `vec` gap, a stroke, tracking or a baseline shift of a billion points stopped nowhere before. The parts of stretched glyphs, up to a thousand for one tall delimiter, have a budget the size of `maxElements`, so a chain of ever taller binomials stops in milliseconds rather than building megabytes; and a tall delimiter is assembled in a pass or two over its parts, rather than one pass per repetition of its extender.
- An empty array or string repeated a huge number of times is empty at once; `() * 9223372036854775807` looped that many times. A numbering pattern writing a huge number, such as a roman numeral of 10^16, stops at the string budget rather than failing with a `RangeError`.
- A callback during layout, such as a `cancel` line's `angle` function, runs within the formula's budgets, and its warnings are reported. It had budgets of its own, so `maxCalls` didn't apply to it.
- A warning is reported once per location and message, as Typst reports it: a function called several times warns once.
- The package and the documentation site carry the W3C Software and Document License of the MathML Core operator data that reaches Typlet through typst-assets, and the notices name the Bold face's version.
- `rehype-typlet` renders every formula when formulas stand right next to each other and one renders to nothing, and never renders the markup a `fallback` returned as formulas again.
- `markdown-it-typlet` numbers each document from 1 even when one environment object is reused across documents, and its declaration accepts markdown-it 15's class as well as markdown-it 14's.
- Copying puts literal text on the clipboard as text: a `<em>` written out on the page stayed a tag in the copied HTML. The plain text keeps the page's lines: one after a block or `<br>`, a blank one between paragraphs, and a tab between table cells; runs of whitespace in the markup collapse to a space, as browsers collapse them, so pretty-printed pages copy without blank lines and indentation. A numbered equation in the `html` output keeps its exact source for copying in a `data-typst-source` attribute.
- Over- and underlines take their constants from the Bold face when their base is a bold glyph, or when the equation is bold, as Typst does; they sat about a tenth of a point too high, and too thick, in `#strong[$overline(mid(|))$]`.
- Chinese, Japanese and Korean text is laid out as HTML, drawn with the browser's fonts at an em per character, with a warning of kind `approximation`; it fell back to MathML. Typst sets it in a font of the system's, which Typlet can't know, so the positions around it are exact and the characters themselves are the browser's. Combining marks among these characters, such as the voicing mark of `が` written as two characters, take no width of their own.
- `typlet --batch` renders JSON Lines in one process: each line in is an object with a `source`, an `id` and render options, and each line out is the result of `renderToResult`, or an error, written as the lines arrive, to standard output or to the `--output` file. Build scripts in any language can keep one `typlet` running and send it formulas as they go. A byte order mark before the first line is skipped, and a failure inside Typlet itself gives an error of kind `internal` for that line rather than ending the batch.
- `<typlet-math>` takes a `preamble` attribute, which replaces the preamble of `elementOptions` for that formula.
- `require('markdown-it-typlet')` from CommonJS, as Hexo loads the plugins its configuration names, gets the plugin itself on Node 22.12 and later.
- [contrib/typlet.typ](contrib/typlet.typ) is a helper for Typst's HTML export: `typlet-math` writes a formula as a `<typlet-math>` element in HTML export, with the source in an attribute so that the line breaks of a raw block survive, and as an equation on pages, and `typlet-assets` loads Typlet once, with a preamble for the document that applies on pages as well.
- The documentation gains recipes for VitePress, Docusaurus and Hexo, a generated page of what falls back to MathML or is refused and why ([docs/fallbacks.md](docs/fallbacks.md), from the test corpus), and a note on what is stable in `SyntaxKind`: the names, not the numbers.

## 0.1.1

A patch release. It reproduces Typst 0.15.1, like 0.1.0.

- Show-set rules for equations: `#show math.equation: set text(fill: blue)` and `#show math.equation.where(block: true): set …`, in the preamble and in content and code blocks, apply as in Typst. Other show rules are still refused.
- Text in Latin letters beyond Latin-1, such as `"Erdős"` or `"Việt"`, in ligature characters such as `ﬁ`, and in Arabic mathematical alphabetic symbols is laid out as HTML. The metrics of these characters were in a module that nothing loaded, so such formulas fell back to MathML. They are now part of the core metrics, which grows the browser bundle by about 3 KB brotli; Devanagari, which needs shaping, still falls back.
- The `typlet` command takes `--max-collection-size` and `--max-string-length`, the two budgets it lacked.
- The tests and the fuzzer compare warnings with Typst's regardless of their order, which Typst doesn't keep to the source's.

Of the 1,668 formulas of the test corpus that Typst renders, Typlet now lays out 1,500, draws 159 as MathML with a warning, and refuses 9.

## 0.1.0

The first public release. It reproduces Typst 0.15.1.

### What it has

- **Rendering.** `render` and `renderToString` draw Typst math as HTML laid out by a port of Typst's math layout, with MathML for screen readers. The `output` option picks `htmlAndMathml`, `html` or `mathml`, and the `typlet/mathml` entry point renders MathML alone, at about half the size.
- **Typst's syntax and errors.** The parser is a port of typst-syntax, and `parse` returns its syntax tree. An invalid formula throws a `TypletError` with Typst's message and hints, a span and a kind.
- **Embedded code.** Values, operators and calls; content blocks, `text`, `strong`, `emph`, `highlight`, `hide`, `box` and `link`; `#let` definitions and functions, conditionals and set rules; the `preamble` option; and numbered equations.
- **Options named after KaTeX's:** `displayMode`, `output`, `throwOnError`, `errorColor`, `strict` and `trust`, with `preamble`, `equationCounter`, `fallback` and budgets for untrusted input.
- **Fonts.** New Computer Modern Math as "Typlet NewCM Math", split into woff2 files that browsers load as a page's characters need them, with `typlet.css`.
- **Integrations.** Auto-render, copy as Typst, the `<typlet-math>` element, the `typlet` command, `rehype-typlet` and `markdown-it-typlet`.
- **Builds.** ES modules, CommonJS, a browser bundle with the global `typlet`, and type declarations for both module systems.

### How it was checked

- Of the 1,644 formulas of the test corpus that Typst renders, Typlet lays out 1,479, draws 158 as MathML with a warning, and refuses 7. The tests compare the frames it lays out with Typst's: all but three, which differ by design, match to a thousandth of a point.
- Its HTML is compared with Typst's SVG in Chromium, Firefox and WebKit, and its parser and evaluation with Typst's on random formulas.
- [SECURITY.md](SECURITY.md) describes the review for untrusted input.

### Known limitations

- Formulas are drawn as MathML, with a warning, when they have a symbol that New Computer Modern Math lacks; text in Cyrillic, Hebrew, Arabic, Devanagari or Latin letters beyond Western European ones, whose metrics Typlet can't load yet; raw text; or text settings such as another font or a stroke.
- Loops, `show` rules, `context`, counters and file access are refused as `unsupported`.
- New Computer Modern Math is the only math font.
- A page's first formulas render more slowly than KaTeX's: about 1.2 to 1.5 times for the first, and about twice over a page of 73.
