// @ts-check
// Typlet original: not ported from Typst.
//
// A markdown-it plugin that renders math with Typlet. By default it reads
// Markdown's math syntax: `$x$` is inline, `$$x$$` is display, and `$$` on
// lines of their own surround a display formula. With `delimiters: 'typst'`,
// formulas follow Typst's syntax instead: `$x$` is inline and `$ x $`, with
// spaces inside both dollar signs, is display.

/**
 * @import {MarkdownIt, RendererRule, StateBlock, StateInline} from 'markdown-it'
 * @import {RenderOptions} from 'typlet'
 */

import { SyntaxKind, parse, renderToString } from 'typlet';

/**
 * @typedef {RenderOptions & {
 *   delimiters?: 'markdown' | 'typst' | undefined,
 * }} Options
 *   Typlet's render options, and which math syntax to read. Invalid formulas
 *   render their source in the error color unless `throwOnError` is `true`.
 */

const DOLLAR = 0x24;
const BACKSLASH = 0x5c;
const QUOTE = 0x22;

/** @param {number} c */
const isSpace = (c) => c === 0x20 || c === 0x09 || c === 0x0a;

/**
 * The end of the equation that starts at a dollar sign, as Typst parses it,
 * and whether it is a display equation, or `null` if it never ends. The
 * parser sees a window of the text at a time: an equation that runs past the
 * window looks unterminated, and the window grows.
 *
 * @param {string} text
 * @param {number} start
 * @returns {{end: number, display: boolean} | null}
 */
function typstEquation(text, start) {
  for (let window = 256; ; window *= 4) {
    const equation = parse(text.slice(start, start + window), { mode: 'markup' }).children[0];
    const children = equation?.children ?? [];
    if (equation?.kind === SyntaxKind.Equation && children.length >= 2 && children.at(-1)?.kind === SyntaxKind.Dollar) {
      // Typst's rule: spaces right inside both dollar signs make a block.
      const display = children[1]?.kind === SyntaxKind.Space && children.at(-2)?.kind === SyntaxKind.Space;
      return { end: start + equation.len, display };
    }
    if (start + window >= text.length) return null;
  }
}

/**
 * Where Markdown math that starts at `start` closes with `close`, or -1: the
 * first `close` that isn't escaped or in one of Typst's strings, which may
 * hold dollar signs. As in Pandoc and markdown-it-katex, a single `$`
 * closes only after a non-space and before a non-digit; if the first one
 * can't, the math never closes, so that "$5 and $10" stays text.
 *
 * @param {string} src
 * @param {number} start
 * @param {number} max
 * @param {'$' | '$$'} close
 * @returns {number}
 */
function findClose(src, start, max, close) {
  for (let i = start; i < max; i++) {
    const c = src.charCodeAt(i);
    if (c === BACKSLASH) {
      i++;
    } else if (c === QUOTE) {
      for (i++; i < max && src.charCodeAt(i) !== QUOTE; i++) if (src.charCodeAt(i) === BACKSLASH) i++;
    } else if (src.startsWith(close, i) && i + close.length <= max) {
      if (close === '$$') return i;
      const after = src.charCodeAt(i + 1);
      return !isSpace(src.charCodeAt(i - 1)) && !(after >= 0x30 && after <= 0x39) ? i : -1;
    }
  }
  return -1;
}

/**
 * Inline math in Markdown's syntax: `$x$`, and `$$x$$` as a display formula.
 *
 * @param {StateInline} state
 * @param {boolean} silent
 */
function inlineMarkdown(state, silent) {
  const { src, pos, posMax } = state;
  if (src.charCodeAt(pos) !== DOLLAR) return false;
  const double = src.charCodeAt(pos + 1) === DOLLAR;
  const delimiter = double ? '$$' : '$';
  // A single `$` opens only before a non-space, as in Pandoc.
  if (!double && (pos + 1 >= posMax || isSpace(src.charCodeAt(pos + 1)))) return false;
  const end = findClose(src, pos + delimiter.length, posMax, delimiter);
  if (end < 0 || end === pos + delimiter.length) return false;
  if (!silent) {
    const token = state.push('typlet_inline', 'math', 0);
    token.content = src.slice(pos + delimiter.length, end);
    token.markup = delimiter;
    token.meta = { display: double };
  }
  state.pos = end + delimiter.length;
  return true;
}

