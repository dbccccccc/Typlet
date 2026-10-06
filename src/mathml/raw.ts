// Ported from Typst 0.15.1: crates/typst-library/src/text/raw.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// Raw code in HTML, as Typst shows values like `#auto` in math: a `<code>`
// element whose Typst syntax is colored with Typst's default theme. The
// scope matching is adapted from syntect 5.3.0 (MIT License), which Typst
// uses for themes; see THIRD_PARTY_NOTICES.md.

import { LinkedTree, TM_SCOPES, highlight } from '../syntax/highlight.js';
import { splitNewlines } from '../syntax/lexer.js';
import { parse, parseCode, parseMath } from '../syntax/parser.js';
import { type HtmlElement, type HtmlNode, convertChildren, elem, pushCss } from './html.js';

/** Typst's default raw theme, "Typst Light": selectors and foreground colors. */
const RAW_THEME: ReadonlyArray<readonly [selectors: string, color: string | null]> = [
  ['comment', '#74747c'],
  ['constant.character.escape', '#1d6c76'],
  ['markup.bold', null],
  ['markup.italic', null],
  ['markup.underline', null],
  ['markup.raw', '#6b6b6f'],
  ['string.other.math.typst', null],
  ['punctuation.definition.math', '#198810'],
  ['keyword.operator.math, punctuation.math.typst', '#1d6c76'],
  ['markup.heading, entity.name.section', null],
  ['markup.heading.typst', null],
  ['punctuation.definition.list', '#8b41b1'],
  ['markup.list.term', null],
  ['entity.name.label, markup.other.reference', '#1d6c76'],
  ['keyword, constant.language, variable.language', '#d73948'],
  ['storage.type, storage.modifier', '#d73948'],
  ['constant', '#b60157'],
  ['string', '#198810'],
  ['entity.name, variable.function, support', '#4b69c6'],
  ['support.macro', '#16718d'],
  ['meta.annotation', '#301414'],
  ['entity.other, meta.interpolation', '#8b41b1'],
  ['meta.diff.range', '#8b41b1'],
  ['markup.inserted, meta.diff.header.to-file', '#198810'],
  ['markup.deleted, meta.diff.header.from-file', '#d73948'],
  ['meta.mapping.key.json string.quoted.double.json', '#4b69c6'],
  ['meta.mapping.value.json string.quoted.double.json', '#198810'],
];

const atoms = (scope: string) => scope.split('.');

/** Whether a scope selector's atoms are a prefix of a scope's. */
function isPrefix(selector: string[], scope: string[]): boolean {
  return selector.length <= scope.length && selector.every((atom, i) => atom === scope[i]);
}

/**
 * How well a selector path (scopes separated by spaces, each matching a
 * deeper scope of the stack) matches a scope stack, like syntect's
 * `ScopeSelector::does_match`. `null` if it doesn't match.
 */
function matchPower(selector: string, stack: string[][]): number | null {
  const scopes = selector.trim().split(/\s+/).map(atoms);
  let index = 0;
  let score = 0;
  for (let i = 0; i < stack.length; i++) {
    const sel = scopes[index]!;
    if (isPrefix(sel, stack[i]!)) {
      score += sel.length * 2 ** (3 * i);
      index++;
      if (index >= scopes.length) return score;
    }
  }
  return null;
}

/** The foreground color of a scope stack, or `null` for the default, like syntect's `style_for_stack`. */
function foregroundFor(stack: string[][]): string | null {
  const matching: [number, string | null][] = [];
  for (const [selectors, color] of RAW_THEME) {
    let best: number | null = null;
    for (const selector of selectors.split(',')) {
      const power = matchPower(selector, stack);
      if (power !== null && (best === null || power > best)) best = power;
    }
    if (best !== null) matching.push([best, color]);
  }
  // Apply the matches from the weakest to the strongest; a stable sort keeps
  // the theme's order for equal scores.
  matching.sort((a, b) => a[0] - b[0]);
  let color: string | null = null;
  for (const [, c] of matching) if (c !== null) color = c;
  return color;
}

/** Typst code as highlighted HTML nodes: text, and colored spans. */
function highlightTypst(text: string, lang: 'typ' | 'typc' | 'typm'): HtmlNode[] {
  const root = lang === 'typc' ? parseCode(text) : lang === 'typm' ? parseMath(text) : parse(text);
  const out: HtmlNode[] = [];
  const visit = (node: LinkedTree, stack: string[][]) => {
    if (node.node.children.length === 0) {
      const color = foregroundFor(stack);
      const segment = text.slice(node.offset, node.offset + node.node.len);
      splitNewlines(segment).forEach((line, i) => {
        if (i > 0) out.push(elem('br'));
        if (line === '') return;
        if (color === null) {
          out.push(line);
        } else {
          const span = elem('span', convertChildren([line]));
          pushCss(span, 'color', color);
          out.push(span);
        }
      });
    }
    for (const child of node.children()) {
      const tag = highlight(child);
      visit(child, tag === null ? stack : [...stack, atoms(TM_SCOPES[tag])]);
    }
  };
  visit(new LinkedTree(root), []);
  return out;
}

/** A raw element as HTML: inline `<code>`, highlighted for Typst code. */
export function rawToHtml(text: string, lang: string | null): HtmlElement {
  const code = lang?.toLowerCase() ?? null;
  const children =
    code === 'typ' || code === 'typst' || code === 'typc' || code === 'typm'
      ? highlightTypst(text, code === 'typst' ? 'typ' : code)
      : [text];
  const node = elem('code', convertChildren(children));
  if (lang !== null) node.attrs.push(['data-lang', lang]);
  node.external = true;
  return node;
}
