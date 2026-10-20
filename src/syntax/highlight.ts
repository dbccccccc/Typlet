// Ported from Typst 0.15.1: crates/typst-syntax/src/highlight.rs, crates/typst-syntax/src/node.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// Syntax highlighting tags. Typst uses them to color code in raw text, which
// is how values such as `#auto` show in math.

import { isExpr } from './ast.js';
import { SyntaxKind, isError, isTrivia } from './kind.js';
import type { SyntaxNode } from './node.js';

/** A syntax highlighting tag. */
export enum Tag {
  Comment,
  Punctuation,
  Escape,
  Strong,
  Emph,
  Link,
  Raw,
  Label,
  Ref,
  Heading,
  ListMarker,
  ListTerm,
  MathDelimiter,
  MathOperator,
  MathGroupingParens,
  Keyword,
  Operator,
  Number,
  String,
  Function,
  Interpolated,
  Error,
}

/** The TextMate scope of each tag, which themes match against. */
export const TM_SCOPES: Record<Tag, string> = {
  [Tag.Comment]: 'comment.typst',
  [Tag.Punctuation]: 'punctuation.typst',
  [Tag.Escape]: 'constant.character.escape.typst',
  [Tag.Strong]: 'markup.bold.typst',
  [Tag.Emph]: 'markup.italic.typst',
  [Tag.Link]: 'markup.underline.link.typst',
  [Tag.Raw]: 'markup.raw.typst',
  [Tag.MathDelimiter]: 'punctuation.definition.math.typst',
  [Tag.MathOperator]: 'keyword.operator.math.typst',
  [Tag.MathGroupingParens]: 'punctuation.math.typst',
  [Tag.Heading]: 'markup.heading.typst',
  [Tag.ListMarker]: 'punctuation.definition.list.typst',
  [Tag.ListTerm]: 'markup.list.term.typst',
  [Tag.Label]: 'entity.name.label.typst',
  [Tag.Ref]: 'markup.other.reference.typst',
  [Tag.Keyword]: 'keyword.typst',
  [Tag.Operator]: 'keyword.operator.typst',
  [Tag.Number]: 'constant.numeric.typst',
  [Tag.String]: 'string.quoted.double.typst',
  [Tag.Function]: 'entity.name.function.typst',
  [Tag.Interpolated]: 'meta.interpolation.typst',
  [Tag.Error]: 'invalid.typst',
};

/**
 * A node with its parent, index and offset, like Typst's `LinkedNode`, for navigating siblings and leaves.
 *
 * Modified for Typlet: raw code in a formula can be as long as the formula,
 * and a chain of field accesses nests as deep as it is long. So the tree is
 * navigated without recursion, and what highlighting looks up more than once
 * is remembered: the children, an identifier's tag and the top of its chain
 * of field accesses. That keeps highlighting linear in the code's length.
 */
export class LinkedTree {
  constructor(
    readonly node: SyntaxNode,
    readonly parent: LinkedTree | null = null,
    readonly index = 0,
    readonly offset = 0,
  ) {}

  private cached: LinkedTree[] | undefined;
  /** The tag `highlightIdent` found for this identifier, once it has. */
  identTag: Tag | null | undefined;
  /** The first ancestor that isn't a field access, once `chainTop` found it. */
  chainTop: LinkedTree | undefined;

  get kind(): SyntaxKind {
    return this.node.kind;
  }

  /** Whether this is a leaf: not an inner node (even an empty one), and not an error. */
  get isLeaf(): boolean {
    return this.node.children.length === 0 && this.node.error === null && this.node.text !== '';
  }

  /** The children, made once, so that siblings and leaves found through them are the same objects. */
  children(): LinkedTree[] {
    if (this.cached === undefined) {
      const out: LinkedTree[] = [];
      let offset = this.offset;
      this.node.children.forEach((child, index) => {
        out.push(new LinkedTree(child, this, index, offset));
        offset += child.len;
      });
      this.cached = out;
    }
    return this.cached;
  }

  get parentKind(): SyntaxKind | null {
    return this.parent?.kind ?? null;
  }

  prevSibling(): LinkedTree | null {
    if (!this.parent) return null;
    const siblings = this.parent.children();
    for (let i = this.index - 1; i >= 0; i--) if (!isTrivia(siblings[i]!.kind)) return siblings[i]!;
    return null;
  }

