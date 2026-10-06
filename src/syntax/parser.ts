// Ported from Typst 0.15.1: crates/typst-syntax/src/parser.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// Differences from typst-syntax: no incremental reparsing, offsets are UTF-16,
// and since Typlet's nodes are mutable, memoized nodes are deep-copied where
// Rust shares them copy-on-write.

import { MathClass, defaultMathClass } from '../utils/math-class.js';
import {
  Assoc,
  BinOp,
  binOpAssoc,
  binOpFromKind,
  binOpPrecedence,
  unescapeStr,
  unOpFromKind,
  unOpPrecedence,
} from './ast.js';
import { SyntaxKind as K, SyntaxMode, isError, isGrouping, isKeyword, isTerminator, isTrivia, kindName } from './kind.js';
import type { SyntaxKind } from './kind.js';
import { Lexer } from './lexer.js';
import { SyntaxNode } from './node.js';
import * as set from './set.js';
import { SyntaxSet } from './set.js';
import { isAlphabetic } from './unicode.js';

/** The maximum nesting depth, as in typst-syntax. */
const MAX_DEPTH = 256;

// Token sets, built once: typst-syntax's `syntax_set!` sets are constants.
const of = SyntaxSet.of;
const END = of(K.End);
/** Stops strong content. */
const STRONG_END = of(K.Star, K.RightBracket, K.End);
/** Stops emphasized content. */
const EMPH_END = of(K.Underscore, K.RightBracket, K.End);
/** Stops a heading. */
const HEADING_END = of(K.Label, K.RightBracket, K.End);
/** Stops list items and content blocks. */
const BRACKET_END = of(K.RightBracket, K.End);
/** Stops a term in a term list. */
const TERM_END = of(K.Colon, K.RightBracket, K.End);
/** Stops an equation. */
const EQUATION_END = of(K.Dollar, K.End);
/** Opening delimiters in math. */
const MATH_OPEN = of(K.LeftBrace, K.LeftParen);
/** Stops the body of math delimiters. */
const DELIMITED_END = of(K.Dollar, K.End, K.RightBrace, K.RightParen);
/** Closing delimiters in math. */
const MATH_CLOSE = of(K.RightBrace, K.RightParen);
/** Stops math call arguments. */
const MATH_ARGS_END = of(K.End, K.Dollar, K.RightParen);
/** Stops one math call argument. */
const MATH_ARG_END = of(K.End, K.Dollar, K.Comma, K.Semicolon, K.RightParen);
/** Stops a code block. */
const CODE_BLOCK_END = of(K.RightBrace, K.RightBracket, K.RightParen, K.End);

const ATTACH_OPS = of(K.Hat, K.Underscore);
const AFTER_HAT = of(K.Underscore);
const AFTER_UNDERSCORE = of(K.Hat);

/** Attachment operators that can chain after `kind`: `^` and `_` chain with each other, primes with either. */
function attachChain(kind: SyntaxKind): SyntaxSet {
  return kind === K.Hat ? AFTER_HAT : kind === K.Underscore ? AFTER_UNDERSCORE : ATTACH_OPS;
}

/** Parses a source file as top-level markup. */
export function parse(text: string): SyntaxNode {
  const p = new Parser(text, 0, SyntaxMode.Markup);
  markupExprs(p, true, END);
  return p.finishInto(K.Markup);
}

/** Parses top-level code. */
export function parseCode(text: string): SyntaxNode {
  const p = new Parser(text, 0, SyntaxMode.Code);
  codeExprs(p, END);
  return p.finishInto(K.Code);
}

/** Parses top-level math. */
export function parseMath(text: string): SyntaxNode {
  const p = new Parser(text, 0, SyntaxMode.Math);
  mathExprs(p, END);
  return p.finishInto(K.Math);
}

/** A counter or flag that a callee updates, as Rust's `&mut`. */
interface Ref<T> {
  value: T;
}

// --- Markup ----------------------------------------------------------------

/** Parses markup expressions until a stop condition is met. */
function markup(p: Parser, atStart: boolean, wrapTrivia: boolean, stopSet: SyntaxSet): void {
  const m = wrapTrivia ? p.beforeTrivia() : p.marker();
  markupExprs(p, atStart, stopSet);
  if (wrapTrivia) p.flushTrivia();
  p.wrap(m, K.Markup);
}

/** Parses a sequence of markup expressions. */
function markupExprs(p: Parser, atStart: boolean, stopSet: SyntaxSet): void {
  if (!p.checkDepthUntil(stopSet)) return;

  atStart ||= p.hadNewline();
  const nesting: Ref<number> = { value: 0 };
  // Keep going if we're at a nested right-bracket regardless of the stop set.
  while (!p.atSet(stopSet) || (nesting.value > 0 && p.at(K.RightBracket))) {
    markupExpr(p, atStart, nesting);
    atStart = p.hadNewline();
  }
}

/**
 * Parses a single markup expression: text, headings, strong/emph,
 * lists/enums, etc. Also the entry point for equations and embedded code.
 */
function markupExpr(p: Parser, atStart: boolean, nesting: Ref<number>): void {
  if (!p.increaseDepth()) return;
  try {
    switch (p.current()) {
      case K.LeftBracket:
        nesting.value += 1;
        p.convertAndEat(K.Text);
        break;
      case K.RightBracket:
        if (nesting.value > 0) {
          nesting.value -= 1;
          p.convertAndEat(K.Text);
        } else {
          p.unexpected();
          p.hint('try using a backslash escape: \\]');
        }
        break;
      case K.Shebang:
      case K.Text:
      case K.Linebreak:
      case K.Escape:
      case K.Shorthand:
      case K.SmartQuote:
      case K.Link:
      case K.Label:
      case K.Raw: // Raw is handled entirely in the lexer.
        p.eat();
        break;
      case K.Hash:
        embeddedCodeExpr(p);
        break;
      case K.Star:
        strong(p);
        break;
      case K.Underscore:
        emph(p);
        break;
      case K.HeadingMarker:
        if (atStart) heading(p);
        else p.convertAndEat(K.Text);
        break;
      case K.ListMarker:
        if (atStart) listItem(p);
        else p.convertAndEat(K.Text);
        break;
      case K.EnumMarker:
        if (atStart) enumItem(p);
        else p.convertAndEat(K.Text);
        break;
      case K.TermMarker:
        if (atStart) termItem(p);
        else p.convertAndEat(K.Text);
        break;
      case K.RefMarker:
        reference(p);
        break;
      case K.Dollar:
        equation(p);
        break;
      case K.Colon:
        p.convertAndEat(K.Text);
        break;
      default:
        p.unexpected();
    }
  } finally {
    p.depth--;
  }
}

/** Parses strong content: `*Strong*`. */
function strong(p: Parser): void {
  p.withNlMode(STOP_PAR_BREAK, (p) => {
    const m = p.marker();
    p.assert(K.Star);
    markup(p, false, true, STRONG_END);
    const hadClosing = p.expectClosingDelimiter(m, K.Star);
    p.wrap(m, K.Strong);
    if (hadClosing && p.nodes[m]!.len === 2) {
      p.nodes[m]!.warn('no text within stars');
      p.nodes[m]!.hint('using multiple consecutive stars (e.g. **) has no additional effect');
    }
  });
}