/**
 * Inline math in Typst's syntax: `$x$`, and `$ x $` as a display formula.
 *
 * @param {StateInline} state
 * @param {boolean} silent
 */
function inlineTypst(state, silent) {
  const { src, pos, posMax } = state;
  if (src.charCodeAt(pos) !== DOLLAR) return false;
  const equation = typstEquation(src.slice(0, posMax), pos);
  if (!equation) return false;
  if (!silent) {
    const token = state.push('typlet_inline', 'math', 0);
    token.content = src.slice(pos + 1, equation.end - 1);
    token.markup = '$';
    token.meta = { display: equation.display };
  }
  state.pos = equation.end;
  return true;
}

/**
 * A display formula between `$$` lines, as in markdown-it-katex: `$$` opens
 * a line, and the formula ends on the line that ends with `$$`.
 *
 * @param {StateBlock} state
 * @param {number} startLine
 * @param {number} endLine
 * @param {boolean} silent
 */
function blockMarkdown(state, startLine, endLine, silent) {
  /** @param {number} line */
  const start = (line) => (state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0);
  /** @param {number} line */
  const end = (line) => state.eMarks[line] ?? 0;
  /** @param {number} line */
  const indent = (line) => state.sCount[line] ?? 0;
  let pos = start(startLine);
  let max = end(startLine);
  // Indented code, four spaces or more, isn't math.
  if (indent(startLine) - state.blkIndent >= 4) return false;
  if (pos + 2 > max || state.src.slice(pos, pos + 2) !== '$$') return false;
  if (silent) return true;

  let first = state.src.slice(pos + 2, max);
  let last = '';
  let found = false;
  let next = startLine;
  if (first.trim().endsWith('$$')) {
    first = first.trim().slice(0, -2);
    found = true;
  }
  while (!found) {
    next++;
    if (next >= endLine) break;
    pos = start(next);
    max = end(next);
    // A non-empty line with less indentation ends a list item, and the formula.
    if (pos < max && indent(next) < state.blkIndent) break;
    if (state.src.slice(pos, max).trim().endsWith('$$')) {
      last = state.src.slice(pos, state.src.slice(0, max).lastIndexOf('$$'));
      found = true;
    }
  }
  if (!found) return false;

  state.line = next + 1;
  const token = state.push('typlet_block', 'math', 0);
  token.block = true;
  // The lines between the delimiters, with what shares their lines.
  token.content = [first, state.getLines(startLine + 1, next, indent(startLine), true), last].join('\n').trim();
  token.map = [startLine, state.line];
  token.markup = '$$';
  return true;
}

/**
 * Renders math with Typlet. Each document, one `md.render` call, numbers its
 * equations from 1.
 *
 * @param {MarkdownIt} md
 * @param {Options} [options]
 */
export default function markdownItTyplet(md, options = {}) {
  const { delimiters = 'markdown', ...renderOptions } = options;

  /**
   * @param {string} source
   * @param {boolean} displayMode
   * @param {Record<string, any>} env The render call's environment, which holds the document's counter.
   */
  const render = (source, displayMode, env) => {
    /** @type {{value: number}} */
    const equationCounter = renderOptions.equationCounter ?? (env.typletEquationCounter ??= { value: 0 });
    return renderToString(source, { throwOnError: false, ...renderOptions, displayMode, equationCounter });
  };

  md.inline.ruler.after('escape', 'typlet_inline', delimiters === 'typst' ? inlineTypst : inlineMarkdown);
  if (delimiters === 'markdown') {
    md.block.ruler.after('blockquote', 'typlet_block', blockMarkdown, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  }
  /** @type {RendererRule} */
  const inline = (tokens, idx, _options, env) => render(tokens[idx]?.content ?? '', Boolean(tokens[idx]?.meta?.display), env ?? {});
  /** @type {RendererRule} */
  const block = (tokens, idx, _options, env) => `${render(tokens[idx]?.content ?? '', true, env ?? {})}\n`;
  md.renderer.rules.typlet_inline = inline;
  md.renderer.rules.typlet_block = block;
}
