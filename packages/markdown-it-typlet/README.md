# markdown-it-typlet

A [markdown-it](https://github.com/markdown-it/markdown-it) plugin that renders Typst math with [Typlet](https://github.com/dbccccccc/Typlet#readme).

```bash
npm install markdown-it-typlet
```

```js
import MarkdownIt from 'markdown-it';
import markdownItTyplet from 'markdown-it-typlet';

const md = new MarkdownIt().use(markdownItTyplet, { preamble: '#let RR = $bb(R)$' });
md.render('Let $f: RR -> RR$.\n\n$$\nsum_(i=1)^n i = (n(n+1))/2\n$$\n');
```

Pages need Typlet's stylesheet and fonts: `typlet/fonts/typlet.css`.

## Syntax

By default the plugin reads Markdown's math syntax:
- `$x$` is an inline formula. As in Pandoc, the opening `$` must come before a non-space, and the first `$` after it must follow a non-space and come before a non-digit, so "$5 and $10" stays text. `\$` is a dollar sign.
- `$$x$$` is a display formula, in a paragraph or on a line of its own.
- `$$` on lines of their own surround a display formula over several lines.

With `delimiters: 'typst'`, formulas follow Typst's syntax instead: `$x$` is inline, and `$ x $`, with spaces inside both dollar signs, is display. Formulas end where Typst ends them, so `$#box[$x$]$` is one formula.

## Options

`delimiters`, and Typlet's render options, such as `output`, `preamble`, `trust` and the budgets. A formula that fails renders its source in the error color, unless `throwOnError` is `true`. Each `md.render` call numbers its equations from 1, when a preamble's set rule numbers them.

## License

MIT