/** Parses emphasized content: `_Emphasized_`. */
function emph(p: Parser): void {
  p.withNlMode(STOP_PAR_BREAK, (p) => {
    const m = p.marker();
    p.assert(K.Underscore);
    markup(p, false, true, EMPH_END);
    const hadClosing = p.expectClosingDelimiter(m, K.Underscore);
    p.wrap(m, K.Emph);
    if (hadClosing && p.nodes[m]!.len === 2) {
      p.nodes[m]!.warn('no text within underscores');
      p.nodes[m]!.hint('using multiple consecutive underscores (e.g. __) has no additional effect');
    }
  });
}

/** Parses a section heading: `= Introduction`. */
function heading(p: Parser): void {
  p.withNlMode(STOP, (p) => {
    const m = p.marker();
    p.assert(K.HeadingMarker);
    markup(p, false, false, HEADING_END);
    p.wrap(m, K.Heading);
  });
}

/** Parses an item in a bullet list: `- ...`. */
function listItem(p: Parser): void {
  p.withNlMode(requireColumn(p.currentColumn()), (p) => {
    const m = p.marker();
    p.assert(K.ListMarker);
    markup(p, true, false, BRACKET_END);
    p.wrap(m, K.ListItem);
  });
}

/** Parses an item in an enumeration (numbered list): `+ ...` or `1. ...`. */
function enumItem(p: Parser): void {
  p.withNlMode(requireColumn(p.currentColumn()), (p) => {
    const m = p.marker();
    p.assert(K.EnumMarker);
    markup(p, true, false, BRACKET_END);
    p.wrap(m, K.EnumItem);
  });
}

/** Parses an item in a term list: `/ Term: Details`. */
function termItem(p: Parser): void {
  p.withNlMode(requireColumn(p.currentColumn()), (p) => {
    const m = p.marker();
    p.withNlMode(STOP, (p) => {
      p.assert(K.TermMarker);
      markup(p, false, false, TERM_END);
    });
    p.expect(K.Colon);
    markup(p, true, false, BRACKET_END);
    p.wrap(m, K.TermItem);
  });
}

/** Parses a reference: `@target`, `@target[..]`. */
function reference(p: Parser): void {
  const m = p.marker();
  p.assert(K.RefMarker);
  if (p.directlyAt(K.LeftBracket)) contentBlock(p);
  p.wrap(m, K.Ref);
}

// --- Math ------------------------------------------------------------------

/** Parses a mathematical equation: `$x$`, `$ x^2 $`. */
function equation(p: Parser): void {
  const m = p.marker();
  p.enterModes(SyntaxMode.Math, CONTINUE, (p) => {
    p.assert(K.Dollar);
    math(p, EQUATION_END);
    p.expectClosingDelimiter(m, K.Dollar);
  });
  p.wrap(m, K.Equation);
}

/** Parses the contents of a mathematical equation: `x^2 + 1`. */
function math(p: Parser, stopSet: SyntaxSet): void {
  const m = p.marker();
  mathExprs(p, stopSet);
  p.wrap(m, K.Math);
}

/** Parses a sequence of math expressions. Returns the number of expressions parsed (including errors). */
function mathExprs(p: Parser, stopSet: SyntaxSet): number {
  if (!p.checkDepthUntil(stopSet)) return 1;

  let count = 0;
  while (!p.atSet(stopSet)) {
    if (p.atSet(set.MATH_EXPR)) mathExpr(p);
    else p.unexpected();
    count += 1;
  }
  return count;
}

/** Parses a single math expression: attachments, fractions, roots, embedded code, etc. */
function mathExpr(p: Parser): void {
  mathExprPrec(p, 0, set.NONE);
}

// Declared here so they're easier to compare with `mathOp`.
const MATH_FUNC_PREC = 2;
const MATH_ROOT_PREC = 2;

/** Parses a math expression with at least the given precedence, possibly chaining with another operator. */
function mathExprPrec(p: Parser, minPrec: number, stopSet: SyntaxSet): void {
  if (!p.increaseDepth()) return;
  try {
    const m = p.marker();
    let continuable = false;
    switch (p.current()) {
      case K.Hash:
        embeddedCodeExpr(p);
        break;

      // The lexer manages creating full MathFieldAccess nodes if needed.
      case K.MathIdent:
      case K.MathFieldAccess:
        continuable = true;
        p.eat();
        // Parse a function call for an identifier or field access.
        if (MATH_FUNC_PREC >= minPrec && p.directlyAt(K.LeftParen)) {
          mathArgs(p);
          p.wrap(m, K.MathCall);
          continuable = false;
        }
        break;

      case K.LeftBrace:
      case K.LeftParen:
        mathDelimited(p);
        break;

      case K.RightBrace:
        if (p.currentText() === '|]') p.convertAndEat(K.MathShorthand);
        else p.convertAndEat(K.MathText);
        break;
      case K.Dot:
      case K.Bang:
      case K.Comma:
      case K.Semicolon:
      case K.RightParen:
        p.convertAndEat(K.MathText);
        break;

      case K.MathText:
        continuable = isMathAlphabetic(p.currentText());
        p.eat();
        break;

      case K.Linebreak:
      case K.MathAlignPoint:
      case K.MathShorthand:
        p.eat();
        break;

      case K.MathPrimes:
      case K.Escape:
      case K.Str:
        continuable = true;
        p.eat();
        break;

      case K.Root: {
        p.eat();
        const m2 = p.marker();
        mathExprPrec(p, MATH_ROOT_PREC, set.NONE);
        mathUnparen(p, m2);
        p.wrap(m, K.MathRoot);
        break;
      }

      default:
        p.expected('expression');
    }

    // Maybe recognize an implicit function call: a 'continuable' token
    // followed by delimiters groups as one with the precedence of a normal
    // function. E.g. `a(b)/c` parses as `(a(b))/c` when `a` is continuable.
    if (continuable && MATH_FUNC_PREC >= minPrec && !p.hadTrivia() && p.atSet(MATH_OPEN)) {
      mathDelimited(p);
      p.wrap(m, K.Math);
    }

    // Parse infix and postfix operators. The general form of a parsed op
    // looks like: `MathAttach[ MathText("x"), Hat("^"), MathText("2") ]`.
    for (;;) {
      if (p.atSet(stopSet)) break;
      const opKind = p.current();
      const op = mathOp(opKind, p.hadTrivia());
      if (op === null) break;
      const [wrapper, infixAssoc, prec] = op;
      if (prec < minPrec) break;

      // Prepare a chaining set for the attachment operators: Hat can chain
      // with Underscore, Underscore with Hat, and Prime with either (but a
      // prime can't interrupt a chain, see below).
      let chainSet = wrapper === K.MathAttach ? attachChain(opKind) : set.NONE;

      // Eat the operator itself.
      if (opKind === K.Bang) p.convertAndEat(K.MathText);
      else p.eat();

      // Slash is the only operator that removes parens from its left operand.
      if (wrapper === K.MathFrac) mathUnparen(p, m);

      // Parse the operator's right operand.
      if (infixAssoc !== null) {
        const rhsPrec = infixAssoc === Assoc.Left ? prec + 1 : prec;
        const mRhs = p.marker();
        mathExprPrec(p, rhsPrec, chainSet);
        mathUnparen(p, mRhs);
      }

      // Avoid interrupting a chain when initially parsing a prime. For
      // `a^b'_c^d` the grouping is `(a^(b')_c)^d` and not `a^(b'_c^d)`.
      if (!(opKind === K.MathPrimes && p.atSet(stopSet))) {
        // Parse chained attachment operators as a single attachment.
        while (p.atSet(chainSet)) {
          chainSet = chainSet.remove(p.current());
          p.eat();
          const mChainRhs = p.marker();
          mathExprPrec(p, prec, chainSet);
          mathUnparen(p, mChainRhs);
        }
      }

      // Finish the operator by wrapping from its left operand.
      p.wrap(m, wrapper);
    }
  } finally {
    p.depth--;
  }
}

