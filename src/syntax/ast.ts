// Ported from Typst 0.15.1: crates/typst-syntax/src/ast.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// Operators with their precedence and associativity, string unescaping, and
// the accessors of the typed AST that evaluation uses.

import { SyntaxKind } from './kind.js';
import type { SyntaxNode } from './node.js';
import { Scanner } from './scanner.js';
import { isAsciiHexDigit, isNumeric } from './unicode.js';

/** The associativity of a binary operator. */
export enum Assoc {
  /** Left-associative: `a + b + c` is equivalent to `(a + b) + c`. */
  Left,
  /** Right-associative: `a = b = c` is equivalent to `a = (b = c)`. */
  Right,
}

/** A unary operator. */
export enum UnOp {
  /** The plus operator: `+`. */
  Pos,
  /** The negation operator: `-`. */
  Neg,
  /** The boolean `not`. */
  Not,
}

export function unOpFromKind(kind: SyntaxKind): UnOp | null {
  switch (kind) {
    case SyntaxKind.Plus:
      return UnOp.Pos;
    case SyntaxKind.Minus:
      return UnOp.Neg;
    case SyntaxKind.Not:
      return UnOp.Not;
    default:
      return null;
  }
}

export function unOpPrecedence(op: UnOp): number {
  return op === UnOp.Not ? 4 : 7;
}

/** A binary operator. */
export enum BinOp {
  Add,
  Sub,
  Mul,
  Div,
  And,
  Or,
  Eq,
  Neq,
  Lt,
  Leq,
  Gt,
  Geq,
  Assign,
  In,
  NotIn,
  AddAssign,
  SubAssign,
  MulAssign,
  DivAssign,
}

const BINOP_FROM_KIND: Partial<Record<SyntaxKind, BinOp>> = {
  [SyntaxKind.Plus]: BinOp.Add,
  [SyntaxKind.Minus]: BinOp.Sub,
  [SyntaxKind.Star]: BinOp.Mul,
  [SyntaxKind.Slash]: BinOp.Div,
  [SyntaxKind.And]: BinOp.And,
  [SyntaxKind.Or]: BinOp.Or,
  [SyntaxKind.EqEq]: BinOp.Eq,
  [SyntaxKind.ExclEq]: BinOp.Neq,
  [SyntaxKind.Lt]: BinOp.Lt,
  [SyntaxKind.LtEq]: BinOp.Leq,
  [SyntaxKind.Gt]: BinOp.Gt,
  [SyntaxKind.GtEq]: BinOp.Geq,
  [SyntaxKind.Eq]: BinOp.Assign,
  [SyntaxKind.In]: BinOp.In,
  [SyntaxKind.PlusEq]: BinOp.AddAssign,
  [SyntaxKind.HyphEq]: BinOp.SubAssign,
  [SyntaxKind.StarEq]: BinOp.MulAssign,
  [SyntaxKind.SlashEq]: BinOp.DivAssign,
};

export function binOpFromKind(kind: SyntaxKind): BinOp | null {
  return BINOP_FROM_KIND[kind] ?? null;
}

export function binOpPrecedence(op: BinOp): number {
  switch (op) {
    case BinOp.Mul:
    case BinOp.Div:
      return 6;
    case BinOp.Add:
    case BinOp.Sub:
      return 5;
    case BinOp.Eq:
    case BinOp.Neq:
    case BinOp.Lt:
    case BinOp.Leq:
    case BinOp.Gt:
    case BinOp.Geq:
    case BinOp.In:
    case BinOp.NotIn:
      return 4;
    case BinOp.And:
      return 3;
    case BinOp.Or:
      return 2;
    default:
      return 1; // assignments
  }
}

export function binOpAssoc(op: BinOp): Assoc {
  switch (op) {
    case BinOp.Assign:
    case BinOp.AddAssign:
    case BinOp.SubAssign:
    case BinOp.MulAssign:
    case BinOp.DivAssign:
      return Assoc.Right;
    default:
      return Assoc.Left;
  }
}

/** The value of a string literal (with its quotes), with escape sequences resolved. */
export function unescapeStr(text: string): string {
  const unquoted = text.slice(1, -1);
  if (!unquoted.includes('\\')) return unquoted;

  let out = '';
  const s = new Scanner(unquoted);
  for (let c = s.eat(); c !== undefined; c = s.eat()) {
    if (c !== 0x5c) {
      out += String.fromCodePoint(c);
      continue;
    }

    const start = s.locate(-1);
    const next = s.eat();
    if (next === 0x5c) out += '\\';
    else if (next === 0x22) out += '"';
    else if (next === 0x6e) out += '\n';
    else if (next === 0x72) out += '\r';
    else if (next === 0x74) out += '\t';
    else if (next === 0x75 && s.eatIf('{')) {
      const sequence = s.eatWhile(isAsciiHexDigit);
      s.eatIf('}');
      const c = codepointFromHex(sequence);
      out += c === null ? s.from(start) : String.fromCodePoint(c);
    } else {
      out += s.from(start);
    }
  }
  return out;
}

