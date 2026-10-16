import MarkdownIt from 'markdown-it';
import markdownItTyplet, { type Options } from 'markdown-it-typlet';

const options: Options = { output: 'mathml', delimiters: 'typst', maxElements: 100 };
const md = new MarkdownIt().use(markdownItTyplet, options);
const html: string = md.render('Let $x$.');
void html;