/** Precedence and wrapper kinds for infix and postfix math operators. */
function mathOp(kind: SyntaxKind, hadTrivia: boolean): [SyntaxKind, Assoc | null, number] | null {
  switch (kind) {
    case K.Slash:
      return [K.MathFrac, Assoc.Left, 1];
    case K.Underscore:
    case K.Hat:
      return [K.MathAttach, Assoc.Right, 2];
    case K.MathPrimes:
      return hadTrivia ? null : [K.MathAttach, null, 2];
    case K.Bang:
      return hadTrivia ? null : [K.Math, null, 3];
    default:
      return null;
  }
}

/**
 * Whether text counts as alphabetic in math. For `Text` and `MathText`, this
 * makes them group with parens as an implicit function call.
 */
function isMathAlphabetic(text: string): boolean {
  const chars = [...text];
  if (chars.length === 1) {
    // Just a single character.
    const c = chars[0]!.codePointAt(0)!;
    return isAlphabetic(c) || defaultMathClass(c) === MathClass.Alphabetic;
  }
  // Multiple characters.
  return chars.every((c) => isAlphabetic(c.codePointAt(0)!));
}

/**
 * Parses matched delimiters in math: `[x + y]`. The lexer produces
 * `{Left,Right}{Brace,Paren}` for delimiters; this converts them back to
 * `MathText` or `MathShorthand` before eating.
 */
function mathDelimited(p: Parser): void {
  const m = p.marker();
  if (p.currentText() === '[|') p.convertAndEat(K.MathShorthand);
  else p.convertAndEat(K.MathText);
  const mBody = p.marker();
  mathExprs(p, DELIMITED_END);
  if (p.atSet(MATH_CLOSE)) {
    p.wrap(mBody, K.Math);
    if (p.currentText() === '|]') p.convertAndEat(K.MathShorthand);
    else p.convertAndEat(K.MathText);
    p.wrap(m, K.MathDelimited);
  } else {
    // If we had no closing delimiter, just produce a math sequence.
    p.wrap(m, K.Math);
  }
}

/** Removes one set of parentheses (if any) from a previously parsed expression. */
function mathUnparen(p: Parser, m: number): void {
  const node = p.nodes[m];
  if (!node || node.kind !== K.MathDelimited) return;

  const children = node.children;
  const first = children[0];
  const last = children[children.length - 1];
  if (children.length >= 2 && first!.text === '(' && last!.text === ')') {
    first!.convertToKind(K.LeftParen);
    last!.convertToKind(K.RightParen);
    // Only convert if we did have regular parens.
    node.convertToKind(K.Math);
  }
}

/** Parses an argument list in math: `(a, b; c, d; size: #50%)`. */
function mathArgs(p: Parser): void {
  const m = p.marker();
  p.assert(K.LeftParen);

  const seen = new Set<string>();
  while (!p.atSet(MATH_ARGS_END)) {
    mathArg(p, seen);
    switch (p.current()) {
      case K.End:
      case K.Dollar:
      case K.RightParen:
        break;
      case K.Semicolon:
      case K.Comma:
        p.eat();
        break;
      default:
        p.expected('comma or semicolon');
    }
  }

  p.expectClosingDelimiter(m, K.RightParen);
  p.wrap(m, K.MathArgs);
}

/** Parses a single argument in a math argument list. */
function mathArg(p: Parser, seen: Set<string>): void {
  const m = p.marker();
  const start = p.currentStart();

  let argKind: SyntaxKind | null = null;

  const spread = p.lexer.maybeMathSpreadArg(start);
  if (spread) {
    // Parses a spread argument: `..args`.
    argKind = K.Spread;
    p.token.node = spread;
    p.eat();
  } else {
    const named = p.lexer.maybeMathNamedArg(start);
    if (named) {
      // Parses a named argument: `thickness: #12pt`.
      argKind = K.Named;
      p.token.node = named;
      const text = p.currentText();
      p.eat();
      p.convertAndEat(K.Colon);
      if (seen.has(text)) p.nodes[m]!.convertToError(`duplicate argument: ${text}`);
      else seen.add(text);
    }
  }

  // Parses the argument itself.
  const mArg = p.marker();
  const count = mathExprs(p, MATH_ARG_END);

  // Named arguments require a value.
  if (count === 0 && argKind === K.Named) p.expected('expression');

  // Wrap math function arguments to join adjacent math content or create an
  // empty 'Math' node for when we have 0 args. We don't wrap when
  // `count == 1`, since wrapping would change the type of the expression
  // from potentially non-content to content. E.g. `$ func(#12pt) $` would
  // change the type of `#12pt` from size to content if wrapped.
  if (count !== 1) p.wrap(mArg, K.Math);

  if (argKind !== null) p.wrap(m, argKind);
}

// --- Code ------------------------------------------------------------------

/** Parses the contents of a code block. */
function code(p: Parser, stopSet: SyntaxSet): void {
  const m = p.marker();
  codeExprs(p, stopSet);
  p.wrap(m, K.Code);
}

/** Parses a sequence of code expressions. */
function codeExprs(p: Parser, stopSet: SyntaxSet): void {
  if (!p.checkDepthUntil(stopSet)) return;

  while (!p.atSet(stopSet)) {
    p.withNlMode(CONTEXTUAL_CONTINUE, (p) => {
      if (!p.atSet(set.CODE_EXPR)) {
        p.unexpected();
        return;
      }
      codeExpr(p);
      if (!p.atSet(stopSet) && !p.eatIf(K.Semicolon)) {
        p.expected('semicolon or line break');
        if (p.at(K.Label)) {
          p.hint('labels can only be applied in markup mode');
          p.hint('try wrapping your code in a markup block (`[ ]`)');
        }
      }
    });
  }
}

/** Parses an atomic code expression embedded in markup or math. */
function embeddedCodeExpr(p: Parser): void {
  p.enterModes(SyntaxMode.Code, STOP, (p) => {
    p.assert(K.Hash);
    if (p.hadTrivia() || p.end()) {
      p.expected('expression');
      return;
    }

    const stmt = p.atSet(set.STMT);
    codeExprPrec(p, true, 0);

    // Note: 2d math arguments rely on the `directlyAt` check.
    const semi = (stmt || p.directlyAt(K.Semicolon)) && p.eatIf(K.Semicolon);

    if (stmt && !semi && !p.end() && !p.at(K.RightBracket)) p.expected('semicolon or line break');
  });
}

/** Parses a single code expression. */
function codeExpr(p: Parser): void {
  codeExprPrec(p, false, 0);
}

