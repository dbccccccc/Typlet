# Typlet

Typlet renders [Typst](https://typst.app) math in the browser and in Node, like KaTeX does for LaTeX: one JavaScript file and web fonts, with a synchronous API, no WebAssembly and no compiler.

$ sum_(i=1)^n i = (n(n+1))/2 $

Its layout is a port of Typst's own math layout, and it is checked against the Typst compiler: of the formulas Typlet lays out, every frame matches Typst's to a thousandth of a point. Formulas can use the code Typst formulas use, such as `#h(-1em/6)` and `mat(delim: "[", 1, 2; 3, 4)`, styled text, boxes, definitions and set rules.

## Install

```bash
npm install typlet
```

Typlet is an independent project and is not affiliated with Typst GmbH.

## Render a formula

```js
import { render, renderToString } from 'typlet';

const html = renderToString('x^2 + y^2 = r^2');
render('sum_(i=1)^n i', element, { displayMode: true });
```

Pages need Typlet's stylesheet, which loads its fonts as the page's formulas need them:

```html
<link rel="stylesheet" href="node_modules/typlet/fonts/typlet.css">
```

Or render every formula in a page's text, with Typst's syntax: `$x$` is inline, and `$ x $`, with spaces inside both dollar signs, is a display formula.

```html
<script src="typlet/dist/typlet.min.js"></script>
<script src="typlet/dist/contrib/auto-render.min.js"></script>
<script>renderMathInElement(document.body);</script>
```

## Outputs

The `output` option picks what Typlet emits, as in KaTeX:

| `output` | Drawn by | Screen readers get |
|---|---|---|
| `htmlAndMathml` (the default) | Typlet's HTML: glyphs and rules where Typst places them | The MathML, visually hidden |
| `html` | Typlet's HTML | An `aria-label` with the source |
| `mathml` | The browser, from MathML like Typst's own export | The MathML |

Formulas follow the text's color, so they work in dark mode, and they scale with the font size. Inline formulas wrap where Typst breaks lines, after relations and binary operators.

## Learn more

- [Guide](guide.html): options, errors and warnings, styling.
- [Embedded code](code.html): what code formulas can use, preambles and numbering, links, budgets.
- [Integrations](integrations.html): auto-render, copy-typst, the `<typlet-math>` element, the `typlet` command, and plugins for rehype and markdown-it.
- [Supported features](supported.html): every function and symbol, generated from the library.
- [Gallery](gallery.html) and [playground](playground.html).
- [Compare](compare.html): the same formulas rendered by Typlet and by KaTeX in your browser, with the time each takes.
- [Security](security.html): rendering untrusted formulas.
