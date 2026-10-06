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
- **Element and attribute names never come from the formula.** All outputs use 33 elements (`span`, `a`, `br`, `code`, `em`, `mark`, `p`, `strong` and MathML's elements) and 27 attributes, listed in `test/security.test.ts`.
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
| Items in an array or dictionary | 10,000 | `maxCollectionSize` |
| Characters in a string | 100,000 | `maxStringLength` |
| Content elements | 10,000 | `maxElements` |
| Size of spacing, boxes and text | 1,000 em | `maxSize` |
| Output | 1,000,000 characters | `maxOutputSize` |

`npm run check:budgets` checks that the built bundle stops each abusive formula in `test/budget-cases.mjs` within 50 ms: recursion bombs, repetition, content that doubles, deep nesting and huge sizes. Typlet has no loops, file access, packages, `eval` or introspection (docs/DESIGN.md §6.3), so no formula reaches outside its own evaluation.

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
