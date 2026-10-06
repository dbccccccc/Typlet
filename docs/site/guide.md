# Guide

## Rendering

`renderToString(source, options)` returns a formula as a string of HTML, and `render(source, element, options)` renders it into an element, replacing the element's content. The source is the formula without its dollar signs, as in Typst: `x^2`, not `$x^2$`.

The `typlet/mathml` entry point renders MathML alone. It leaves out the layout engine and the font metrics, so it is about half the size, and it suits EPUB, tools that consume MathML, and pages where size matters most.

`parse(source)` returns Typst's syntax tree for a formula, with the same node kinds, error recovery and messages as Typst's parser, for editors and linters.

## Options

| Option | Default | What it does |
|---|---|---|
| `displayMode` | `false` | Renders a display formula, centered on its own line. |
| `output` | `'htmlAndMathml'` | `'htmlAndMathml'`, `'html'` or `'mathml'`. |
| `throwOnError` | `true` | Throws a `TypletError` for an invalid formula. With `false`, renders its source in the error color instead, with the message as a tooltip. |
| `errorColor` | `'#cc0000'` | The color of formulas that failed. |
| `strict` | `'warn'` | What warnings do: `'ignore'`, `'warn'` (log them) or `'error'` (fail), or a function of the warning that decides. |
| `trust` | `false` | Whether to draw links: `true`, `false`, or a function of the link's URL and protocol. |
| `preamble` | none | Typst code that comes before every formula, such as `#let` and `#set` statements. |
| `equationCounter` | none | The counter of numbered display equations: an object whose `value` each numbered equation increments. |
| `fallback` | none | Renders formulas Typlet refuses: a function of the source and the error that returns markup, or a promise of it. |
| `maxCalls` | 30,000 | The most function calls per formula. |
| `maxCollectionSize` | 10,000 | The most items in an array or dictionary. |
| `maxStringLength` | 100,000 | The most characters in a string. |
| `maxElements` | 10,000 | The most content elements a formula makes. |
| `maxSize` | 1,000 | The largest size of spacing, boxes and text, in ems. |
| `maxOutputSize` | 1,000,000 | The longest output, in characters. |

## Errors

An invalid formula throws a `TypletError` with Typst's message and hints:

```js
renderToString('x + foo');
// TypletError: unknown variable: foo
//   kind: 'eval', span: { start: 4, end: 7 }
//   hints: ['if you meant to display multiple letters as is, try adding spaces between each letter: `f o o`', …]
```

Its `kind` says why it failed:
- `syntax`: the formula has a syntax error.
- `eval`: evaluation failed, as it would in Typst.
- `unsupported`: Typst supports the feature, and Typlet doesn't, such as a `show` rule.
- `limit`: a budget ran out.

Its `diagnostics` list every error, each with a `span` in the source, in UTF-16 code units, and `in`, which says whether the span is in the formula or in the `preamble`.

## Warnings

Typst warns about some formulas, for example about deprecated symbols, and Typlet gives the same warnings. They go to `console.warn` by default. The `strict` option ignores them, makes them errors, or decides for each warning:

```js
renderToString(source, { strict: (warning) => (warning.message.startsWith('Typlet left out') ? 'ignore' : 'warn') });
```

When the HTML can't draw a formula yet, for example a character New Computer Modern Math lacks, Typlet draws that formula as MathML and warns.

## Styling

Typlet's HTML is laid out in `em`, so a formula takes the font size of the text around it. Glyphs and rules use `currentColor`, so formulas take the text's color, in light and dark themes alike; colors a formula sets, such as $#text(fill: blue)[blue]$, are kept. Every rule in `typlet.css` is scoped under `.typlet`, and display formulas are `.typlet-display` blocks with a margin you can change:

```css
.typlet-display { margin: 0.5em 0; }
```

On Linux, browsers hint fonts: they snap glyph outlines to the pixel grid, which keeps text crisp but moves the edges of Typlet's glyphs by up to a pixel from where Typst draws them. A page that wants Typst's geometry exactly can turn hinting off for formulas:

```css
.typlet .typlet-html { text-rendering: geometricPrecision; }
```

Chromium follows this on Linux; Firefox and WebKit there ignore it, and on Windows it changes nothing. On screens of standard density, glyphs that fall between two rows of pixels then look a little lighter than the hinted text around them.

## Accessibility

The default output carries MathML beside the HTML, visually hidden, for screen readers, and the HTML is hidden from them. The `html` output has an `aria-label` with the formula's source instead. Every output keeps the source: in a MathML annotation, or in the label.