/**
 * Parses hex digits into a Unicode scalar value, as Rust's
 * `u32::from_str_radix(hex, 16).ok().and_then(char::from_u32)`.
 */
export function codepointFromHex(hex: string): number | null {
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  const value = parseInt(hex, 16);
  if (value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return null;
  return value;
}

// --- Typed views -----------------------------------------------------------
//
// Typst's typed AST wraps syntax nodes in one Rust type per kind. Typlet keeps
// untyped nodes, paired with their offset in the source so that evaluation
// errors can point at the right range, and provides the accessors as
// functions.

/** A syntax node and its offset in the source, like Typst's `LinkedNode`. */
export class LinkedNode {
  constructor(
    readonly node: SyntaxNode,
    readonly offset: number,
    /** The source the node is in, if not the formula: `preamble`. */
    readonly file: 'preamble' | null = null,
  ) {}

  get kind(): SyntaxKind {
    return this.node.kind;
  }

  /** The text of a leaf node. */
  get text(): string {
    return this.node.text;
  }

  /** The range of the source this node covers, in UTF-16 code units. */
  get span(): { start: number; end: number; file?: 'preamble' } {
    if (this.cachedSpan) return this.cachedSpan;
    const span = { start: this.offset, end: this.offset + this.node.len };
    this.cachedSpan = this.file === null ? span : { ...span, file: this.file };
    return this.cachedSpan;
  }

  private cachedSpan: { start: number; end: number; file?: 'preamble' } | undefined;
  private cached: LinkedNode[] | undefined;
  /**
   * What evaluation derives from the node and keeps, such as a literal's
   * value or a call's arguments: closures evaluate the same nodes often.
   */
  memo: unknown;
  private first: LinkedNode | undefined;
  private last: LinkedNode | undefined;

  /** The first child that is an expression. */
  firstExpr(): LinkedNode {
    return (this.first ??= this.children().find(isExpr)!);
  }

  /** The last child that is an expression. */
  lastExpr(): LinkedNode {
    if (this.last) return this.last;
    const children = this.children();
    for (let i = children.length - 1; i >= 0; i--) if (isExpr(children[i]!)) return (this.last = children[i]!);
    return undefined!;
  }

  /** The children with their offsets. Computed once; don't modify the array. */
  children(): LinkedNode[] {
    if (this.cached) return this.cached;
    const out: LinkedNode[] = [];
    let offset = this.offset;
    for (const child of this.node.children) {
      out.push(new LinkedNode(child, offset, this.file));
      offset += child.len;
    }
    this.cached = out;
    return out;
  }

  fullText(): string {
    return this.node.fullText();
  }
}

const K = SyntaxKind;

/** The kinds that are expressions, as `Expr::from_untyped` decides. Spaces are not. */
const EXPR_KINDS: ReadonlySet<SyntaxKind> = new Set([
  K.Linebreak, K.Parbreak, K.Text, K.Escape, K.Shorthand, K.SmartQuote, K.Strong, K.Emph, K.Raw,
  K.Link, K.Label, K.Ref, K.Heading, K.ListItem, K.EnumItem, K.TermItem, K.Equation, K.Math,
  K.MathText, K.MathIdent, K.MathFieldAccess, K.MathShorthand, K.MathAlignPoint, K.MathCall,
  K.MathDelimited, K.MathAttach, K.MathPrimes, K.MathFrac, K.MathRoot, K.Ident, K.None, K.Auto,
  K.Bool, K.Int, K.Float, K.Numeric, K.Str, K.CodeBlock, K.ContentBlock, K.Parenthesized, K.Array,
  K.Dict, K.Unary, K.Binary, K.FieldAccess, K.FuncCall, K.Closure, K.LetBinding,
  K.DestructAssignment, K.SetRule, K.ShowRule, K.Contextual, K.Conditional, K.WhileLoop,
  K.ForLoop, K.ModuleImport, K.ModuleInclude, K.LoopBreak, K.LoopContinue, K.FuncReturn,
]);

/** Whether a node is an expression. */
export function isExpr(node: LinkedNode | SyntaxNode): boolean {
  return EXPR_KINDS.has(node.kind);
}

/** The children that are expressions, including spaces if `withSpace` is set. */
export function exprs(node: LinkedNode, withSpace = false): LinkedNode[] {
  return node.children().filter((child) => isExpr(child) || (withSpace && child.kind === K.Space));
}

/** The first child that is an expression. */
export function firstExpr(node: LinkedNode): LinkedNode {
  return node.firstExpr();
}

/** The last child that is an expression. */
export function lastExpr(node: LinkedNode): LinkedNode {
  return node.lastExpr();
}

/** The first child of a kind. */
export function firstOfKind(node: LinkedNode, kind: SyntaxKind): LinkedNode | undefined {
  return node.children().find((child) => child.kind === kind);
}

/** The last child of a kind. */
export function lastOfKind(node: LinkedNode, kind: SyntaxKind): LinkedNode | undefined {
  const children = node.children();
  for (let i = children.length - 1; i >= 0; i--) if (children[i]!.kind === kind) return children[i];
  return undefined;
}

/** Whether an equation is a block: it has spaces right inside both dollar signs. */
export function equationIsBlock(node: LinkedNode): boolean {
  const children = node.node.children;
  return children[1]?.kind === K.Space && children[children.length - 2]?.kind === K.Space;
}

/** Whether a math node was written in parentheses that the parser removed. */
export function mathWasDeparenthesized(node: LinkedNode): boolean {
  const children = node.node.children;
  return children[0]?.kind === K.LeftParen && children[children.length - 1]?.kind === K.RightParen;
}

/** Whether a math text node is a number rather than a grapheme. */
export function mathTextIsNumber(node: LinkedNode): boolean {
  const first = node.text.codePointAt(0);
  return first !== undefined && isNumeric(first);
}

/** The math shorthands and the characters they stand for. */
export const MATH_SHORTHANDS: ReadonlyArray<readonly [string, string]> = [
  ['...', '…'], ['-', '−'], ['*', '∗'], ['~', '∼'], ['!=', '≠'], [':=', '≔'], ['::=', '⩴'],
  ['=:', '≕'], ['<<', '≪'], ['<<<', '⋘'], ['>>', '≫'], ['>>>', '⋙'], ['<=', '≤'], ['>=', '≥'],
  ['->', '→'], ['-->', '⟶'], ['|->', '↦'], ['>->', '↣'], ['->>', '↠'], ['<-', '←'], ['<--', '⟵'],
  ['<-<', '↢'], ['<<-', '↞'], ['<->', '↔'], ['<-->', '⟷'], ['~>', '⇝'], ['~~>', '⟿'],
  ['<~', '⇜'], ['<~~', '⬳'], ['=>', '⇒'], ['|=>', '⤇'], ['==>', '⟹'], ['<==', '⟸'],
  ['<=>', '⇔'], ['<==>', '⟺'], ['[|', '⟦'], ['|]', '⟧'], ['||', '‖'],
];

/** The character a math shorthand stands for. */
export function mathShorthandChar(text: string): string {
  return MATH_SHORTHANDS.find(([s]) => s === text)?.[1] ?? '\0';
}

/** An argument of a call. */
export type Arg =
  | { readonly kind: 'pos'; readonly node: LinkedNode }
  | { readonly kind: 'named'; readonly node: LinkedNode }
  | { readonly kind: 'spread'; readonly node: LinkedNode };

/** Classifies a node as an argument, or returns `null`. */
export function castArg(node: LinkedNode): Arg | null {
  if (node.kind === K.Named) return { kind: 'named', node };
  if (node.kind === K.Spread) return { kind: 'spread', node };
  if (isExpr(node)) return { kind: 'pos', node };
  return null;
}

/** The arguments of a code call. */
export function argItems(args: LinkedNode): Arg[] {
  return (args.memo as Arg[] | undefined) ?? (args.memo = args.children().flatMap((child) => castArg(child) ?? [])) as Arg[];
}

/** An item of math call arguments, including the punctuation between arguments. */
export type MathArgItem =
  | { readonly kind: 'arg'; readonly arg: Arg }
  | { readonly kind: 'space'; readonly node: LinkedNode }
  | { readonly kind: 'punct'; readonly char: ',' | ';' | '(' | ')'; readonly node: LinkedNode };

/** The items of math call arguments, as `MathArgs::content_items` produces them. */
export function mathArgsContentItems(args: LinkedNode): MathArgItem[] {
  const items: MathArgItem[] = [];
  let prevHash = false;
  for (const node of args.children()) {
    const arg = castArg(node);
    if (arg) {
      items.push({ kind: 'arg', arg });
      continue;
    }
    const semicolonEndsCode = prevHash;
    prevHash = false;
    switch (node.kind) {
      case K.Space:
        items.push({ kind: 'space', node });
        break;
      case K.Comma:
        items.push({ kind: 'punct', char: ',', node });
        break;
      case K.LeftParen:
        items.push({ kind: 'punct', char: '(', node });
        break;
      case K.RightParen:
        items.push({ kind: 'punct', char: ')', node });
        break;
      case K.Semicolon:
        if (!semicolonEndsCode) items.push({ kind: 'punct', char: ';', node });
        break;
      case K.Hash:
        prevHash = true;
        break;
    }
  }
  return items;
}

/** The arguments of a math call, each marked when a semicolon follows it. */
export function mathArgItems(args: LinkedNode): { arg: Arg; endsInSemicolon: boolean }[] {
  const items = mathArgsContentItems(args);
  const out: { arg: Arg; endsInSemicolon: boolean }[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.kind !== 'arg') continue;
    let endsInSemicolon = false;
    for (let j = i + 1; j < items.length; j++) {
      const next = items[j]!;
      if (next.kind === 'arg') break;
      if (next.kind === 'punct' && next.char === ';') {
        endsInSemicolon = true;
        break;
      }
    }
    out.push({ arg: item.arg, endsInSemicolon });
  }
  return out;
}

