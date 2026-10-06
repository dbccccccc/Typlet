// Ported from Typst 0.15.1: crates/typst-html/src/encode.rs, crates/typst-html/src/charsets.rs, crates/typst-html/src/css/encode.rs, crates/typst-html/src/convert.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// A minimal HTML tree and its serialization, escaping text and attributes as
// Typst's HTML export does, and protecting whitespace that browsers would
// otherwise collapse.

import { roundWithPrecision, rustDisplayFloat } from '../eval/repr.js';
import { type Length, absToPt } from '../eval/layout.js';
import { isDefaultIgnorable } from '../syntax/unicode.js';

/** An HTML element. Attributes keep their order; CSS properties become a `style` attribute. */
export interface HtmlElement {
  readonly tag: string;
  attrs: [string, string][];
  /** CSS properties, kept sorted by name as Typst's `css::Properties` does. */
  css: [string, string][];
  children: HtmlNode[];
  /** Set for HTML from non-math content, which MathML attributes don't apply to. */
  external?: boolean;
  /** Set for spans that protect whitespace; their text is fully escaped. */
  preSpan?: boolean;
}

export type HtmlNode = HtmlElement | string;

export function elem(tag: string, children: HtmlNode[] = [], attrs: [string, string][] = []): HtmlElement {
  return { tag, attrs, css: [], children };
}

/** Adds an attribute if the value is not `null`. */
export function withAttr(element: HtmlElement, name: string, value: string | null | undefined): HtmlElement {
  if (value !== null && value !== undefined) element.attrs.push([name, value]);
  return element;
}

/** Adds a CSS property, replacing one with the same name. */
export function pushCss(element: HtmlElement, name: string, value: string): void {
  const i = element.css.findIndex(([n]) => n >= name);
  if (i >= 0 && element.css[i]![0] === name) element.css[i] = [name, value];
  else if (i >= 0) element.css.splice(i, 0, [name, value]);
  else element.css.push([name, value]);
}

/** MathML elements written as self-closing tags. */
const SELF_CLOSING = new Set(['mprescripts', 'mspace']);
// HTML's void elements, which have no end tag.
const VOID = new Set(['br']);

/** Serializes HTML without whitespace between elements. */
export function encode(node: HtmlNode): string {
  if (typeof node === 'string') return escapeText(node);
  // A fragment is its children.
  if (node.tag === '') return node.children.map(encode).join('');
  let out = '<' + node.tag;
  let attrs = node.attrs;
  if (node.css.length > 0) {
    const generated = node.css.map(([n, v]) => `${n}: ${v}`).join('; ');
    attrs = [...attrs];
    const i = attrs.findIndex(([n]) => n === 'style');
    if (i >= 0) attrs[i] = ['style', attrs[i]![1] === '' ? generated : `${generated}; ${attrs[i]![1]}`];
    else attrs.push(['style', generated]);
  }
  for (const [name, value] of attrs) {
    out += ' ' + name;
    if (value !== '') out += '="' + escapeAttr(value) + '"';
  }
  if (SELF_CLOSING.has(node.tag)) return `${out}/>`;
  if (VOID.has(node.tag)) return `${out}>`;
  out += '>';
  for (const child of node.children) {
    out += typeof child === 'string' && node.preSpan ? [...child].map(escapeChar).join('') : encode(child);
  }
  return `${out}</${node.tag}>`;
}

function escapeChar(c: string): string {
  switch (c) {
    case '&':
      return '&amp;';
    case '<':
      return '&lt;';
    case '>':
      return '&gt;';
    case '"':
      return '&quot;';
    case "'":
      return '&apos;';
    default:
      return `&#x${c.codePointAt(0)!.toString(16)};`;
  }
}

/** Whether a character may appear in HTML text as it is, like `is_w3c_text_char`. */
function isTextChar(c: number): boolean {
  if ((c >= 0xfdd0 && c <= 0xfdef) || ((c & 0xfffe) === 0xfffe && c <= 0x10ffff)) return false;
  if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20;
  return true;
}

/** Whether text has `&`, the given special character, or a character that isn't text. */
function needsEscape(text: string, special: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.codePointAt(i)!;
    if (text[i] === '&' || text[i] === special || !isTextChar(c)) return true;
    if (c > 0xffff) i++;
  }
  return false;
}

function escapeText(text: string): string {
  if (!needsEscape(text, '<')) return text;
  let out = '';
  for (const c of text) {
    out += c === '&' || c === '<' || !isTextChar(c.codePointAt(0)!) ? escapeChar(c) : c;
  }
  return out;
}

function escapeAttr(text: string): string {
  if (!needsEscape(text, '"')) return text;
  let out = '';
  for (const c of text) {
    out += c === '&' || c === '"' || !isTextChar(c.codePointAt(0)!) ? escapeChar(c) : c;
  }
  return out;
}

// --- CSS values ------------------------------------------------------------

/** A number in CSS: four decimal digits at most. */
function cssNumber(value: number): string {
  return rustDisplayFloat(roundWithPrecision(value, 4));
}

/** An em length in CSS, like `Em::to_css`. */
export function emToCss(em: number): string {
  return `${cssNumber(em)}em`;
}

/** A length in CSS: one unit, a sum in `calc()`, or `0`, like `Length::to_css`. */
export function lengthToCss(length: Length): string {
  const parts: [number, string][] = [];
  if (length.em !== 0) parts.push([length.em, 'em']);
  if (length.abs !== 0) parts.push([absToPt(length.abs), 'pt']);
  return calc(parts);
}