/** Parses a code expression with at least the given precedence. */
function codeExprPrec(p: Parser, atomic: boolean, minPrec: number): void {
  if (!p.increaseDepth()) return;
  try {
    const m = p.marker();
    if (p.atSet(set.UNARY_OP)) {
      if (!atomic) {
        const op = unOpFromKind(p.current())!;
        p.eat();
        codeExprPrec(p, atomic, unOpPrecedence(op));
        p.wrap(m, K.Unary);
      } else {
        p.unexpected();
        p.hint('to use a unary operator here, wrap the entire expression in parentheses');
      }
    } else {
      codePrimary(p, atomic);
    }

    for (;;) {
      if (p.directlyAt(K.LeftParen) || p.directlyAt(K.LeftBracket)) {
        args(p);
        p.wrap(m, K.FuncCall);
        continue;
      }

      const atFieldOrMethod = p.directlyAt(K.Dot) && p.lexer.clone().next()[0] === K.Ident;

      if (atomic && !atFieldOrMethod) break;

      if (p.eatIf(K.Dot)) {
        p.expect(K.Ident);
        p.wrap(m, K.FieldAccess);
        continue;
      }

      let binop: BinOp | null = null;
      if (p.atSet(set.BINARY_OP)) {
        binop = binOpFromKind(p.current());
      } else if (minPrec <= binOpPrecedence(BinOp.NotIn) && p.eatIf(K.Not)) {
        if (p.at(K.In)) {
          binop = BinOp.NotIn;
        } else {
          p.expected('keyword `in`');
          break;
        }
      }

      if (binop !== null) {
        let prec = binOpPrecedence(binop);
        if (prec < minPrec) break;
        if (binOpAssoc(binop) === Assoc.Left) prec += 1;
        p.eat();
        codeExprPrec(p, false, prec);
        p.wrap(m, K.Binary);
        continue;
      }

      break;
    }
  } finally {
    p.depth--;
  }
}

/**
 * Parses a primary in a code expression: the atoms that unary and binary
 * operations, function calls, and field accesses start with or are composed of.
 */
function codePrimary(p: Parser, atomic: boolean): void {
  const m = p.marker();
  switch (p.current()) {
    case K.Ident:
      p.eat();
      if (!atomic && p.at(K.Arrow)) {
        p.wrap(m, K.Params);
        p.assert(K.Arrow);
        codeExpr(p);
        p.wrap(m, K.Closure);
      }
      return;
    case K.Underscore:
      if (atomic) break;
      p.eat();
      if (p.at(K.Arrow)) {
        p.wrap(m, K.Params);
        p.eat();
        codeExpr(p);
        p.wrap(m, K.Closure);
      } else if (p.eatIf(K.Eq)) {
        codeExpr(p);
        p.wrap(m, K.DestructAssignment);
      } else {
        p.nodes[m]!.expected('expression');
      }
      return;

    case K.LeftBrace:
      return codeBlock(p);
    case K.LeftBracket:
      return contentBlock(p);
    case K.LeftParen:
      return exprWithParen(p, atomic);
    case K.Dollar:
      return equation(p);
    case K.Let:
      return letBinding(p);
    case K.Set:
      return setRule(p);
    case K.Show:
      return showRule(p);
    case K.Context:
      return contextual(p, atomic);
    case K.If:
      return conditional(p);
    case K.While:
      return whileLoop(p);
    case K.For:
      return forLoop(p);
    case K.Import:
      return moduleImport(p);
    case K.Include:
      return moduleInclude(p);
    case K.Break:
      return breakStmt(p);
    case K.Continue:
      return continueStmt(p);
    case K.Return:
      return returnStmt(p);

    case K.Raw: // Raw is handled entirely in the lexer.
    case K.None:
    case K.Auto:
    case K.Int:
    case K.Float:
    case K.Bool:
    case K.Numeric:
    case K.Str:
    case K.Label:
      p.eat();
      return;
  }

  // Consume erroneous tokens for things like `#12p`, `#]`, or `#"abc\"`.
  if (atomic) p.unexpected();
  else p.expected('expression');
}

/** Parses a content or code block. */
function block(p: Parser): void {
  switch (p.current()) {
    case K.LeftBracket:
      return contentBlock(p);
    case K.LeftBrace:
      return codeBlock(p);
    default:
      p.expected('block');
  }
}

/** Parses a code block: `{ let x = 1; x + 2 }`. */
function codeBlock(p: Parser): void {
  const m = p.marker();
  p.enterModes(SyntaxMode.Code, CONTINUE, (p) => {
    p.assert(K.LeftBrace);
    code(p, CODE_BLOCK_END);
    p.expectClosingDelimiter(m, K.RightBrace);
  });
  p.wrap(m, K.CodeBlock);
}

/** Parses a content block: `[*Hi* there!]`. */
function contentBlock(p: Parser): void {
  const m = p.marker();
  p.enterModes(SyntaxMode.Markup, CONTINUE, (p) => {
    p.assert(K.LeftBracket);
    markup(p, true, true, BRACKET_END);
    p.expectClosingDelimiter(m, K.RightBracket);
  });
  p.wrap(m, K.ContentBlock);
}

/** Parses a let binding: `let x = 1`. */
function letBinding(p: Parser): void {
  const m = p.marker();
  p.assert(K.Let);

  const m2 = p.marker();
  let closure = false;
  let other = false;

  if (p.eatIf(K.Ident)) {
    if (p.directlyAt(K.LeftParen)) {
      params(p);
      closure = true;
    }
  } else {
    pattern(p, false, new Set(), null);
    other = true;
  }

  const hasValue = closure || other ? p.expect(K.Eq) : p.eatIf(K.Eq);
  if (hasValue) codeExpr(p);

  if (closure) p.wrap(m2, K.Closure);

  p.wrap(m, K.LetBinding);
}

/** Parses a set rule: `set text(...)`. */
function setRule(p: Parser): void {
  const m = p.marker();
  p.assert(K.Set);

  const m2 = p.marker();
  p.expect(K.Ident);
  while (p.eatIf(K.Dot)) {
    p.expect(K.Ident);
    p.wrap(m2, K.FieldAccess);
  }

  args(p);
  if (p.eatIf(K.If)) codeExpr(p);
  p.wrap(m, K.SetRule);
}

/** Parses a show rule: `show heading: it => emph(it.body)`. */
function showRule(p: Parser): void {
  const m = p.marker();
  p.assert(K.Show);
  const m2 = p.beforeTrivia();

  if (!p.at(K.Colon)) codeExpr(p);

  if (p.eatIf(K.Colon)) codeExpr(p);
  else p.expectedAt(m2, 'colon');

  p.wrap(m, K.ShowRule);
}

/** Parses a contextual expression: `context text.lang`. */
function contextual(p: Parser, atomic: boolean): void {
  const m = p.marker();
  p.assert(K.Context);
  codeExprPrec(p, atomic, 0);
  p.wrap(m, K.Contextual);
}

/** Parses an if-else conditional: `if x { y } else { z }`. */
function conditional(p: Parser): void {
  const m = p.marker();
  p.assert(K.If);
  codeExpr(p);
  block(p);
  if (p.eatIf(K.Else)) {
    if (p.at(K.If)) conditional(p);
    else block(p);
  }
  p.wrap(m, K.Conditional);
}

/** Parses a while loop: `while x { y }`. */
function whileLoop(p: Parser): void {
  const m = p.marker();
  p.assert(K.While);
  codeExpr(p);
  block(p);
  p.wrap(m, K.WhileLoop);
}

/** Parses a for loop: `for x in y { z }`. */
function forLoop(p: Parser): void {
  const m = p.marker();
  p.assert(K.For);

  const seen = new Set<string>();
  pattern(p, false, seen, null);

  if (p.at(K.Comma)) {
    const node = p.eatAndGet();
    node.unexpected();
    node.hint('destructuring patterns must be wrapped in parentheses');
    if (p.atSet(set.PATTERN)) pattern(p, false, seen, null);
  }

  p.expect(K.In);
  codeExpr(p);
  block(p);
  p.wrap(m, K.ForLoop);
}