/** The base of an attachment. */
export function attachBase(node: LinkedNode): LinkedNode {
  return firstExpr(node);
}

/** The expression after the first child of `kind`. */
function exprAfter(node: LinkedNode, kind: SyntaxKind): LinkedNode | undefined {
  const children = node.children();
  const i = children.findIndex((child) => child.kind === kind);
  return i < 0 ? undefined : children.slice(i + 1).find(isExpr);
}

/** The bottom attachment. */
export function attachBottom(node: LinkedNode): LinkedNode | undefined {
  return exprAfter(node, K.Underscore);
}

/** The top attachment. */
export function attachTop(node: LinkedNode): LinkedNode | undefined {
  return exprAfter(node, K.Hat);
}

/** The primes directly after the base. */
export function attachPrimes(node: LinkedNode): LinkedNode | undefined {
  const children = node.children();
  const i = children.findIndex(isExpr);
  const next = i < 0 ? undefined : children[i + 1];
  return next?.kind === K.MathPrimes ? next : undefined;
}

/** The index of a root written with a root sign: 3 for ∛, 4 for ∜. */
export function rootIndex(node: LinkedNode): number | null {
  const first = node.node.children[0]?.text;
  return first === '∜' ? 4 : first === '∛' ? 3 : null;
}

/** A binary expression's operator, including `not in`. */
export function binaryOp(node: LinkedNode): BinOp {
  if (typeof node.memo === 'number') return node.memo;
  node.memo = binaryOpOf(node);
  return node.memo as BinOp;
}

