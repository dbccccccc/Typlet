// Ported from Typst 0.15.1: crates/typst-eval/src/markup.rs, crates/typst-syntax/src/ast.rs, crates/typst-library/src/model/link.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// Markup inside content blocks: text, strong and emphasized text, escapes,
// shorthands, raw text, links, equations and embedded code. Document
// elements such as headings and lists are refused.

import { type LinkedNode, firstOfKind, isExpr } from '../syntax/ast.js';
import { SyntaxKind, isStmt } from '../syntax/kind.js';
import { evalExpr } from './code.js';
import { type Content, type LinkElem, type RawElem, sequence, styled, textElem } from './content.js';
import { type Span, bailAt, unsupported } from './diag.js';
import { evalSetRule } from './rules.js';
import { singleSymbol } from './symbol.js';
import { type Value, display } from './value.js';
import type { Vm } from './vm.js';

const K = SyntaxKind;

/** Evaluates markup, like `Eval for ast::Markup`. */
export function evalMarkup(vm: Vm, markup: LinkedNode): Content {
  return evalMarkupFrom(vm, markupExprs(markup), 0);
}

/**
 * The expressions of markup, including spaces, like `Markup::exprs`: a line
 * break right after a statement without a semicolon is left out.
 */
export function markupExprs(markup: LinkedNode): LinkedNode[] {
  let wasStmt = false;
  return markup.children().filter((node) => {
    const keep = !wasStmt || node.kind !== K.Space;
    wasStmt = isStmt(node.kind);
    return keep && (node.kind === K.Space || isExpr(node));
  });
}

/** Evaluates the markup expressions from `start`; set rules style the rest. */
function evalMarkupFrom(vm: Vm, list: LinkedNode[], start: number): Content {
  const flow = vm.flow;
  vm.flow = null;
  const seq: Content[] = [];
  for (let i = start; i < list.length; i++) {
    const expr = list[i]!;
    if (expr.kind === K.SetRule) {
      const styles = evalSetRule(vm, expr);
      if (vm.flow) break;
      seq.push(styled(evalMarkupFrom(vm, list, i + 1), styles));
      break;
    }
    if (expr.kind === K.ShowRule) unsupported(expr.span, '`show` rules');
    const value = evalExpr(vm, expr);
    if (value.type === 'label') attachLabel(vm, seq, value.v, expr.span);
    else seq.push(display(value, expr.span));
    if (vm.flow) break;
  }
  if (flow) vm.flow = flow;
  return sequence(seq);
}

/** Attaches a label to the last content that can have one, like `eval_markup`. */
function attachLabel(vm: Vm, seq: Content[], label: string, span: Span): void {
  for (let i = seq.length - 1; i >= 0; i--) {
    const elem = seq[i]!;
    if (elem.func === 'space' || elem.func === 'parbreak') continue;
    if (elem.label !== undefined) {
      vm.warn(elem.span, 'content labelled multiple times', 'only the last label is used, the rest are ignored');
    }
    seq[i] = { ...elem, label };
    return;
  }
  vm.warn(span, `label \`<${label}>\` is not attached to anything`);
}

/** A content block: `[*x*]`, with a scope of its own. */
export function evalContentBlock(vm: Vm, node: LinkedNode): Content {
  vm.scopes.enter();
  try {
    return evalMarkup(vm, firstOfKind(node, K.Markup)!);
  } finally {
    vm.scopes.exit();
  }
}

/** The markup shorthands, like `Shorthand::LIST`. */
const SHORTHANDS: Readonly<Record<string, string>> = {
  '...': '…',
  '~': ' ',
  '-': '−',
  '--': '–',
  '---': '—',
  '-?': '­',
};

/** Evaluates a markup expression, or returns `undefined` if `node` is none. */
export function evalMarkupExpr(vm: Vm, node: LinkedNode): Value | undefined {
  const span = node.span;
  switch (node.kind) {
    case K.Text:
      return { type: 'content', v: textElem(node.text, span) };
    case K.Parbreak:
      return { type: 'content', v: { func: 'parbreak', span } };
    case K.Shorthand:
      return { type: 'symbol', v: singleSymbol(SHORTHANDS[node.text] ?? '\0') };
    case K.SmartQuote:
      return { type: 'content', v: { func: 'smartquote', double: node.text === '"', span } };
    case K.Strong:
      return { type: 'content', v: { func: 'strong', body: evalMarkup(vm, firstOfKind(node, K.Markup)!), span } };
    case K.Emph:
      return { type: 'content', v: { func: 'emph', body: evalMarkup(vm, firstOfKind(node, K.Markup)!), span } };
    case K.Raw:
      return { type: 'content', v: evalRaw(node) };
    case K.Link:
      return { type: 'content', v: linkFromUrl(node.text, span) };
    case K.Label:
      return { type: 'label', v: node.text.replace(/^<|>$/g, '') };
    case K.Ref:
      return unsupported(span, 'references');
    case K.Heading:
      return unsupported(span, 'headings');
    case K.ListItem:
    case K.EnumItem:
    case K.TermItem:
      return unsupported(span, 'lists');
    default:
      return undefined;
  }
}

/** Raw text: `` `x` ``, like `Eval for ast::Raw`. */
function evalRaw(node: LinkedNode): RawElem {
  const children = node.children();
  const delim = children.find((c) => c.kind === K.RawDelim);
  const blocky = delim !== undefined && delim.text.length >= 3;
  const lines = children.filter((c) => c.kind === K.Text).map((c) => c.text);
  const lang = blocky ? (children.find((c) => c.kind === K.RawLang)?.text ?? null) : null;
  const block = blocky && children.some((c) => c.kind === K.RawTrimmed && /[\n\r\u000b\u000c\u0085\u2028\u2029]/.test(c.text));
  const elem: RawElem = { func: 'raw', text: lines.join('\n'), block, span: node.span };
  return lang === null ? elem : { ...elem, lang };
}

/** A link written as a URL in markup, like `LinkElem::from_url`. */
export function linkFromUrl(url: string, span: Span): LinkElem {
  if (url.length > 8000) bailAt(span, 'URL is too long');
  // The body leaves out `mailto:` and `tel:`.
  let text = url;
  for (const prefix of ['mailto:', 'tel:']) while (text.startsWith(prefix)) text = text.slice(prefix.length);
  return { func: 'link', dest: url, body: textElem(text), span };
}