/** Parses a module import: `import "utils.typ": a, b, c`. */
function moduleImport(p: Parser): void {
  const m = p.marker();
  p.assert(K.Import);
  codeExpr(p);
  if (p.eatIf(K.As)) {
    // Allow renaming a full module import. If items are included, both the
    // full module and the items are imported at the same time.
    p.expect(K.Ident);
  }

  if (p.eatIf(K.Colon)) {
    if (p.at(K.LeftParen)) {
      p.withNlMode(CONTINUE, (p) => {
        const m2 = p.marker();
        p.assert(K.LeftParen);
        importItems(p);
        p.expectClosingDelimiter(m2, K.RightParen);
      });
    } else if (!p.eatIf(K.Star)) {
      importItems(p);
    }
  }

  p.wrap(m, K.ModuleImport);
}

/** Parses items to import from a module: `a, b, c`. */
function importItems(p: Parser): void {
  const m = p.marker();
  while (!isTerminator(p.current())) {
    const itemMarker = p.marker();
    if (!p.eatIf(K.Ident)) p.unexpected();

    // Nested import path: `a.b.c`
    while (p.eatIf(K.Dot)) p.expect(K.Ident);

    p.wrap(itemMarker, K.ImportItemPath);

    // Rename imported item.
    if (p.eatIf(K.As)) {
      p.expect(K.Ident);
      p.wrap(itemMarker, K.RenamedImportItem);
    }

    if (!isTerminator(p.current())) p.expect(K.Comma);
  }

  p.wrap(m, K.ImportItems);
}

/** Parses a module include: `include "chapter1.typ"`. */
function moduleInclude(p: Parser): void {
  const m = p.marker();
  p.assert(K.Include);
  codeExpr(p);
  p.wrap(m, K.ModuleInclude);
}

/** Parses a break from a loop: `break`. */
function breakStmt(p: Parser): void {
  const m = p.marker();
  p.assert(K.Break);
  p.wrap(m, K.LoopBreak);
}

/** Parses a continue in a loop: `continue`. */
function continueStmt(p: Parser): void {
  const m = p.marker();
  p.assert(K.Continue);
  p.wrap(m, K.LoopContinue);
}

/** Parses a return from a function: `return`, `return x + 1`. */
function returnStmt(p: Parser): void {
  const m = p.marker();
  p.assert(K.Return);
  if (p.atSet(set.CODE_EXPR)) codeExpr(p);
  p.wrap(m, K.FuncReturn);
}

/** An expression that starts with a parenthesis. */
function exprWithParen(p: Parser, atomic: boolean): void {
  if (atomic) {
    // Atomic expressions aren't modified by operators that follow them, so
    // our first guess of array/dict will be correct.
    parenthesizedOrArrayOrDict(p);
    return;
  }

  // If we've seen this position before and have a memoized result, restore
  // it and return. Otherwise, get a key to this position and a checkpoint to
  // restart from in case we make a wrong prediction.
  const memo = p.restoreMemoOrCheckpoint();
  if (memo === null) return;
  const [memoKey, checkpoint] = memo;
  // The node length from when we restored.
  const prevLen = checkpoint.nodeLen;

  // When we reach a '(', we can't be sure what it is. First, we attempt to
  // parse as a simple parenthesized expression, array, or dictionary, as
  // these are the most likely things.
  const kind = parenthesizedOrArrayOrDict(p);

  // If, however, '=>' or '=' follows, we must backtrack and reparse as
  // either a parameter list or a destructuring. To avoid exponential parsing
  // time in nested cases, the corrected result is memoized, so no
  // parenthesized expression is parsed more than twice (see typst-syntax).
  if (p.at(K.Arrow)) {
    p.restore(checkpoint);
    const m = p.marker();
    params(p);
    if (!p.expect(K.Arrow)) return;
    codeExpr(p);
    p.wrap(m, K.Closure);
  } else if (p.at(K.Eq) && kind !== K.Parenthesized) {
    p.restore(checkpoint);
    const m = p.marker();
    destructuringOrParenthesized(p, true, new Set());
    if (!p.expect(K.Eq)) return;
    codeExpr(p);
    p.wrap(m, K.DestructAssignment);
  } else {
    return;
  }

  // Memoize the result if we backtracked.
  p.memoizeParsedNodes(memoKey, prevLen);
}

/** State for array/dictionary parsing. */
interface GroupState {
  count: number;
  /**
   * Whether this is just a single expression in parens: `(a)`. Single element
   * arrays require an explicit comma: `(a,)`, unless we're spreading: `(..a)`.
   */
  maybeJustParens: boolean;
  /** The kind to wrap as, if we've figured it out yet. */
  kind: SyntaxKind | null;
  /** Named arguments seen so far, to report repeats. */
  seen: Set<string>;
}

/**
 * Parses either a parenthesized expression `(1 + 2)`, an array `(1, "hi",
 * 12cm)`, or a dictionary `(thickness: 3pt, dash: "solid")`.
 */
function parenthesizedOrArrayOrDict(p: Parser): SyntaxKind {
  const state: GroupState = { count: 0, maybeJustParens: true, kind: null, seen: new Set() };

  // A leading colon forces a dictionary, so that `(: ..dict1, ..dict2)` is a
  // dictionary while `(..arr1, ..arr2)` is an array.
  const m = p.marker();
  p.withNlMode(CONTINUE, (p) => {
    p.assert(K.LeftParen);
    if (p.eatIf(K.Colon)) state.kind = K.Dict;

    while (!isTerminator(p.current())) {
      if (!p.atSet(set.ARRAY_OR_DICT_ITEM)) {
        p.unexpected();
        continue;
      }

      arrayOrDictItem(p, state);
      state.count += 1;

      if (!isTerminator(p.current()) && p.expect(K.Comma)) state.maybeJustParens = false;
    }

    p.expectClosingDelimiter(m, K.RightParen);
  });

  const kind = state.maybeJustParens && state.count === 1 ? K.Parenthesized : (state.kind ?? K.Array);
  p.wrap(m, kind);
  return kind;
}

/** Parses a single item in an array or dictionary. */
function arrayOrDictItem(p: Parser, state: GroupState): void {
  const m = p.marker();

  if (p.eatIf(K.Dots)) {
    // Parses a spread item: `..item`.
    codeExpr(p);
    p.wrap(m, K.Spread);
    state.maybeJustParens = false;
    return;
  }

  codeExpr(p);

  if (p.eatIf(K.Colon)) {
    // Parses a named/keyed pair: `name: item` or `"key": item`.
    codeExpr(p);

    const node = p.nodes[m]!;
    const pairKind = node.kind === K.Ident ? K.Named : K.Keyed;

    const key = node.kind === K.Ident ? node.text : node.kind === K.Str ? unescapeStr(node.text) : null;
    if (key !== null) {
      if (state.seen.has(key)) node.convertToError(`duplicate key: ${key}`);
      else state.seen.add(key);
    }

    p.wrap(m, pairKind);
    state.maybeJustParens = false;

    if (state.kind === K.Array) p.nodes[m]!.expected('expression');
    else state.kind = K.Dict;
  } else {
    // Parses a positional item.
    if (state.kind === K.Dict) p.nodes[m]!.expected('named or keyed pair');
    else state.kind = K.Array;
  }
}