  nextSibling(): LinkedTree | null {
    if (!this.parent) return null;
    const siblings = this.parent.children();
    for (let i = this.index + 1; i < siblings.length; i++) if (!isTrivia(siblings[i]!.kind)) return siblings[i]!;
    return null;
  }

  leftmostLeaf(): LinkedTree | null {
    // The nodes still to look at, the next on top: a depth-first search
    // without recursion.
    const pending: LinkedTree[] = [this];
    while (pending.length > 0) {
      const node = pending.pop()!;
      if (node.isLeaf) {
        if (!isTrivia(node.kind) && !isError(node.kind)) return node;
        continue;
      }
      const children = node.children();
      for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]!);
    }
    return null;
  }

  rightmostLeaf(): LinkedTree | null {
    const pending: LinkedTree[] = [this];
    while (pending.length > 0) {
      const node = pending.pop()!;
      if (node.isLeaf) {
        if (!isTrivia(node.kind)) return node;
        continue;
      }
      for (const child of node.children()) pending.push(child);
    }
    return null;
  }

  prevLeaf(): LinkedTree | null {
    for (let node: LinkedTree | null = this; node !== null; node = node.parent) {
      for (let prev = node.prevSibling(); prev; prev = prev.prevSibling()) {
        const leaf = prev.rightmostLeaf();
        if (leaf) return leaf;
      }
    }
    return null;
  }

  nextLeaf(): LinkedTree | null {
    for (let node: LinkedTree | null = this; node !== null; node = node.parent) {
      for (let next = node.nextSibling(); next; next = next.nextSibling()) {
        const leaf = next.leftmostLeaf();
        if (leaf) return leaf;
      }
    }
    return null;
  }
}

const K = SyntaxKind;

/** Whether a kind of expression can follow a hash in markup. */
function hashable(kind: SyntaxKind): boolean {
  return [
    K.Ident, K.None, K.Auto, K.Bool, K.Int, K.Float, K.Numeric, K.Str, K.CodeBlock, K.ContentBlock,
    K.Array, K.Dict, K.Parenthesized, K.FieldAccess, K.FuncCall, K.LetBinding, K.SetRule,
    K.ShowRule, K.Contextual, K.Conditional, K.WhileLoop, K.ForLoop, K.ModuleImport,
    K.ModuleInclude, K.LoopBreak, K.LoopContinue, K.FuncReturn,
  ].includes(kind);
}

const KEYWORDS: ReadonlySet<SyntaxKind> = new Set([
  K.Not, K.And, K.Or, K.None, K.Auto, K.Let, K.Set, K.Show, K.Context, K.If, K.Else, K.For, K.In,
  K.While, K.Break, K.Continue, K.Return, K.Import, K.Include, K.As, K.Bool,
]);

const OPERATORS: ReadonlySet<SyntaxKind> = new Set([
  K.Plus, K.Minus, K.EqEq, K.ExclEq, K.Lt, K.LtEq, K.Gt, K.GtEq, K.PlusEq, K.HyphEq, K.StarEq,
  K.SlashEq, K.Dots, K.Arrow,
]);

/** The highlighting tag of a node, if any. */
export function highlight(node: LinkedTree): Tag | null {
  const kind = node.kind;
  if (KEYWORDS.has(kind)) return Tag.Keyword;
  if (OPERATORS.has(kind)) return Tag.Operator;
  switch (kind) {
    case K.Markup:
      return node.parentKind === K.TermItem && node.nextSibling()?.kind === K.Colon ? Tag.ListTerm : null;
    case K.Linebreak:
    case K.Escape:
    case K.Shorthand:
    case K.MathShorthand:
      return Tag.Escape;
    case K.Strong:
      return Tag.Strong;
    case K.Emph:
      return Tag.Emph;
    case K.Raw:
      return Tag.Raw;
    case K.Link:
      return Tag.Link;
    case K.Label:
      return Tag.Label;
    case K.Ref:
      return Tag.Ref;
    case K.Heading:
      return Tag.Heading;
    case K.ListMarker:
    case K.EnumMarker:
    case K.TermMarker:
      return Tag.ListMarker;
    case K.MathIdent:
    case K.Ident:
      return highlightIdent(node);
    case K.MathAlignPoint:
    case K.MathPrimes:
    case K.Hat:
    case K.Root:
      return Tag.MathOperator;
    case K.Hash:
      return highlightHash(node);
    case K.LeftBrace:
    case K.RightBrace:
    case K.LeftBracket:
    case K.RightBracket:
    case K.Comma:
    case K.Semicolon:
    case K.Colon:
    case K.Dot:
      return Tag.Punctuation;
    case K.LeftParen:
    case K.RightParen:
      return node.parentKind === K.Math ? Tag.MathGroupingParens : Tag.Punctuation;
    case K.Star:
      return node.parentKind === K.Strong ? null : Tag.Operator;
    case K.Underscore:
      return node.parentKind === K.MathAttach ? Tag.MathOperator : null;
    case K.Dollar:
      return Tag.MathDelimiter;
    case K.Slash:
      return node.parentKind === K.MathFrac ? Tag.MathOperator : Tag.Operator;
    case K.Eq:
      return node.parentKind === K.Heading ? null : Tag.Operator;
    case K.Int:
    case K.Float:
    case K.Numeric:
      return Tag.Number;
    case K.Str:
      return Tag.String;
    case K.Shebang:
    case K.LineComment:
    case K.BlockComment:
      return Tag.Comment;
    case K.Error:
      return Tag.Error;
    default:
      return null;
  }
}