function binaryOpOf(node: LinkedNode): BinOp {
  let not = false;
  for (const child of node.node.children) {
    if (child.kind === K.Not) {
      not = true;
      continue;
    }
    if (child.kind === K.In && not) return BinOp.NotIn;
    const op = binOpFromKind(child.kind);
    if (op !== null) return op;
  }
  return BinOp.Add;
}

/** A unary expression's operator. */
export function unaryOp(node: LinkedNode): UnOp {
  for (const child of node.node.children) {
    const op = unOpFromKind(child.kind);
    if (op !== null) return op;
  }
  return UnOp.Pos;
}

/** The value of an integer literal, in decimal, `0x`, `0o` or `0b` notation. */
export function intLiteral(text: string): bigint {
  try {
    return BigInt(text);
  } catch {
    return 0n;
  }
}

/** The units of numeric literals. */
export type Unit = 'pt' | 'mm' | 'cm' | 'in' | 'rad' | 'deg' | 'em' | 'fr' | '%';

const UNITS: readonly string[] = ['pt', 'mm', 'cm', 'in', 'deg', 'rad', 'em', 'fr', '%'];

/** The value and unit of a numeric literal such as `1.5em`. */
export function numericLiteral(text: string): [number, Unit] {
  const match = /[a-z%]*$/.exec(text)!;
  const value = Number(text.slice(0, match.index));
  return [Number.isNaN(value) ? 0 : value, (UNITS.includes(match[0]) ? match[0] : '%') as Unit];
}