/** Parses a function call's argument list: `(12pt, y)`. */
function args(p: Parser): void {
  if (!p.directlyAt(K.LeftParen) && !p.directlyAt(K.LeftBracket)) {
    p.expected('argument list');
    if (p.at(K.LeftParen) || p.at(K.LeftBracket)) p.hint('there may not be any spaces before the argument list');
  }

  const m = p.marker();
  if (p.at(K.LeftParen)) {
    const m2 = p.marker();
    p.withNlMode(CONTINUE, (p) => {
      p.assert(K.LeftParen);

      const seen = new Set<string>();
      while (!isTerminator(p.current())) {
        if (!p.atSet(set.ARG)) {
          p.unexpected();
          continue;
        }

        arg(p, seen);

        if (!isTerminator(p.current())) p.expect(K.Comma);
      }

      p.expectClosingDelimiter(m2, K.RightParen);
    });
  }

  while (p.directlyAt(K.LeftBracket)) contentBlock(p);

  p.wrap(m, K.Args);
}

/** Parses a single argument in an argument list. */
function arg(p: Parser, seen: Set<string>): void {
  const m = p.marker();

  // Parses a spread argument: `..args`.
  if (p.eatIf(K.Dots)) {
    codeExpr(p);
    p.wrap(m, K.Spread);
    return;
  }

  // Parses a normal positional argument or an argument name.
  const wasAtExpr = p.atSet(set.CODE_EXPR);
  const text = p.currentText();
  codeExpr(p);

  // Parses a named argument: `thickness: 12pt`.
  if (p.eatIf(K.Colon)) {
    // Recover from bad argument name.
    if (wasAtExpr) {
      if (p.nodes[m]!.kind !== K.Ident) p.nodes[m]!.expected('identifier');
      else if (seen.has(text)) p.nodes[m]!.convertToError(`duplicate argument: ${text}`);
      else seen.add(text);
    }

    codeExpr(p);
    p.wrap(m, K.Named);
  }
}

/** Parses a closure's parameters: `(x, y)`. */
function params(p: Parser): void {
  const m = p.marker();
  p.withNlMode(CONTINUE, (p) => {
    p.assert(K.LeftParen);

    const seen = new Set<string>();
    const sink: Ref<boolean> = { value: false };

    while (!isTerminator(p.current())) {
      if (!p.atSet(set.PARAM)) {
        p.unexpected();
        continue;
      }

      param(p, seen, sink);

      if (!isTerminator(p.current())) p.expect(K.Comma);
    }

    p.expectClosingDelimiter(m, K.RightParen);
  });
  p.wrap(m, K.Params);
}

/** Parses a single parameter in a parameter list. */
function param(p: Parser, seen: Set<string>, sink: Ref<boolean>): void {
  const m = p.marker();

  // Parses argument sink: `..sink`.
  if (p.eatIf(K.Dots)) {
    if (p.atSet(set.PATTERN_LEAF)) patternLeaf(p, false, seen, 'parameter');
    p.wrap(m, K.Spread);
    if (sink.value) p.nodes[m]!.convertToError('only one argument sink is allowed');
    sink.value = true;
    return;
  }

  // Parses a normal positional parameter or a parameter name.
  const wasAtPat = p.atSet(set.PATTERN);
  pattern(p, false, seen, 'parameter');

  // Parses a named parameter: `thickness: 12pt`.
  if (p.eatIf(K.Colon)) {
    // Recover from bad parameter name.
    if (wasAtPat && p.nodes[m]!.kind !== K.Ident) p.nodes[m]!.expected('identifier');

    codeExpr(p);
    p.wrap(m, K.Named);
  }
}

/** Parses a binding or reassignment pattern. */
function pattern(p: Parser, reassignment: boolean, seen: Set<string>, dupe: string | null): void {
  if (!p.increaseDepth()) return;
  try {
    switch (p.current()) {
      case K.Underscore:
        p.eat();
        break;
      case K.LeftParen:
        destructuringOrParenthesized(p, reassignment, seen);
        break;
      default:
        patternLeaf(p, reassignment, seen, dupe);
    }
  } finally {
    p.depth--;
  }
}

/** Parses a destructuring pattern or just a parenthesized pattern. */
function destructuringOrParenthesized(p: Parser, reassignment: boolean, seen: Set<string>): void {
  const sink: Ref<boolean> = { value: false };
  let count = 0;
  const maybeJustParens: Ref<boolean> = { value: true };

  const m = p.marker();
  p.withNlMode(CONTINUE, (p) => {
    p.assert(K.LeftParen);

    while (!isTerminator(p.current())) {
      if (!p.atSet(set.DESTRUCTURING_ITEM)) {
        p.unexpected();
        continue;
      }

      destructuringItem(p, reassignment, seen, maybeJustParens, sink);
      count += 1;

      if (!isTerminator(p.current()) && p.expect(K.Comma)) maybeJustParens.value = false;
    }

    p.expectClosingDelimiter(m, K.RightParen);
  });

  if (maybeJustParens.value && count === 1 && !sink.value) p.wrap(m, K.Parenthesized);
  else p.wrap(m, K.Destructuring);
}

/** Parses an item in a destructuring pattern. */
function destructuringItem(
  p: Parser,
  reassignment: boolean,
  seen: Set<string>,
  maybeJustParens: Ref<boolean>,
  sink: Ref<boolean>,
): void {
  const m = p.marker();

  // Parse destructuring sink: `..rest`.
  if (p.eatIf(K.Dots)) {
    if (p.atSet(set.PATTERN_LEAF)) patternLeaf(p, reassignment, seen, null);
    p.wrap(m, K.Spread);
    if (sink.value) p.nodes[m]!.convertToError('only one destructuring sink is allowed');
    sink.value = true;
    return;
  }

  // Parse a normal positional pattern or a destructuring key.
  const wasAtPat = p.atSet(set.PATTERN);

  // A full checkpoint is needed (not just a lexer clone), because there may
  // be trivia between the identifier and the colon to skip.
  const checkpoint = p.checkpoint();
  if (!(p.eatIf(K.Ident) && p.at(K.Colon))) {
    p.restore(checkpoint);
    pattern(p, reassignment, seen, null);
  }

  // Parse named destructuring item.
  if (p.eatIf(K.Colon)) {
    // Recover from bad named destructuring.
    if (wasAtPat && p.nodes[m]!.kind !== K.Ident) p.nodes[m]!.expected('identifier');

    pattern(p, reassignment, seen, null);
    p.wrap(m, K.Named);
    maybeJustParens.value = false;
  }
}

/**
 * Parses a leaf in a pattern: an identifier or an expression, depending on
 * whether it's a binding or reassignment pattern.
 */
function patternLeaf(p: Parser, reassignment: boolean, seen: Set<string>, dupe: string | null): void {
  if (isKeyword(p.current())) {
    p.eatAndGet().expected('pattern');
    return;
  } else if (!p.atSet(set.PATTERN_LEAF)) {
    p.expected('pattern');
    return;
  }

  const m = p.marker();
  const text = p.currentText();

  // Parse an atomic expression even though only an identifier is wanted, for
  // better error recovery: the whole expression can be marked as unexpected.
  codeExprPrec(p, true, 0);

  if (!reassignment) {
    const node = p.nodes[m]!;
    if (node.kind === K.Ident) {
      if (seen.has(text)) node.convertToError(`duplicate ${dupe ?? 'binding'}: ${text}`);
      else seen.add(text);
    } else {
      node.expected('pattern');
    }
  }
}

// --- The parser --------------------------------------------------------------

/** How to proceed with parsing when at a newline. */
type AtNewline =
  /** Continue at newlines. */
  | { readonly t: 'Continue' }
  /** Stop at any newline. */
  | { readonly t: 'Stop' }
  /** Continue only if there is a continuation with `else` or `.` (Code only). */
  | { readonly t: 'ContextualContinue' }
  /** Stop only at a parbreak, not normal newlines (Markup only). */
  | { readonly t: 'StopParBreak' }
  /** Require that the token's column be greater than a column (Markup only). */
  | { readonly t: 'RequireColumn'; readonly column: number };