function highlightIdent(start: LinkedTree): Tag | null {
  // Modified for Typlet: in `a.b.c`, an identifier behind a dot takes the tag
  // of the identifier before it, which typst-syntax finds by recursion. Here
  // the chain is followed in a loop, and each identifier on the way remembers
  // the tag, so that a long chain costs linear time and no stack.
  const chain: LinkedTree[] = [];
  let tag: Tag | null = null;
  for (let node: LinkedTree | null = start; node !== null; ) {
    if (node.identTag !== undefined) {
      tag = node.identTag;
      break;
    }
    chain.push(node);
    const found = identTag(node);
    if (found instanceof LinkedTree) {
      node = found;
      continue;
    }
    tag = found;
    break;
  }
  for (const node of chain) node.identTag = tag;
  return tag;
}

/** An identifier's tag, or the identifier before a dot whose tag it takes. */
function identTag(node: LinkedTree): Tag | null | LinkedTree {
  // Directly before an argument list?
  const nextLeaf = node.nextLeaf();
  if (
    nextLeaf &&
    node.offset + node.node.len === nextLeaf.offset &&
    ((nextLeaf.kind === K.LeftParen &&
      [K.Args, K.MathArgs, K.Params].includes(nextLeaf.parentKind as SyntaxKind)) ||
      (nextLeaf.kind === K.LeftBracket && nextLeaf.parentKind === K.ContentBlock))
  ) {
    return Tag.Function;
  }

  // In math?
  if (node.kind === K.MathIdent || node.kind === K.MathFieldAccess) return Tag.Interpolated;

  // Find the first ancestor that isn't a field access.
  const ancestor = chainTop(node);

  // Directly before or behind a show rule colon?
  if (
    ancestor.parentKind === K.ShowRule &&
    (nextLeaf?.kind === K.Colon || node.prevLeaf()?.kind === K.Colon)
  ) {
    return Tag.Function;
  }

  // Directly after a hash, or an ancestor field access is?
  if (ancestor.prevLeaf()?.kind === K.Hash) return Tag.Interpolated;

  // Behind a dot that is behind another identifier?
  const prev = node.prevLeaf();
  if (prev?.kind === K.Dot) {
    const prevPrev = prev.prevLeaf();
    if (prevPrev && (prevPrev.kind === K.Ident || prevPrev.kind === K.MathIdent)) return prevPrev;
  }
  return null;
}

/**
 * The first ancestor that isn't a field access. Every node on the way
 * remembers it, as each identifier of a chain asks: the chain is climbed once.
 */
function chainTop(node: LinkedTree): LinkedTree {
  const chain: LinkedTree[] = [];
  let top = node;
  while (top.parentKind === K.FieldAccess) {
    if (top.chainTop !== undefined) {
      top = top.chainTop;
      break;
    }
    chain.push(top);
    top = top.parent!;
  }
  for (const n of chain) n.chainTop = top;
  return top;
}

function highlightHash(node: LinkedTree): Tag | null {
  const next = node.nextSibling();
  if (!next || !isExpr(next.node) || !hashable(next.kind)) return null;
  const leaf = next.leftmostLeaf();
  return leaf ? highlight(leaf) : null;
}
