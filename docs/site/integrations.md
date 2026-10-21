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

### Batch mode

`typlet --batch` renders many formulas in one process, for build scripts in any language. It reads [JSON Lines](https://jsonlines.org/) from standard input, or from the `--input` file, and writes a line of JSON for each as the lines arrive, so a script can keep one `typlet` running and send it formulas as it meets them.

```bash
printf '%s\n' '{"id": 1, "source": "x^2"}' '{"id": 2, "source": "sum_i i", "displayMode": true}' | typlet --batch
```

Each input line is an object with the formula as `source`, an `id` to return as is, and any of the render options `displayMode`, `output`, `throwOnError`, `errorColor`, `strict`, `trust`, `preamble` and the budgets, which override the flags for that line. Each output line is the result of `renderToResult`, with the `id` first:

```json
{"id": 1, "markup": "<span class=\"typlet\">…</span>", "drawnAs": "html", "warnings": [], "number": null}
```

A formula that fails gives `{"id": …, "error": {"kind", "message", "hints", "span", "in", "diagnostics"}}` instead, and the command exits with 1 once every line is done; with `throwOnError: false`, it renders in the error color, as `drawnAs: "error"`. A line that isn't such an object gives an error of kind `input`, and the exit code 2; a failure inside Typlet itself, which would be a bug, gives one of kind `internal` for that line, and the batch goes on. Warnings are part of each result rather than printed, and `strict: "error"` makes them errors. Numbered display equations count up across the lines; `"equationCounter": 0` on a line restarts the count, for a new document. Blank lines are skipped, and so is a byte order mark before the first line. With `--output`, the results go to the file as they arrive, as to standard output.

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

## Static site generators

The plugins fit the generators built on rehype or markdown-it, which render at build time, in Node. Each page needs Typlet's stylesheet, `typlet/fonts/typlet.css`, which loads the fonts.

### VitePress

VitePress renders Markdown with markdown-it. Add the plugin in `.vitepress/config.ts`, and leave VitePress's own `markdown.math` option off:

```ts
import { defineConfig } from 'vitepress';
import markdownItTyplet from 'markdown-it-typlet';

export default defineConfig({
  markdown: {
    config(md) {
      md.use(markdownItTyplet, { preamble: '#let RR = $bb(R)$' });
    },
  },
});
```

The theme loads the stylesheet, in `.vitepress/theme/index.ts`:

```ts
import DefaultTheme from 'vitepress/theme';
import 'typlet/fonts/typlet.css';

export default DefaultTheme;
```

### Docusaurus

Docusaurus renders MDX with remark and rehype. In `docusaurus.config.js`, an ES module as the plugins are, give the docs and the blog remark-math and rehype-typlet, and add the stylesheet:

```js
import remarkMath from 'remark-math';
import rehypeTyplet from 'rehype-typlet';

export default {
  presets: [
    ['classic', {
      docs: { remarkPlugins: [remarkMath], rehypePlugins: [[rehypeTyplet, { preamble: '#let RR = $bb(R)$' }]] },
      blog: { remarkPlugins: [remarkMath], rehypePlugins: [rehypeTyplet] },
    }],
  ],
  stylesheets: [{ href: 'https://cdn.jsdelivr.net/npm/typlet@0.1.1/fonts/typlet.css', type: 'text/css' }],
};
```

### Hexo

Hexo renders Markdown with [hexo-renderer-markdown-it](https://github.com/hexojs/hexo-renderer-markdown-it), which loads the plugins `_config.yml` names with `require()`. `markdown-it-typlet` is an ES module, which `require()` loads on Node 22.12 or later:

```yaml
markdown:
  plugins:
    - name: markdown-it-typlet
      options:
        preamble: '#let RR = $bb(R)$'
```

A script in `scripts/`, which Hexo runs at startup, puts the stylesheet in every page's head:

```js
hexo.extend.injector.register('head_end', '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/typlet@0.1.1/fonts/typlet.css">');
```

## Typst's HTML export

Typst's experimental HTML export, `typst compile --features html --format html`, writes equations as MathML, for the browser to lay out. To have Typlet lay them out as Typst does on pages, write formulas through the helper in [contrib/typlet.typ](https://github.com/dbccccccc/Typlet/blob/main/contrib/typlet.typ), copied next to the document:

```typst
#import "typlet.typ": typlet-math, typlet-assets
#typlet-assets(preamble: "#set math.equation(numbering: \"(1)\")")

Let #typlet-math(`x^2 + y^2 = z^2`) hold. Then
#typlet-math(`sum_(i=1)^n i = (n(n+1))/2`, block: true)
```

`typlet-math` takes the formula as a raw block or a string, `block: true` for a display equation, and a `preamble` of definitions and set rules for that formula. In HTML export it writes a `<typlet-math>` element with the formula in its `source` attribute, where the line breaks of a raw block survive the export, and with `display` and `preamble` attributes, which `typlet/contrib/element` renders in the browser; in paged output it is an equation like any other, which `eval` makes from the source. `typlet-assets` writes the stylesheet and the scripts once, from jsDelivr unless `base` names a copy of the package's `fonts/` and `dist/` served with the page, and its `preamble` applies to every formula of the document, in HTML export and on pages alike, before the formula's own; numbered equations count up through the page. The helper needs `target()`, which Typst 0.15 has; Typst 0.13 and 0.14 have it only with `--features html`, so pass the flag to paged compilations too.