/** A relative length in CSS, like `Rel::to_css`. */
export function relToCss(rel: { rel: number; abs: Length }): string {
  const parts: [number, string][] = [];
  if (rel.rel !== 0) parts.push([rel.rel * 100, '%']);
  if (rel.abs.em !== 0) parts.push([rel.abs.em, 'em']);
  if (rel.abs.abs !== 0) parts.push([absToPt(rel.abs.abs), 'pt']);
  return calc(parts);
}

function calc(parts: [number, string][]): string {
  if (parts.length === 0) return '0';
  const format = ([value, unit]: [number, string]) =>
    unit === '%' ? `${rustDisplayFloat(roundWithPrecision(value, 2))}%` : `${cssNumber(value)}${unit}`;
  let out = format(parts[0]!);
  for (const part of parts.slice(1)) {
    out += part[0] < 0 ? ` - ${format([-part[0], part[1]])}` : ` + ${format(part)}`;
  }
  return parts.length > 1 ? `calc(${out})` : out;
}

// --- Whitespace --------------------------------------------------------------
//
// Browsers collapse runs of spaces and spaces at the edges of a block. Typst
// wraps such whitespace in `<span style="white-space: pre-wrap">`: runs of
// spaces and tabs while converting text, and single spaces in a pass over the
// whole block afterwards.

/** Wraps whitespace nodes in a span that keeps them from collapsing. */
function preWrap(nodes: HtmlNode[]): HtmlElement {
  const span = elem('span', nodes);
  pushCss(span, 'white-space', 'pre-wrap');
  span.preSpan = true;
  return span;
}

type Kind = 'space' | 'tab' | 'newline' | 'ignorable';

/** The elements Typlet makes whose default display is `block`: they collapse the spaces next to them. */
const BLOCK_LEVEL: ReadonlySet<string> = new Set(['div', 'p', 'pre']);

function kindOf(c: string): Kind | null {
  if (c === ' ') return 'space';
  if (c === '\t') return 'tab';
  if (c === '\r' || c === '\n') return 'newline';
  if (isDefaultIgnorable(c.codePointAt(0)!)) return 'ignorable';
  return null;
}

/** Whether text has a space, tab, line break or default-ignorable character. */
function hasSpecialWhitespace(text: string): boolean {
  for (const c of text) if (kindOf(c) !== null) return true;
  return false;
}

/** Whether text has a character that isn't default-ignorable. */
function hasVisible(text: string): boolean {
  for (const c of text) if (!isDefaultIgnorable(c.codePointAt(0)!)) return true;
  return false;
}

/**
 * Converts text and elements into the children of an element, like Typst's
 * `Converter`: text is split around special whitespace, and runs of more than
 * one space or tab are wrapped.
 */
export function convertChildren(items: readonly HtmlNode[]): HtmlNode[] {
  // Most text has no special whitespace at all.
  if (items.length === 1 && typeof items[0] === 'string' && !hasSpecialWhitespace(items[0])) return [items[0]];
  const output: HtmlNode[] = [];
  let trailing: { single: boolean; from: number } | null = null;

  const flush = () => {
    if (trailing && !trailing.single) output.push(preWrap(output.splice(trailing.from)));
    trailing = null;
  };
  const push = (node: HtmlNode) => {
    if (node === ' ' || node === '\t') {
      if (trailing) trailing.single = false;
      else trailing = { single: node === ' ', from: output.length };
    } else {
      flush();
    }
    output.push(node);
  };

  for (const item of items) {
    if (typeof item !== 'string') {
      push(item);
      continue;
    }
    const chars = [...item];
    let emitted = '';
    let prevKind: Kind | null | undefined;
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i]!;
      const kind = kindOf(c);
      const prev = prevKind;
      prevKind = kind;
      if (kind === null) {
        emitted += c;
        continue;
      }
      // A space between ordinary characters is safe as it is.
      const after = chars[i + 1];
      if (kind === 'space' && prev === null && after !== undefined && kindOf(after) === null) {
        emitted += c;
        continue;
      }
      if (emitted !== '') push(emitted);
      emitted = '';
      if (kind === 'newline') {
        // A CR before an LF is skipped; the LF turns into a line break.
        if (c === '\r' && after === '\n') continue;
        push(elem('br'));
      } else {
        push(c);
      }
    }
    if (emitted !== '') push(emitted);
  }
  flush();
  return output;
}

/**
 * Protects single spaces that would collapse, like Typst's `protect_spaces`:
 * spaces at the edges of the block, and spaces next to other spaces. The
 * nodes are one block-level context.
 */
export function protectSpaces(nodes: HtmlNode[]): void {
  type State = { kind: 'collapsing' } | { kind: 'supportive' } | { kind: 'space'; list: HtmlNode[]; index: number };
  let state: State = { kind: 'collapsing' };
  const protect = (list: HtmlNode[], index: number) => {
    list[index] = preWrap([list[index]!]);
  };
  const collapsing = () => {
    if (state.kind === 'space') protect(state.list, state.index);
    state = { kind: 'collapsing' };
  };
  const visit = (list: HtmlNode[]) => {
    for (let i = 0; i < list.length; i++) {
      const node = list[i]!;
      if (typeof node === 'string') {
        if (node === ' ') {
          if (state.kind === 'collapsing') {
            protect(list, i);
            state = { kind: 'supportive' };
          } else if (state.kind === 'supportive') {
            state = { kind: 'space', list, index: i };
          } else {
            protect(state.list, state.index);
            state = { kind: 'space', list, index: i };
          }
        } else if (hasVisible(node)) {
          state = { kind: 'supportive' };
        }
      } else if (node.tag === 'br' || BLOCK_LEVEL.has(node.tag)) {
        // Block-level elements are contexts of their own, with their spaces
        // already protected.
        collapsing();
      } else if (!node.preSpan) {
        visit(node.children);
      }
    }
  };
  visit(nodes);
  collapsing();
}
