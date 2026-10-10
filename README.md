# Typlet

[![npm](https://img.shields.io/npm/v/typlet)](https://www.npmjs.com/package/typlet)
[![CI](https://github.com/dbccccccc/Typlet/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dbccccccc/Typlet/actions/workflows/ci.yml?query=branch%3Amain)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A lightweight, KaTeX-style renderer for [Typst](https://typst.app) math: one small JavaScript file plus split web fonts, with a synchronous API and no WASM or compiler.

Typlet draws Typst math as HTML laid out by a port of Typst's own math layout, with MathML for screen readers, and its tests compare every formula it lays out with the Typst compiler's own layout. It evaluates the embedded code formulas use, from `#h(1em)` and `mat(delim: "[", ...)` to styled content, boxes, `#let` definitions, functions and set rules (see [Embedded code](#embedded-code)). It comes with auto-render, copy-as-Typst, a custom element, a command-line tool, and plugins for rehype and markdown-it (see [Integrations](#integrations)).

> **Status: 0.1, the first public release.** It reproduces Typst 0.15.1. The API may still change before 1.0: [CHANGELOG.md](CHANGELOG.md) lists what each release changes, [Limitations](#limitations) what Typlet doesn't draw yet, and [docs/DESIGN.md](docs/DESIGN.md) how it works.

Typlet is an independent project and is not affiliated with Typst GmbH.

## Install

```bash
npm install typlet
```

Or load it in a page, with its stylesheet:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/typlet@0.1.0/fonts/typlet.css">
<script src="https://cdn.jsdelivr.net/npm/typlet@0.1.0/dist/typlet.min.js"></script>
<script>
  typlet.render('sum_(i=1)^n i = (n(n+1))/2', document.getElementById('formula'), { displayMode: true });
</script>
```

The npm package needs Node 22 or newer, and the bundles run in browsers that support ES2022.

## Usage

```js
import { render, renderToString } from 'typlet';

renderToString('x^2');
// '<span class="typlet"><span class="typlet-mathml"><math>…</math></span>
//  <span class="typlet-html" aria-hidden="true"><span class="f" style="width:1.0263em;…">…</span></span></span>'

render('sum_(i=1)^n i = (n(n+1))/2', element, { displayMode: true });
```

Pages need `typlet.css` and the fonts (see [Fonts](#fonts)). The `output` option picks what Typlet emits, as in KaTeX:

| `output` | Drawn by | Screen readers get |
|---|---|---|
| `htmlAndMathml` (default) | Typlet's HTML: glyphs and rules placed where Typst places them | The MathML, visually hidden |
| `html` | Typlet's HTML | An `aria-label` with the source |
| `mathml` | The browser, from MathML that matches Typst's own HTML export | The MathML |

Inline formulas wrap after binary operators and relations, where Typst breaks lines. A formula that Typlet cannot draw yet, such as one with a symbol that New Computer Modern Math lacks, falls back to MathML with a warning.

The MathML follows Typst's own HTML export, and keeps what that export drops: `overline` and `underline` as stretchy accents, `cancel` as `<menclose>`, colors, box borders and backgrounds, and `hide` as `<mphantom>`.

The `typlet/mathml` entry point renders MathML alone. It leaves out the layout engine and font metrics, so it is about half the size:

```js
import { renderToString } from 'typlet/mathml';

renderToString('sum_(i=1)^n i = (n(n+1))/2', { displayMode: true });
// '<span class="typlet-display"><span class="typlet"><math display="block"><semantics>…
//  <annotation encoding="application/x-typst">sum_(i=1)^n i = (n(n+1))/2</annotation></semantics></math></span></span>'
```

The options follow KaTeX's where the meaning carries over: `displayMode`, `output`, `throwOnError`, `errorColor`, `strict` and `trust`. Typlet adds `preamble`, `equationCounter` and `fallback` (see [Embedded code](#embedded-code)), and budgets for untrusted input: `maxCalls` (30,000 function calls), `maxCollectionSize` (10,000 items), `maxStringLength` (100,000 characters), `maxElements` (10,000 content elements), `maxSize` (1,000 em for spacing, boxes and text) and `maxOutputSize` (1,000,000 characters). An invalid formula throws a `TypletError` with Typst's message and hints, the error's span in the source, and a `kind`: `syntax`, `eval`, `unsupported` (Typst supports it, Typlet doesn't yet) or `limit` (a budget ran out).

```js
renderToString('x + foo');
// TypletError: unknown variable: foo
//   kind: 'eval', span: { start: 4, end: 7 }
//   hints: ['if you meant to display multiple letters as is, try adding spaces between each letter: `f o o`', …]
```

`parse()`, from the main `typlet` entry point, returns Typst's syntax tree for a formula, with the same node kinds, error recovery and messages as typst-syntax.

### Embedded code

Typlet evaluates Typst code in formulas, as Typst does:
- **Values:** literals, operators, arrays and dictionaries, colors, alignments, strokes, and calls such as `#h(-1em/6)` and `mat(delim: "[", augment: #2, ..rows)`.
- **Content and styling:** content blocks with markup (`#[*bold* and _emphasized_ text]`), `text` (fill, size, weight, style, tracking, spacing, baseline, and the language, which chooses the quotes), `strong`, `emph`, `highlight`, `hide`, `box` (size, baseline, fill, stroke, radius, inset, outset) and `link`. Links are drawn only when the `trust` option allows them: `true`, or a function of the URL and its protocol, such as `({ protocol }) => protocol === 'https'`. Settings the HTML can't draw yet, such as other fonts or text strokes, fall back to MathML with a warning.
- **Definitions and settings:** `#let` values and functions, with named parameters, defaults, destructuring and recursion; `if`/`else`; code blocks; and set rules such as `#set math.mat(delim: "[")` and `#set text(fill: blue)`, which apply to the rest of the formula.

The `preamble` option holds code that comes before every formula, like the start of a document. It replaces KaTeX's `macros`. Typlet evaluates it once per set of options. Display equations that its set rules number take their numbers from `equationCounter`:

```js
const options = {
  displayMode: true,
  preamble: '#let norm(x) = $lr(|| #x ||)$\n#set math.equation(numbering: "(1)")',
  equationCounter: { value: 0 },
};
renderToString('norm(v) <= 1', options);                     // numbered (1)
renderToString('norm(u + v) <= norm(u) + norm(v)', options); // numbered (2)
```

Typlet refuses what needs Typst's document engine: `show` rules, loops, introspection such as `context` and `counter`, file access, and document elements such as headings. These throw a `TypletError` of kind `unsupported`. The `fallback` option can render them another way, for example with Typst compiled to WebAssembly, loaded only when needed:

```js
// renderWithTypst is your own function, for example one built on typst.ts.
render(source, element, { fallback: (source, error) => renderWithTypst(source) }); // markup, or a promise of it
```

Errors in the preamble have `in: 'preamble'` in their diagnostics, with spans in the preamble.

### Integrations

- **Auto-render:** `typlet/contrib/auto-render` renders the formulas in a page's text, like KaTeX's auto-render. By default it reads Typst's syntax, where `$x$` is inline and `$ x $`, with spaces inside both dollar signs, is display, and Typst's parser finds where each formula ends. `delimiters: 'markdown'` reads `$$x$$` as display instead, and a list of delimiters works as in KaTeX.
- **Copy as Typst:** `typlet/contrib/copy-typst` makes copied formulas paste as their Typst source, like KaTeX's copy-tex.
- **Custom element:** `typlet/contrib/element` defines `<typlet-math>`, which renders its text, or its `source` attribute, with `display` and `output` attributes.
- **Command line:** `typlet "sum_(i=1)^n i" --display-mode` prints the HTML. The formula can also come from a file or standard input, and `typlet --help` lists the options.
- **rehype and markdown-it:** [`rehype-typlet`](packages/rehype-typlet) renders the math remark-math finds, like rehype-katex, and [`markdown-it-typlet`](packages/markdown-it-typlet) adds math to markdown-it, with Markdown's or Typst's syntax. They are packages of their own: `npm install rehype-typlet` or `npm install markdown-it-typlet`.

Each contrib module also has a browser build, `dist/contrib/*.min.js`, which uses the global `typlet` from `typlet.min.js`:

```html
<script src="node_modules/typlet/dist/typlet.min.js"></script>
<script src="node_modules/typlet/dist/contrib/auto-render.min.js"></script>
<script>renderMathInElement(document.body);</script>
```

### Security

Formulas from untrusted users are safe to render with the default options: the formula's text is always escaped, element and attribute names never come from it, links need `trust`, and the budgets stop abuse quickly. [SECURITY.md](SECURITY.md) covers the review, the fuzzing and what remains the page's job, such as making a `fallback`'s output safe.

### Fonts

Typst sets math in New Computer Modern Math. Typlet ships it as "Typlet NewCM Math", split into woff2 files that browsers load as a page's characters need them: the benchmark page of 73 formulas loads 202 to 214 KB, about what KaTeX loads for it. Glyphs that have no code point of their own, such as size variants and script-size digits, are mapped to private code points. `typlet.css` declares the fonts and carries the styles of the HTML output and Typst's styles for MathML, all scoped under `.typlet`:

```html
<link rel="stylesheet" href="node_modules/typlet/fonts/typlet.css">
```

On Linux, browsers hint fonts: they snap glyph outlines to the pixel grid, which keeps text crisp but moves glyph edges by up to a pixel from Typst's. Pages that want Typst's geometry exactly can turn hinting off for formulas, which Chromium follows on Linux (Firefox and WebKit there ignore it, and Windows is unchanged). On screens of standard density, glyphs that fall between two rows of pixels then look a little lighter:

```css
.typlet .typlet-html { text-rendering: geometricPrecision; }
```

The fonts are under the GUST Font License; see [fonts/MANIFEST-typlet-newcm-math.txt](fonts/MANIFEST-typlet-newcm-math.txt).

## Limitations

Typlet 0.1 draws most formulas as Typst does, and says so when it can't:
- **Some formulas are drawn as MathML, with a warning,** by the browser and not by Typst's layout. These are formulas with a symbol that New Computer Modern Math lacks, with text in Cyrillic, Hebrew, Arabic, Devanagari or accented Latin letters beyond Western European ones, with raw text, or with text settings such as another font or a stroke.
- **Code that needs Typst's document engine is refused,** with a `TypletError` of kind `unsupported`: loops, `show` rules, `context`, counters and file access. The `fallback` option can render such formulas another way.
- **One math font.** Formulas are set in New Computer Modern Math, Typst's default.
- **Speed.** Typlet renders a formula about as fast as KaTeX once its code is warm, and a page's first formulas more slowly. The documentation site's comparison page measures both in your browser.

[docs/supported.md](docs/supported.md) lists every function and symbol Typlet supports.

## Documentation

- [The documentation site](https://dbccccccc.github.io/Typlet/) has a guide, embedded code, the integrations, the supported features, a gallery, a playground and a comparison with KaTeX. Its pages are in [docs/site/](docs/site), and `npm run build && npm run docs:build && npm run docs:serve` serves it on http://localhost:5175/.
- [docs/DESIGN.md](docs/DESIGN.md) explains the design: the outputs, the pipeline, the fonts, the tests against Typst and embedded code.
- [docs/UPSTREAM.md](docs/UPSTREAM.md) maps Typlet's files to the Typst files they are ported from.
- [SECURITY.md](SECURITY.md) covers rendering untrusted formulas and reporting vulnerabilities.

## Contributing

Bug reports and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how the repository is laid out, how to run the checks, and how Typlet is tested against the Typst compiler.

## License

MIT, with Apache-2.0 notices for code ported from Typst. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