const CONTINUE: AtNewline = { t: 'Continue' };
const STOP: AtNewline = { t: 'Stop' };
const CONTEXTUAL_CONTINUE: AtNewline = { t: 'ContextualContinue' };
const STOP_PAR_BREAK: AtNewline = { t: 'StopParBreak' };
const requireColumn = (column: number): AtNewline => ({ t: 'RequireColumn', column });

function nlModeEq(a: AtNewline, b: AtNewline): boolean {
  return a.t === b.t && (a.t !== 'RequireColumn' || a.column === (b as { column: number }).column);
}

/** Information about newlines in a group of trivia. */
interface Newline {
  /** The column of the start of the next token in its line. */
  column: number | null;
  /** Whether any of the newlines were paragraph breaks. */
  parbreak: boolean;
}

/** Whether to stop at a newline or continue, based on the current context. */
function stopAt(mode: AtNewline, newline: Newline, kind: SyntaxKind): boolean {
  switch (mode.t) {
    case 'Continue':
      return false;
    case 'Stop':
      return true;
    case 'ContextualContinue':
      return kind !== K.Else && kind !== K.Dot;
    case 'StopParBreak':
      return newline.parbreak;
    case 'RequireColumn':
      // When the column is unknown, the newline doesn't start a column and
      // parsing continues. This happens on the boundary of syntax modes,
      // since only Markup reports columns.
      return newline.column !== null && newline.column <= mode.column;
  }
}

/** A single token returned from the lexer, with a record of preceding trivia. */
interface Token {
  /** The kind of the current token (possibly a fake `End` from the newline mode). */
  kind: SyntaxKind;
  /** The node of the current token, ready to be eaten. */
  node: SyntaxNode;
  /** The number of preceding trivia before this token. */
  nTrivia: number;
  /** Whether this token's preceding trivia contained a newline. */
  newline: Newline | null;
  /** The index of the start of the current token (the end is the lexer's cursor). */
  start: number;
  /** The index of the end of the previous token. */
  prevEnd: number;
}

function cloneToken(token: Token): Token {
  return { ...token, node: token.node.clone(), newline: token.newline && { ...token.newline } };
}

/** State needed to restore the parser's current token and the lexer (but not the nodes). */
interface PartialState {
  cursor: number;
  lexMode: SyntaxMode;
  token: Token;
}

/** A checkpoint of the parser that can fully restore it to a previous state. */
interface Checkpoint {
  nodeLen: number;
  state: PartialState;
}

/**
 * Turns a stream of tokens into a tree of syntax nodes. Eats tokens into
 * `nodes`, wraps runs of nodes into inner nodes, and produces or converts
 * nodes into errors. See typst-syntax's `Parser` for the full design notes on
 * syntax modes and newline modes.
 */
class Parser {
  /** The source text shared with the lexer. */
  readonly text: string;
  /** A lexer over the source text with multiple modes. */
  readonly lexer: Lexer;
  /** The newline mode: whether to insert a temporary end at newlines. */
  nlMode: AtNewline = CONTINUE;
  /** The current token under inspection, not yet in `nodes`. */
  token: Token;
  /** Whether the parser has the expected set of open/close delimiters. */
  balanced = true;
  /** Nodes of previously parsed text, including trivia, excluding `token`. */
  readonly nodes: SyntaxNode[] = [];
  /** Memoized results for parenthesized expressions, keyed by token start. */
  private readonly memo = {
    arena: [] as SyntaxNode[],
    map: new Map<number, { start: number; end: number; state: PartialState }>(),
  };
  /** The current expression nesting depth. */
  depth = 0;

  constructor(text: string, offset: number, mode: SyntaxMode) {
    this.text = text;
    this.lexer = new Lexer(text, mode);
    this.lexer.jump(offset);
    this.token = Parser.lex(this.nodes, this.lexer, this.nlMode);
  }

  /** Consumes the parser, producing a single top-level node. */
  finishInto(kind: SyntaxKind): SyntaxNode {
    return SyntaxNode.inner(kind, this.nodes);
  }

  /** The kind of the next token to be eaten. */
  current(): SyntaxKind {
    return this.token.kind;
  }

  at(kind: SyntaxKind): boolean {
    return this.token.kind === kind;
  }

  atSet(s: SyntaxSet): boolean {
    return s.contains(this.token.kind);
  }

  /** Whether we're at the end of the token stream (possibly a fake end from the newline mode). */
  end(): boolean {
    return this.at(K.End);
  }

  /** Whether we're at `kind` with no preceding trivia. */
  directlyAt(kind: SyntaxKind): boolean {
    return this.token.kind === kind && !this.hadTrivia();
  }

  hadTrivia(): boolean {
    return this.token.nTrivia > 0;
  }

  hadNewline(): boolean {
    return this.token.newline !== null;
  }

  /** The number of characters until the most recent newline from the start of the current token. */
  currentColumn(): number {
    return this.token.newline?.column ?? this.lexer.column(this.token.start);
  }

  currentText(): string {
    return this.text.slice(this.token.start, this.currentEnd());
  }

  currentStart(): number {
    return this.token.start;
  }

  currentEnd(): number {
    return this.lexer.cursor();
  }

  /** A marker that will point to the current token once it's been eaten. */
  marker(): number {
    return this.nodes.length;
  }

  /** A marker that points to the first trivia before this token. */
  beforeTrivia(): number {
    return this.nodes.length - this.token.nTrivia;
  }

  /** Eats the current node and returns it for in-place mutation. */
  eatAndGet(): SyntaxNode {
    const offset = this.nodes.length;
    this.eat();
    return this.nodes[offset]!;
  }

  /** Eats the token if at `kind`. Returns whether it was eaten. */
  eatIf(kind: SyntaxKind): boolean {
    const at = this.at(kind);
    if (at) this.eat();
    return at;
  }

  /** Asserts that we are at the given kind and eats it. */
  assert(kind: SyntaxKind): void {
    if (this.token.kind !== kind) throw new Error(`parser expected ${K[kind]}, at ${K[this.token.kind]}`);
    this.eat();
  }

  /** Converts the current token's kind and eats it. */
  convertAndEat(kind: SyntaxKind): void {
    this.token.node.convertToKind(kind);
    this.eat();
  }

  /** Eats the current token into `nodes` and lexes the next one. */
  eat(): void {
    this.nodes.push(this.token.node);
    this.token = Parser.lex(this.nodes, this.lexer, this.nlMode);
  }

  /** Detaches the parsed trivia from this token, so that wrapping includes it. */
  flushTrivia(): void {
    this.token.nTrivia = 0;
    this.token.prevEnd = this.token.start;
  }

  /** Wraps the nodes from a marker up to (excluding) the current token in an inner node. */
  wrap(from: number, kind: SyntaxKind): void {
    const to = this.beforeTrivia();
    const start = Math.min(from, to);
    const children = this.nodes.slice(start, to);
    this.nodes.splice(start, to - start, SyntaxNode.inner(kind, children));
  }

  /** Wraps the nodes from a marker up to (excluding) the current token in an error node. */
  wrapError(from: number, message: string): void {
    const to = this.beforeTrivia();
    const start = Math.min(from, to);
    const len = this.nodes.splice(start, to - start).reduce((sum, node) => sum + node.len, 0);
    const end = this.token.prevEnd;
    this.nodes.splice(start, 0, SyntaxNode.error(message, this.text.slice(end - len, end)));
  }

