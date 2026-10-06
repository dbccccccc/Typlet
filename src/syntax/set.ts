// Ported from Typst 0.15.1: crates/typst-syntax/src/set.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// Acknowledgement: based on rust-analyzer's `TokenSet`.

import { SyntaxKind } from './kind.js';

/** An immutable set of syntax kinds, stored as a bit set. */
export class SyntaxSet {
  /** The empty set. Five 32-bit words hold every kind. */
  static readonly empty: SyntaxSet = new SyntaxSet([0, 0, 0, 0, 0]);

  private constructor(private readonly words: readonly number[]) {}

  static of(...kinds: SyntaxKind[]): SyntaxSet {
    return SyntaxSet.empty.add(...kinds);
  }

  /** A new set with the given kinds added. */
  add(...kinds: SyntaxKind[]): SyntaxSet {
    const words = [...this.words];
    for (const kind of kinds) words[kind >>> 5]! |= 1 << (kind & 31);
    return new SyntaxSet(words);
  }

  /** A new set without the given kind. */
  remove(kind: SyntaxKind): SyntaxSet {
    const words = [...this.words];
    words[kind >>> 5]! &= ~(1 << (kind & 31));
    return new SyntaxSet(words);
  }

  /** A new set with the kinds of both sets. */
  union(other: SyntaxSet): SyntaxSet {
    return new SyntaxSet(this.words.map((w, i) => w | other.words[i]!));
  }

  contains(kind: SyntaxKind): boolean {
    return ((this.words[kind >>> 5]! >>> (kind & 31)) & 1) === 1;
  }
}

const K = SyntaxKind;

/** The empty set. */
export const NONE = SyntaxSet.empty;

/** Syntax kinds that can start a statement. */
export const STMT = SyntaxSet.of(K.Let, K.Set, K.Show, K.Import, K.Include, K.Return);

/** Syntax kinds that can start a math expression. */
export const MATH_EXPR = SyntaxSet.of(
  K.Hash,
  K.MathIdent,
  K.MathFieldAccess,
  K.Dot,
  K.Comma,
  K.Semicolon,
  // Parens and braces are converted to `MathText` unless they're parsed as a
  // function call.
  K.LeftBrace,
  K.RightBrace,
  K.LeftParen,
  K.RightParen,
  K.MathText,
  K.MathShorthand,
  K.Linebreak,
  K.MathAlignPoint,
  K.MathPrimes,
  K.Escape,
  K.Str,
  K.Root,
  // `Bang` is converted to `MathText` when parsing.
  K.Bang,
);

/** Syntax kinds that can start an atomic code expression. */
export const ATOMIC_CODE_EXPR = SyntaxSet.of(
  K.Ident,
  K.LeftBrace,
  K.LeftBracket,
  K.LeftParen,
  K.Dollar,
  K.Let,
  K.Set,
  K.Show,
  K.Context,
  K.If,
  K.While,
  K.For,
  K.Import,
  K.Include,
  K.Break,
  K.Continue,
  K.Return,
  K.None,
  K.Auto,
  K.Int,
  K.Float,
  K.Bool,
  K.Numeric,
  K.Str,
  K.Label,
  K.Raw,
);

/** Syntax kinds that are unary operators. */
export const UNARY_OP = SyntaxSet.of(K.Plus, K.Minus, K.Not);

/**
 * Syntax kinds that can start a code expression. Underscores can only start
 * an arrow function (`_ => {}`) or an assignment (`_ = x`).
 */
export const CODE_EXPR = ATOMIC_CODE_EXPR.union(UNARY_OP).add(K.Underscore);

/** Syntax kinds that are binary operators. */
export const BINARY_OP = SyntaxSet.of(
  K.Plus,
  K.Minus,
  K.Star,
  K.Slash,
  K.And,
  K.Or,
  K.EqEq,
  K.ExclEq,
  K.Lt,
  K.LtEq,
  K.Gt,
  K.GtEq,
  K.Eq,
  K.In,
  K.PlusEq,
  K.HyphEq,
  K.StarEq,
  K.SlashEq,
);

/** Syntax kinds that can start an item in an array or dictionary. */
export const ARRAY_OR_DICT_ITEM = CODE_EXPR.add(K.Dots);

/** Syntax kinds that can start an argument in a function call. */
export const ARG = CODE_EXPR.add(K.Dots);

/** Syntax kinds that can start a pattern leaf. */
export const PATTERN_LEAF = ATOMIC_CODE_EXPR;

/** Syntax kinds that can start a pattern. */
export const PATTERN = PATTERN_LEAF.add(K.LeftParen, K.Underscore);

/** Syntax kinds that can start a parameter in a parameter list. */
export const PARAM = PATTERN.add(K.Dots);

/** Syntax kinds that can start a destructuring item. */
export const DESTRUCTURING_ITEM = PATTERN.add(K.Dots);
