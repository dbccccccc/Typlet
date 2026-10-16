# Security

Typlet renders formulas that pages often take from untrusted people: chat messages, comments, issues and shared links. This document describes what Typlet guarantees for such input, how the guarantees are tested, and what a page using Typlet still needs to do.

## Reporting a vulnerability

If a formula can break one of the guarantees below, by putting markup into the output that Typlet didn't make, or by making a render run without bound, please report it privately: use [Report a vulnerability](https://github.com/dbccccccc/Typlet/security/advisories/new) on the repository's Security tab, and don't open a public issue. Include the formula, the options, and Typlet's version. The latest release gets the fix.

## Threat model

An attacker controls the formula's source. They do not control the page's code, so Typlet's options, such as `trust`, `errorColor`, `preamble` and `fallback`, are trusted. Typlet aims to guarantee two things for any formula:

1. **No markup injection.** The output contains only the elements and attributes Typlet makes, with no scripts, event handlers, styles from the formula, or links the page didn't allow.
2. **Bounded work.** Rendering stops quickly with a `TypletError` of kind `limit`, whatever the formula computes.

## Markup

Every output is built from escaped text and fixed element and attribute names:
- **Text and attribute values are escaped.** That covers the formula's text, its strings and raw text, equation numbers (a numbering function can return any content), error messages and the source kept in annotations and labels. Attribute values are always quoted.
- **Element and attribute names never come from the formula.** All outputs use 33 elements (`span`, `a`, `br`, `code`, `em`, `mark`, `p`, `strong` and MathML's elements) and 28 attributes, listed in `test/security.test.ts`.
- **Styles hold only numbers, units and colors.** Colors from `rgb`, `luma` and named colors are written as hexadecimal, and lengths as numbers in `em`. No string from the formula reaches a `style` attribute.
- **Links need `trust`.** `#link` draws a link only where the `trust` option allows it. It is `false` by default, `true` to trust every link, or a function of the URL and its protocol: `trust: ({ protocol }) => protocol === 'https'`. The protocol is read as browsers read it: leading spaces and control characters are skipped and tabs and newlines dropped, so `" java\tscript:alert(1)"` has the protocol `javascript`. A URL whose scheme is malformed is never trusted. Without trust, the link's body shows without the link, and a warning names the URL.
- **Unknown content is refused, not passed through.** Typlet has no raw HTML element, and features it doesn't support raise a `TypletError` of kind `unsupported`.

`test/security.test.ts` renders hostile formulas in every output, inline and in display, with and without `throwOnError`. It parses each output as a browser does, and checks it against the lists of elements and attributes, the safe style characters, and the allowed links. It also renders 400 random formulas made of characters that matter to HTML, CSS, URLs and Typst.

## Work

Formulas can compute: Typst's code has functions, recursion and growing values. Typlet bounds each formula's work (docs/DESIGN.md §6.6):

| Budget | Default | Option |
|---|---|---|
| Function calls | 30,000 | `maxCalls` |
| Call depth | 80, as in Typst | — |
| Parser nesting | 256, as in Typst | — |
| Syntax tree depth | 256, with the root at zero | — |
| Active evaluation depth | 512 expressions and rule tails combined per engine | — |
| Value-node visits | 100,000 per evaluation engine | — |
| Value traversal depth | 256 | — |
| Array/dictionary items and generated argument lists | 10,000 | `maxCollectionSize` |
| Characters in a string | 100,000 | `maxStringLength` |
| Content elements and expanded text units per stage | 10,000 | `maxElements` |
| Size of spacing, boxes and text | 1,000 em | `maxSize` |
| Output | 1,000,000 characters | `maxOutputSize` |

Syntax errors keep the parser's existing diagnostics, collected by iterative traversal. Before evaluation, each valid formula or preamble tree is checked iteratively for a structural depth of at most 256, counting the root at zero. This internal limit has no public option and can reject a deep branch even if short-circuit evaluation would skip it. Function-call depth and call counting are unchanged. The engine also allows at most 512 expressions and rule tails active together, so recursive macros cannot multiply the independent syntax and call depths into a native stack failure. Closures and delayed callbacks share this guard; its counters unwind after both success and failure. The limit has no public option and reports a source-located `TypletError` of kind `limit`, with controlled markup when throwing is disabled.

Collection construction checks literals, spreads, merges, repetition, generated arguments and closure sinks before growth. Fixed syntax arguments and empty spreads preserve their behavior. Runtime content assembled across definitions is checked iteratively before realization, layout, MathML and equation-number extraction: depth is at most 256, with at most 100,000 content visits. Set/show tails also allow at most 256 active rules independently of syntax depth. Actual resolver and output recursion is bounded at 256 active steps, including style-inherited box, attachment and annotation cycles; nested output contexts share the guard and restore it on exit. Violations produce `TypletError` kind `limit`, including controlled markup when throwing is disabled.

Each evaluation engine also shares an internal budget of 100,000 value-node visits and a traversal depth of 256 across representations, serialization and comparisons. Repeated visits to a shared subtree count separately, so a compact value graph can reach this limit. These limits have no public option and are independent of `maxCalls`. Representation strings, including implicit value displays and diagnostic representations, obey `maxStringLength` in JavaScript UTF-16 code units.

Library-generated error and pending markup also obeys `maxOutputSize`, measured in UTF-16 code units. Full previews retain their existing format when they fit; otherwise they omit optional attributes and shorten escaped source text at code-point and entity boundaries. If the minimal span cannot fit, the markup is empty; an error result still reports `drawnAs: 'error'`. Thrown errors retain their complete diagnostics and source. Markup returned by the caller's `fallback` remains the caller's responsibility and is not truncated.

The element budget also counts repeated prime units from custom prime counts, before allocating their characters or frame glyphs. Counts from one to four keep their combined glyphs. The expanded prime character count is checked against `maxOutputSize` before allocation; the final complete markup length is still checked. MathML and HTML use separate output allowances, shared by nested equations and boxes within each output.

Ordinary text, mathematical glyphs, numbers and raw text also consume expansion units in UTF-16 code units before styling, shaping or output conversion. A structural preflight counts logical content occurrences and text before building IR, including repeated shared children. Paragraph collection checks text before concatenation. Equation-number extraction counts both content visits and text before joining, so shared content cannot amplify without consuming work. Each preflight, resolver and output stage has its own allowance; nested boxes and equations share their output's allowance. Synchronous nested renders restore the caller's element and size limits even when the nested render fails.

Delayed HTML layout callbacks, such as cancel-line angles, use the formula evaluation engine, including calls and value work already consumed. Nested boxes and numbered equations share it. Collection and string construction use its limits; nested renders restore the caller, and independent renders have fresh engines even when they reuse a cached preamble. Callback warnings join the output warnings once, in their original order.

`npm run check:budgets` checks that the built bundle stops each abusive formula in `test/budget-cases.mjs` within 50 ms: recursion bombs, repetition, content that doubles, deep nesting, huge sizes, callbacks and collection and string growth. Each case runs in a separate 128 MiB child process with a five-second hard deadline; the time limit remains the median of five samples after one warmup. It also checks bounded string/collection operations and retained macro calls that succeed. Typlet has no file access, packages, `eval` or introspection (docs/DESIGN.md §6.3), so no formula reaches outside its own evaluation. Retained user calls and layout callbacks count against the call budget. Loops, mutation, `calc`, generic conversions and general collection/string methods are outside the supported formula language.

## Differential fuzzing

Two fuzzers compare Typlet with the real Typst compiler, through the oracle in `oracle/`:
- `npm run fuzz` parses random inputs with Typlet and typst-syntax, and compares their syntax trees.
- `npm run fuzz:eval` renders random formulas from a grammar of math and embedded code, with and without preambles. It compares Typlet's MathML, diagnostics and layout with Typst's. Every render, in every output, must finish within a second or fail with a `TypletError`.

Before the 0.1.0 release, 40,000 formulas of `fuzz:eval`, seeds 20 to 27, and 100,000 inputs of `fuzz` rendered with no divergence, crash or hang. Earlier sweeps found divergences in how Typst's HTML export treats content that isn't math, in whitespace, paragraphs, smart quotes and boxes, and in tracking, which are now fixed, and kept as tests.

## What pages need to do

- **Keep `trust` off for untrusted formulas**, or allow only the protocols you want, such as `https`.
- **Content Security Policy.** Typlet's HTML uses inline `style` attributes, as KaTeX's does, so a policy needs `style-src 'unsafe-inline'`, or `style-src-attr 'unsafe-inline'` where supported. Typlet runs no `eval` and makes no requests; the fonts come from your own `typlet.css`.
- **A `fallback` that renders refused formulas** runs other code, such as Typst compiled to WebAssembly, on the same untrusted source. Its output is inserted as it is, so it must be safe too.
- **Budgets** can be lowered for pages that render many formulas, such as a chat log, so that one message can't take more than its share.
