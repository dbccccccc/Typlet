# rehype-typlet

A [rehype](https://github.com/rehypejs/rehype) plugin that renders Typst math with [Typlet](https://github.com/dbccccccc/Typlet#readme), like rehype-katex does for LaTeX.

It renders the elements [remark-math](https://github.com/remarkjs/remark-math) makes for `$x$` (inline) and `$$` blocks (display), and code fenced as ```` ```math ````.

```bash
npm install rehype-typlet
```

```js
import rehypeStringify from 'rehype-stringify';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import rehypeTyplet from 'rehype-typlet';

const file = await unified()
  .use(remarkParse)
  .use(remarkMath)
  .use(remarkRehype)
  .use(rehypeTyplet, { preamble: '#let RR = $bb(R)$' })
  .use(rehypeStringify)
  .process('Let $f: RR -> RR$.\n\n$$\nsum_(i=1)^n i = (n(n+1))/2\n$$\n');
```

Pages need Typlet's stylesheet and fonts: `typlet/fonts/typlet.css`.

## Options

Typlet's render options, such as `output`, `preamble`, `trust` and the budgets; `displayMode` comes from the markup.

- A formula that fails renders its source in the error color, and the failure becomes a message on the file, with the `TypletError` as its cause and the error's kind as its rule id.
- Warnings become messages on the file too, unless you pass a `strict` option.
- Each document numbers its equations from 1, when a preamble's set rule numbers them.

## License

MIT
