// A program that uses the packed markdown-it plugin, type-checked against
// the types of markdown-it 14 and 15 by scripts/check-package.mjs.
import MarkdownIt from 'markdown-it';
import markdownItTyplet, { type Options } from 'markdown-it-typlet';

const options: Options = { output: 'mathml', delimiters: 'typst', maxElements: 100 };
const md = new MarkdownIt().use(markdownItTyplet, options);
const html: string = md.render('Let $x$.');
void html;
