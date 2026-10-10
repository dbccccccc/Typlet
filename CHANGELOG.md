# Changelog

What each release of Typlet changes. The versions follow [semantic versioning](https://semver.org/): while they start with 0, a minor release may change the API, and each Typlet version reproduces one Typst version. `rehype-typlet` and `markdown-it-typlet` are released with Typlet, under the same version.

## Unreleased

- The `typlet` command takes `--max-collection-size` and `--max-string-length`, the two budgets it lacked.

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

- Of the 1,823 formulas of the test corpus that Typst renders, Typlet lays out 1,658, draws 158 as MathML with a warning, and refuses 7. The tests compare the frames it lays out with Typst's: all but three, which differ by design, match to a thousandth of a point.
- Its HTML is compared with Typst's SVG in Chromium, Firefox and WebKit, and its parser and evaluation with Typst's on random formulas.
- [SECURITY.md](SECURITY.md) describes the review for untrusted input.

### Known limitations

- Formulas are drawn as MathML, with a warning, when they have a symbol that New Computer Modern Math lacks; text in Cyrillic, Hebrew, Arabic, Devanagari or Latin letters beyond Western European ones, whose metrics Typlet can't load yet; raw text; or text settings such as another font or a stroke.
- Loops, `show` rules, `context`, counters and file access are refused as `unsupported`.
- New Computer Modern Math is the only math font.
- A page's first formulas render more slowly than KaTeX's: about 1.2 to 1.5 times for the first, and about twice over a page of 73.
