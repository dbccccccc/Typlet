# Changelog

What each release of Typlet changes. The versions follow [semantic versioning](https://semver.org/): while they start with 0, a minor release may change the API, and each Typlet version reproduces one Typst version. `rehype-typlet` and `markdown-it-typlet` are released with Typlet, under the same version.

## 0.2.0

A minor release targeting Typst 0.15.1, like 0.1.1. The formula language deliberately remains the v0.1.1 subset: math, macros, basic collections, content, styles and equation numbering. The unpublished general runtime additions have been removed: loops, assignments, `calc`/libm, general collection/string methods, constructors, conversions and inspection functions. These constructs still parse, and rendering reports `unsupported` with a source span so the host can use its external fallback. Equation show-set `.where` rules remain supported.

- **Structured rendering results.** `renderToResult()` returns markup, `drawnAs` (`html`, `mathml`, `fallback` or `error`), classified warnings and an equation number. Warnings are deduplicated per location and message.
- **Reliable integrations.** HTML-only output can fall back to MathML with a warning. Async fallbacks update only the latest render invocation, including repeated sources, DOM normalization and reentrant calls. Copied HTML preserves literal tags and entities alongside formula source and real formatting.
- The rehype plugin processes every adjacent inline, display and fenced formula after empty results. It preserves multiple fallback nodes without revisiting their markup, and keeps equation numbering in source order.
- Numbered HTML output keeps its exact source for copying, including whitespace in custom equation numbers. Plain-text copying preserves paragraph, line, list and table separators.
- The markdown-it plugin's declaration supports both markdown-it 14 and 15, with strict checks of the packed declaration against both type surfaces. Each document resets the plugin's default equation counter even when its environment is reused; an explicitly supplied counter still accumulates across documents.
- **Bounded work.** Flat set/show rule chains stop at 256 active rules. Runtime-built content is checked iteratively before recursive realization, layout, MathML and number extraction, with a maximum depth of 256 and 100,000 visits. Inherited content cycles in box bodies, attachments and annotations are also bounded in the actual resolver and output contexts. These cases produce controlled resource errors, including `throwOnError: false`, rather than native stack failures.
- Recursive macro bodies, expression nesting and rule tails now share a limit of 512 active evaluation steps per engine, including delayed callbacks. Excessive combined execution produces a source-located `limit` error and controlled markup with `throwOnError: false`; ordinary function-call depth errors keep Typst's existing boundary.
- Valid formula and preamble syntax trees are checked for depth before recursive evaluation. Syntax traversal and cloning preserve parser diagnostics using explicit stacks.
- Shared collection representations avoid per-array and per-dictionary generators, small field builders, repeated wide-text scans and temporary line arrays. Syntax checks reuse traversal frames across sibling branches, and parser wrapping avoids a discarded removed-node array when no trailing trivia remains. Parser token records are reused while checkpoint and memo snapshots keep independent clones. Content leaves still check depth and consume visits before skipping structural traversal. Rendering avoids checking the same formula tree twice; direct evaluation still validates its input, and rendering still checks formula depth before evaluating the preamble. Formatting, diagnostics and all existing limits are preserved.
- Value operations share bounded work and depth; implicit representations check string length while building. Collection literals, repetition, spreads, dictionary merges and generated argument lists check budgets before growth. Empty array repetition finishes immediately for any nonnegative count.
- Delayed cancel-angle callbacks share formula evaluation budgets and forward warnings across crossed lines, nested boxes and numbered equations. Custom prime counts consume element and output expansion budgets before allocation.
- Ordinary text, mathematical glyphs, numbers and raw text now consume expansion work before styling, shaping or output conversion. A structural preflight bounds logical content expansion before IR allocation; paragraphs check before concatenation and equation numbers before joining. This prevents repeated content from exhausting the process before the final output-size check. Nested renders restore the outer element and size limits on both success and failure.
- Error and pending previews obey `maxOutputSize`, shortening escaped source only at code-point and entity boundaries. Full thrown diagnostics and external fallback markup retain their behavior.
- **Smaller delivery.** Production Brotli quality 11 sizes are 127,797 bytes (124.8 KiB) for the full browser script and 72,897 bytes (71.2 KiB) for `typlet/mathml`. Compared with the unpublished full-runtime candidate, this saves 18,649 and 18,681 bytes; compared with v0.1.1 built with the same production pipeline, the retained API and safety work adds 3,651 and 3,528 bytes. The font module remains 40,615 bytes. Budgets tighten to 128 KiB and 72 KiB.
- **Release validation.** All 507 visual-contract source records remain; 52 reviewed runtime examples now report `unsupported`. The contract expects 406 HTML, 17 MathML, 83 errors and one existing exclusion. All 4,827 expression fixtures remain, with 816 explicit unsupported IDs and reasons and oracle comparisons for the rest.
- Visual tests match oracle SVGs by ID and reject missing samples or unexpected output modes. Frame tests and the evaluation fuzzer compare glyph fills and linear transforms as well as geometry.
- The package and documentation ship complete license materials and verify their bytes and local links. The removed libm implementation and its distribution notices are gone; W3C MathML and font notices remain. The Oracle workflow also checks reproducible font assets with pinned tools.

Of the 1,705 formulas of the test corpus that Typst renders, Typlet now lays out 1,501, draws 159 as MathML with a warning, and refuses 45.

Release readiness requires the cross-platform CI and release rehearsal to pass on the final commit.

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
