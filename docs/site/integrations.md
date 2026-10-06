# Integrations

## Auto-render

`typlet/contrib/auto-render` renders the formulas in a page's text, like KaTeX's auto-render:

```js
import renderMathInElement from 'typlet/contrib/auto-render';

renderMathInElement(document.body);
```

Or, without a bundler, after `typlet.min.js`:

```html
<script src="typlet/dist/contrib/auto-render.min.js"></script>
<script>renderMathInElement(document.body);</script>
```

By default, formulas follow Typst's syntax: `$x$` is inline, `$ x $`, with spaces inside both dollar signs, is display, and `\$` is a dollar sign. Typst's own parser finds where each formula ends, so `$#box[$x$]$` is one formula. The `delimiters` option changes the syntax:
- `'markdown'`: `$$x$$` is display and `$x$` is inline.
- A list of delimiters, as in KaTeX: `[{ left: '\\(', right: '\\)', display: false }]`.

Its other options, besides Typlet's render options:
- `ignoredTags`: elements whose text is left alone; by default `script`, `noscript`, `style`, `textarea`, `pre`, `code`, `option`, `math` and `svg`.
- `ignoredClasses`: classes of elements whose text is left alone. Formulas Typlet rendered are always left alone, so rendering twice is safe.
- `errorCallback`: called with a message and the `TypletError` for a formula that fails, which stays as text. With `throwOnError: false`, the error renders in place instead.
- `preProcess`: changes a formula's source before rendering.

Numbered display equations are numbered in order, with one counter for the call.

## Copying as Typst

`typlet/contrib/copy-typst` makes copied formulas paste as their Typst source, like KaTeX's copy-tex. When a selection holds formulas, the plain text gets each formula's source, as `$x$` or `$ x $`, and the HTML stays as it is. Importing the module, or loading `copy-typst.min.js`, installs it. `typletReplaceWithSource(fragment, delimiters)` does the replacement for a copy handler of your own.

## The `<typlet-math>` element

`typlet/contrib/element` defines a custom element that renders its text:

```html
<typlet-math>x^2</typlet-math>
<typlet-math display>sum_(i=1)^n i</typlet-math>
<typlet-math source="a^2 + b^2 = c^2"></typlet-math>
```

Setting its `source` property or attribute renders a new formula, and `output` chooses the output. `elementOptions` holds render options for every element, such as a `preamble`. It renders into the element itself, so the page needs `typlet.css`. Invalid formulas show their source in the error color.

## The `typlet` command

```bash
typlet "sum_(i=1)^n i" --display-mode > formula.html
```

The formula comes from the argument, the `--input` file, or standard input. `--format` picks the output, `--preamble` and `--preamble-file` take a preamble, and `--trust`, `--no-throw-on-error`, `--strict` and the budgets work like the options of the same names. Errors print Typst's message and hints with the line and column. `typlet --help` lists every option.

## rehype

`rehype-typlet` renders the math that [remark-math](https://github.com/remarkjs/remark-math) finds, like rehype-katex:

```js
const file = await unified()
  .use(remarkParse)
  .use(remarkMath)
  .use(remarkRehype)
  .use(rehypeTyplet, { preamble: '#let RR = $bb(R)$' })
  .use(rehypeStringify)
  .process(markdown);
```

Formulas that fail render in the error color, and the failure and any warnings become messages on the file. Code fenced as ` ```math ` renders as a display formula.

## markdown-it

`markdown-it-typlet` renders math in [markdown-it](https://github.com/markdown-it/markdown-it):

```js
const md = new MarkdownIt().use(markdownItTyplet);
md.render('Let $x^2$ be.\n\n$$\nsum_(i=1)^n i\n$$\n');
```

By default it reads Markdown's math syntax, where `$x$` is inline and `$$` surrounds display formulas, and like Pandoc it leaves "\$5 and \$10" as text. With `delimiters: 'typst'`, it reads Typst's syntax instead. This site is built with it.