  /** Parses within a syntax mode, re-lexing the final token on exit. */
  enterModes(mode: SyntaxMode, stop: AtNewline, func: (p: Parser) => void): void {
    const previous = this.lexer.mode;
    this.lexer.mode = mode;
    this.withNlMode(stop, func);
    if (mode !== previous) {
      this.lexer.mode = previous;
      this.lexer.jump(this.token.prevEnd);
      this.nodes.length -= this.token.nTrivia;
      this.token = Parser.lex(this.nodes, this.lexer, this.nlMode);
    }
  }

  /** Parses within a newline mode, restoring the token's real kind (or a fake end) on exit. */
  withNlMode(mode: AtNewline, func: (p: Parser) => void): void {
    const previous = this.nlMode;
    this.nlMode = mode;
    func(this);
    this.nlMode = previous;
    if (this.token.newline !== null && !nlModeEq(mode, previous)) {
      // Restore our actual token's kind or insert a fake end.
      const actualKind = this.token.node.kind;
      this.token.kind = stopAt(this.nlMode, this.token.newline, actualKind) ? K.End : actualKind;
    }
  }

  /** Moves the lexer forward and prepares the current token, possibly as a fake `End`. */
  static lex(nodes: SyntaxNode[], lexer: Lexer, nlMode: AtNewline): Token {
    const prevEnd = lexer.cursor();
    let start = prevEnd;
    let [kind, node] = lexer.next();
    let nTrivia = 0;
    let hadNewline = false;
    let parbreak = false;

    while (isTrivia(kind)) {
      hadNewline ||= lexer.newline; // Newlines are always trivia.
      parbreak ||= kind === K.Parbreak;
      nTrivia += 1;
      nodes.push(node);
      start = lexer.cursor();
      [kind, node] = lexer.next();
    }

    let newline: Newline | null = null;
    if (hadNewline) {
      const column = lexer.mode === SyntaxMode.Markup ? lexer.column(start) : null;
      newline = { column, parbreak };
      // Insert a temporary `End` to halt the parser. The actual kind is
      // restored from `node` later.
      if (stopAt(nlMode, newline, kind)) kind = K.End;
    }

    return { kind, node, nTrivia, newline, start, prevEnd };
  }

  // --- Memoization ---------------------------------------------------------

  /** Stores the parsed nodes since `prevLen` and the parser state in the memo. */
  memoizeParsedNodes(key: number, prevLen: number): void {
    const { state, nodeLen } = this.checkpoint();
    const start = this.memo.arena.length;
    for (const node of this.nodes.slice(prevLen, nodeLen)) this.memo.arena.push(node.deepClone());
    this.memo.map.set(key, { start, end: this.memo.arena.length, state });
  }

  /** Restores a memoized result and returns null, or returns a key and checkpoint if there is none. */
  restoreMemoOrCheckpoint(): [number, Checkpoint] | null {
    // The starting index of the current token is the key.
    const key = this.currentStart();
    const entry = this.memo.map.get(key);
    if (entry) {
      for (const node of this.memo.arena.slice(entry.start, entry.end)) this.nodes.push(node.deepClone());
      this.restorePartial(entry.state);
      return null;
    }
    return [key, this.checkpoint()];
  }

  /** Restores the parser to the state at a checkpoint. */
  restore(checkpoint: Checkpoint): void {
    this.nodes.length = checkpoint.nodeLen;
    this.restorePartial(checkpoint.state);
  }

  private restorePartial(state: PartialState): void {
    this.lexer.jump(state.cursor);
    this.lexer.mode = state.lexMode;
    this.token = cloneToken(state.token);
  }

  checkpoint(): Checkpoint {
    return {
      nodeLen: this.nodes.length,
      state: { cursor: this.lexer.cursor(), lexMode: this.lexer.mode, token: cloneToken(this.token) },
    };
  }

  // --- Errors --------------------------------------------------------------

  /** Consumes the given kind or produces an error. */
  expect(kind: SyntaxKind): boolean {
    const at = this.at(kind);
    if (at) {
      this.eat();
    } else if (kind === K.Ident && isKeyword(this.token.kind)) {
      this.trimErrors();
      this.eatAndGet().expected(kindName(kind));
    } else {
      this.balanced &&= !isGrouping(kind);
      this.expected(kindName(kind));
    }
    return at;
  }

  /** Consumes the given closing delimiter, or turns the opening delimiter at `open` into an error. */
  expectClosingDelimiter(open: number, kind: SyntaxKind): boolean {
    const at = this.eatIf(kind);
    if (!at) this.nodes[open]!.convertToError('unclosed delimiter');
    return at;
  }

  /** Produces an error that `thing` was expected. At an erroneous token, eats it instead. */
  expected(thing: string): void {
    if (isError(this.token.kind)) {
      // An erroneous token must be consumed here, so that it was lexed in the
      // correct mode (this matters for typst-syntax's incremental reparsing).
      this.trimErrors();
      this.eat();
    } else if (!this.afterError()) {
      this.expectedAt(this.beforeTrivia(), thing);
    }
  }

  /** Whether the last non-trivia node is an error. */
  private afterError(): boolean {
    const m = this.beforeTrivia();
    return m > 0 && isError(this.nodes[m - 1]!.kind);
  }

  /** Produces an error that `thing` was expected at marker `m`. */
  expectedAt(m: number, thing: string): void {
    this.nodes.splice(m, 0, SyntaxNode.error(`expected ${thing}`, ''));
  }

  /** Adds a hint to a trailing error. */
  hint(hint: string): void {
    this.nodes[this.beforeTrivia() - 1]?.hint(hint);
  }

  /** Consumes the next token and produces an error stating that it was unexpected. */
  unexpected(): void {
    this.trimErrors();
    this.balanced &&= !isGrouping(this.token.kind);
    this.eatAndGet().unexpected();
  }

  /** Removes trailing errors with zero length. */
  private trimErrors(): void {
    const end = this.beforeTrivia();
    let start = end;
    while (start > 0 && isError(this.nodes[start - 1]!.kind) && this.nodes[start - 1]!.len === 0) start -= 1;
    this.nodes.splice(start, end - start);
  }

  /** Checks the depth limit; if exceeded, produces an error and recovers using `stopSet`. */
  checkDepthUntil(stopSet: SyntaxSet): boolean {
    if (this.depth < MAX_DEPTH) return true;
    this.depthCheckError(stopSet);
    return false;
  }

  /**
   * Increases the depth, or produces an error if the limit is exceeded. When
   * this returns true, the caller must decrease `depth` when done.
   */
  increaseDepth(): boolean {
    if (this.depth < MAX_DEPTH) {
      this.depth += 1;
      return true;
    }
    this.depthCheckError(null);
    return false;
  }

  /** Produces an error for an exceeded depth, eating at least one token (and balanced groups). */
  private depthCheckError(stopSet: SyntaxSet | null): void {
    const m = this.marker();
    let balance = 0;
    this.withNlMode(CONTINUE, (p) => {
      for (;;) {
        if (p.atSet(OPENING)) balance += 1;
        else if (p.atSet(CLOSING)) balance = Math.max(0, balance - 1);
        p.eat();
        const atStop = stopSet === null || p.atSet(stopSet);
        if ((balance === 0 && atStop) || p.end()) break;
      }
    });
    this.wrapError(m, 'maximum parsing depth exceeded');
  }
}

const OPENING = of(K.LeftBracket, K.LeftBrace, K.LeftParen);
const CLOSING = of(K.RightBracket, K.RightBrace, K.RightParen);
