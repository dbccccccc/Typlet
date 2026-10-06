# Embedded code

Typst formulas can contain code, and Typlet evaluates it as Typst does: `#` expressions, the arguments of math calls, content blocks, and statements. The [supported features](supported.html) list every function.

## Values and calls

Literals, operators, arrays and dictionaries, colors and alignments, and calls to the math functions and to `h`, `rgb` and `luma`:

```typ
mat(delim: "[", augment: #1, 1, 2; 3, 4) quad x #h(-1em/6) y
```

$ mat(delim: "[", augment: #1, 1, 2; 3, 4) quad x #h(-1em/6) y $

## Styled content

Content blocks with markup, and the functions `text`, `strong`, `emph`, `highlight`, `hide`, `box` and `link`:

```typ
#text(fill: blue)[blue] + #box(stroke: 0.5pt, inset: 2pt, $x^2$) + #highlight[$y$]
```

$ #text(fill: blue)[blue] + #box(stroke: 0.5pt, inset: 2pt, $x^2$) + #highlight[$y$] $

## Definitions and set rules

`let` bindings, functions with named parameters and defaults, `if`, code blocks, and set rules. In a formula, a set rule goes in a content or code block, and styles the rest of the block:

```typ
#{ let sq(x) = $#x^2$; set math.mat(delim: "["); $mat(sq(a), sq(b))$ }
```

$ #{ let sq(x) = $#x^2$; set math.mat(delim: "["); $mat(sq(a), sq(b))$ } $

## Preambles

The `preamble` option holds code that comes before every formula, like the start of a document: definitions and set rules that formulas share. It replaces KaTeX's `macros`. Typlet evaluates a preamble once for each set of options.

```js
const options = { preamble: '#let RR = $bb(R)$\n#let norm(x) = $lr(|| #x ||)$' };
renderToString('f: RR^n -> RR, quad norm(v) <= 1', options);
```

## Numbered equations

A preamble's set rule numbers display equations. They take their numbers from the `equationCounter` option, an object whose `value` each numbered equation increments, so a page numbers its equations in order. Auto-render and the Markdown plugins keep one counter per page or document.

```js
const options = { displayMode: true, preamble: '#set math.equation(numbering: "(1)")', equationCounter: { value: 0 } };
renderToString('a^2 + b^2 = c^2', options); // numbered (1)
renderToString('e^(i pi) + 1 = 0', options); // numbered (2)
```

Numbering patterns such as `"(1)"`, `"1.a"` and `"i"` work, and so do numbering functions such as `n => [Eq. #n]`.

## Links

`#link` draws a link only where the `trust` option allows it: `true`, or a function of the URL and its protocol. Without trust, the link's text shows without the link, and a warning names the URL.

```js
renderToString('#link("https://typst.app")[Typst]', { trust: ({ protocol }) => protocol === 'https' });
```

## What Typlet refuses

Code that needs Typst's document engine raises a `TypletError` of kind `unsupported`: `show` rules, loops, introspection such as `context` and `counter`, imports and file access, and document elements such as headings. The `fallback` option can render those formulas another way, for example with Typst compiled to WebAssembly, loaded only when a formula needs it:

```js
render(source, element, { fallback: (source, error) => renderWithTypst(source) });
```

`render` shows the formula's source until a promise from the fallback resolves.

## Budgets

Formulas can compute, so every formula runs under budgets: function calls, collection sizes, string lengths, content elements, sizes and output length. Abuse stops quickly with a `TypletError` of kind `limit`. See [security](security.html) for the defaults and the options that change them.
