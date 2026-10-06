// Ported from Typst 0.15.1: crates/typst-syntax/src/lexer.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { MathClass, defaultMathClass } from '../utils/math-class.js';
import { codepointFromHex } from './ast.js';
import { SyntaxKind as K, SyntaxMode, type SyntaxKind } from './kind.js';
import { SyntaxNode } from './node.js';
import { Scanner } from './scanner.js';
import {
  isAlphanumeric,
  isAsciiAlphanumeric,
  isAsciiDigit,
  isCjk,
  isNumeric,
  isSingleGrapheme,
  isWhitespace,
  isXidContinue,
  isXidStart,
  graphemeLength,
} from './unicode.js';

// Code points the lexer switches on.
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const BANG = 0x21;
const QUOTE = 0x22;
const HASH = 0x23;
const DOLLAR = 0x24;
const PERCENT = 0x25;
const AMP = 0x26;
const APOSTROPHE = 0x27;
const LPAREN = 0x28;
const RPAREN = 0x29;
const STAR = 0x2a;
const PLUS = 0x2b;
const COMMA = 0x2c;
const MINUS = 0x2d;
const DOT = 0x2e;
const SLASH = 0x2f;
const ZERO = 0x30;
const NINE = 0x39;
const COLON = 0x3a;
const SEMICOLON = 0x3b;
const LT = 0x3c;
const EQ = 0x3d;
const GT = 0x3e;
const AT = 0x40;
const LBRACKET = 0x5b;
const BACKSLASH = 0x5c;
const RBRACKET = 0x5d;
const HAT = 0x5e;
const UNDERSCORE = 0x5f;
const BACKTICK = 0x60;
const H = 0x68;
const LBRACE = 0x7b;
const PIPE = 0x7c;
const RBRACE = 0x7d;
const TILDE = 0x7e;
const MINUS_SIGN = 0x2212;

/** An iterator over a source code string which returns tokens. */
export class Lexer {
  /** The scanner: contains the underlying string and location as a "cursor". */
  s: Scanner;
  /** The mode the lexer is in. This determines which kinds of tokens it produces. */
  mode: SyntaxMode;
  /** Whether the last token contained a newline. */
  newline = false;
  /** An error plus hints for the current token. Always null between calls to `next`. */
  private err: { message: string; hints: string[] } | null = null;

  constructor(text: string, mode: SyntaxMode) {
    this.s = new Scanner(text);
    this.mode = mode;
  }

  clone(): Lexer {
    const lexer = new Lexer(this.s.string, this.mode);
    lexer.s.cursor = this.s.cursor;
    lexer.newline = this.newline;
    return lexer;
  }

  /** The index at which the last token ends and the next token will start. */
  cursor(): number {
    return this.s.cursor;
  }

  /** Jumps to the given index in the string. */
  jump(index: number): void {
    this.s.jump(index);
  }

  /** The number of characters until the most recent newline from an index. */
  column(index: number): number {
    const s = this.s.clone();
    s.jump(index);
    let count = 0;
    for (let c = s.scout(-1); c !== undefined && !isNewline(c); c = s.scout(-1)) {
      count++;
      s.uneat();
    }
    return count;
  }

  /** Records a syntax error for the current token. */
  private error(message: string): SyntaxKind {
    this.err = { message, hints: [] };
    return K.Error;
  }

  /** If the current token is an error, adds a hint. */
  private hint(message: string): void {
    this.err?.hints.push(message);
  }

  /** Returns the next token: its kind and its node. */
  next(): [SyntaxKind, SyntaxNode] {
    const start = this.s.cursor;
    this.newline = false;

    let kind: SyntaxKind;
    const c = this.s.eat();
    if (c === undefined) {
      kind = K.End;
    } else if (isSpace(c, this.mode)) {
      kind = this.whitespace(start, c);
    } else if (c === HASH && start === 0 && this.s.eatIf('!')) {
      kind = this.shebang();
    } else if (c === SLASH && this.s.eatIf('/')) {
      kind = this.lineComment();
    } else if (c === SLASH && this.s.eatIf('*')) {
      kind = this.blockComment();
    } else if (c === STAR && this.s.eatIf('/')) {
      kind = this.error('unexpected end of block comment');
      this.hint('consider escaping the `*` with a backslash or opening the block comment with `/*`');
    } else if (c === BACKTICK && this.mode !== SyntaxMode.Math) {
      return this.raw();
    } else if (this.mode === SyntaxMode.Markup) {
      kind = this.markup(start, c);
    } else if (this.mode === SyntaxMode.Math) {
      const [mathKind, node] = this.math(start, c);
      if (node) return [mathKind, node];
      kind = mathKind;
    } else {
      kind = this.code(start, c);
    }

    const text = this.s.from(start);
    const err = this.err;
    this.err = null;
    const node = err ? SyntaxNode.error(err.message, text).withHints(err.hints) : SyntaxNode.leaf(kind, text);
    return [kind, node];
  }

  /** Eats whitespace characters greedily. */
  private whitespace(start: number, c: number): SyntaxKind {
    const more = this.s.eatWhile((ch) => isSpace(ch, this.mode));
    const newlines = c === SPACE && more.length === 0 ? 0 : countNewlines(this.s.from(start));
    this.newline = newlines > 0;
    return this.mode === SyntaxMode.Markup && newlines >= 2 ? K.Parbreak : K.Space;
  }

  private shebang(): SyntaxKind {
    this.s.eatUntil(isNewline);
    return K.Shebang;
  }

  private lineComment(): SyntaxKind {
    this.s.eatUntil(isNewline);
    return K.LineComment;
  }

  private blockComment(): SyntaxKind {
    let state = UNDERSCORE;
    let depth = 1;

    // Find the first `*/` that does not correspond to a nested `/*`.
    for (let c = this.s.eat(); c !== undefined; c = this.s.eat()) {
      if (state === STAR && c === SLASH) {
        depth -= 1;
        if (depth === 0) break;
        state = UNDERSCORE;
      } else if (state === SLASH && c === STAR) {
        depth += 1;
        state = UNDERSCORE;
      } else {
        state = c;
      }
    }

    return K.BlockComment;
  }

  // --- Raw ---------------------------------------------------------------

  /** Lexes an entire raw segment at once, to avoid going back and forth with the parser. */
  private raw(): [SyntaxKind, SyntaxNode] {
    const start = this.s.cursor - 1;

    // Determine number of opening backticks.
    let backticks = 1;
    while (this.s.eatIf('`')) backticks += 1;

    // Special case for ``.
    if (backticks === 2) {
      const nodes = [SyntaxNode.leaf(K.RawDelim, '`'), SyntaxNode.leaf(K.RawDelim, '`')];
      return [K.Raw, SyntaxNode.inner(K.Raw, nodes)];
    }

    // Find end of raw text.
    let found = 0;
    while (found < backticks) {
      const c = this.s.eat();
      if (c === BACKTICK) found += 1;
      else if (c !== undefined) found = 0;
      else return [K.Error, SyntaxNode.error('unclosed raw text', this.s.from(start))];
    }
    const end = this.s.cursor;

    const inner = new Scanner(this.s.get(start + backticks, end - backticks));
    const innerLen = inner.string.length;

    // Opening delimiter.
    const delim = SyntaxNode.leaf(K.RawDelim, this.s.from(end - backticks));
    const nodes = [delim];

    let tag: string | null = null;
    let diffFutureTagLen: number | null = null;
    if (delim.len >= 3) {
      [tag, diffFutureTagLen] = rawLangTag(inner);
      if (tag !== null) nodes.push(SyntaxNode.leaf(K.RawLang, tag));
      blockyRaw(inner, nodes);
    } else {
      inlineRaw(inner, nodes);
    }

    // Closing delimiter.
    nodes.push(delim.clone());

    const raw = SyntaxNode.inner(K.Raw, nodes);
    addRawWarnings(raw, backticks, diffFutureTagLen, tag, innerLen);
    return [K.Raw, raw];
  }

  // --- Markup ------------------------------------------------------------

  private markup(start: number, c: number): SyntaxKind {
    const s = this.s;
    switch (c) {
      case BACKSLASH:
        return this.backslash();
      case H:
        if (s.eatIf('ttp://') || s.eatIf('ttps://')) return this.link();
        return this.text();
      case LT:
        return s.at(isIdContinue) ? this.label() : this.text();
      case AT:
        return s.at(isIdContinue) ? this.refMarker() : this.text();
      case DOT:
        return s.eatIf('..') ? K.Shorthand : this.text();
      case MINUS:
        if (s.eatIf('--') || s.eatIf('-') || s.eatIf('?') || s.at(isNumeric)) return K.Shorthand;
        return this.spaceOrEnd() ? K.ListMarker : this.text();
      case STAR:
        return this.inWord() ? this.text() : K.Star;
      case UNDERSCORE:
        return this.inWord() ? this.text() : K.Underscore;
      case HASH:
        return K.Hash;
      case LBRACKET:
        return K.LeftBracket;
      case RBRACKET:
        return K.RightBracket;
      case APOSTROPHE:
      case QUOTE:
        return K.SmartQuote;
      case DOLLAR:
        return K.Dollar;
      case TILDE:
        return K.Shorthand;
      case COLON:
        return K.Colon;
      case EQ:
        s.eatWhile('=');
        return this.spaceOrEnd() ? K.HeadingMarker : this.text();
      case PLUS:
        return this.spaceOrEnd() ? K.EnumMarker : this.text();
      case SLASH:
        return this.spaceOrEnd() ? K.TermMarker : this.text();
      default:
        if (c >= ZERO && c <= NINE) return this.numbering(start);
        return this.text();
    }
  }

  private backslash(): SyntaxKind {
    if (this.s.eatIf('u{')) {
      const hex = this.s.eatWhile(isAsciiAlphanumeric);
      if (!this.s.eatIf('}')) return this.error('unclosed Unicode escape sequence');
      if (codepointFromHex(hex) === null) return this.error(`invalid Unicode codepoint: ${hex}`);
      return K.Escape;
    }

    if (this.s.done() || this.s.at(isWhitespace)) return K.Linebreak;
    this.s.eat();
    return K.Escape;
  }

  private link(): SyntaxKind {
    const [link, balanced] = linkPrefix(this.s.after());
    this.s.advance(link.length);
    if (!balanced) {
      return this.error('automatic links cannot contain unbalanced brackets, use the `link` function instead');
    }
    return K.Link;
  }

  private numbering(start: number): SyntaxKind {
    this.s.eatWhile(isAsciiDigit);
    const read = this.s.from(start);
    if (this.s.eatIf('.') && this.spaceOrEnd() && BigInt(read) <= U64_MAX) return K.EnumMarker;
    return this.text();
  }

  private refMarker(): SyntaxKind {
    this.s.eatWhile(isValidInLabelLiteral);
    // Don't include the trailing characters likely to be part of text.
    for (let c = this.s.scout(-1); c === DOT || c === COLON; c = this.s.scout(-1)) this.s.uneat();
    return K.RefMarker;
  }

  private label(): SyntaxKind {
    const label = this.s.eatWhile(isValidInLabelLiteral);
    if (label.length === 0) return this.error('label cannot be empty');
    if (!this.s.eatIf('>')) return this.error('unclosed label');
    return K.Label;
  }

  private text(): SyntaxKind {
    for (;;) {
      this.s.eatUntil((c) => (c < 0x80 ? TEXT_STOP[c] === 1 : isWhitespace(c)));

      // Continue with the same text node if the thing would become text anyway.
      const s = this.s.clone();
      const c = s.eat();
      let proceed: boolean;
      switch (c) {
        case SPACE:
          proceed = s.at(isAlphanumeric);
          break;
        case SLASH:
          proceed = !s.at(['/', '*']);
          break;
        case MINUS:
          proceed = !s.at(['-', '?']);
          break;
        case DOT:
          proceed = !s.at('..');
          break;
        case H:
          proceed = !s.at('ttp://') && !s.at('ttps://');
          break;
        case AT:
          proceed = !s.at(isValidInLabelLiteral);
          break;
        default:
          proceed = false;
      }
      if (!proceed) break;
      this.s = s;
    }
    return K.Text;
  }

  private inWord(): boolean {
    const wordy = (c: number | undefined) => c !== undefined && isAlphanumeric(c) && !isCjk(c);
    return wordy(this.s.scout(-2)) && wordy(this.s.peek());
  }

  private spaceOrEnd(): boolean {
    return this.s.done() || this.s.at(isWhitespace) || this.s.at('//') || this.s.at('/*');
  }

  // --- Math --------------------------------------------------------------

  private math(start: number, c: number): [SyntaxKind, SyntaxNode | null] {
    const s = this.s;
    const short = K.MathShorthand;
    switch (c) {
      case BACKSLASH:
        return [this.backslash(), null];
      case QUOTE:
        return [this.string(), null];
      case MINUS:
        if (s.eatIf('>>') || s.eatIf('>') || s.eatIf('->')) return [short, null];
        return [short, null]; // `-` alone is a shorthand too.
      case COLON:
        if (s.eatIf('=') || s.eatIf(':=')) return [short, null];
        break;
      case BANG:
        return [s.eatIf('=') ? short : K.Bang, null];
      case DOT:
        return [s.eatIf('..') ? short : K.Dot, null];
      case LT:
        if (
          s.eatIf('==>') ||
          s.eatIf('-->') ||
          s.eatIf('--') ||
          s.eatIf('-<') ||
          s.eatIf('->') ||
          s.eatIf('<-') ||
          s.eatIf('<<') ||
          s.eatIf('=>') ||
          s.eatIf('==') ||
          s.eatIf('~~') ||
          s.eatIf('=') ||
          s.eatIf('<') ||
          s.eatIf('-') ||
          s.eatIf('~')
        ) {
          return [short, null];
        }
        break;
      case GT:
        if (s.eatIf('->') || s.eatIf('>>') || s.eatIf('=') || s.eatIf('>')) return [short, null];
        break;
      case EQ:
        if (s.eatIf('=>') || s.eatIf('>') || s.eatIf(':')) return [short, null];
        break;
      case PIPE:
        if (s.eatIf('->') || s.eatIf('=>') || s.eatIf('|')) return [short, null];
        if (s.eatIf(']')) return [K.RightBrace, null];
        break;
      case TILDE:
        s.eatIf('~>') || s.eatIf('>');
        return [short, null];
      case STAR:
        return [short, null];
      case COMMA:
        return [K.Comma, null];
      case SEMICOLON:
        return [K.Semicolon, null];
      case HASH:
        return [K.Hash, null];
      case UNDERSCORE:
        return [K.Underscore, null];
      case DOLLAR:
        return [K.Dollar, null];
      case SLASH:
        return [K.Slash, null];
      case HAT:
        return [K.Hat, null];
      case AMP:
        return [K.MathAlignPoint, null];
      case 0x221a: // √
      case 0x221b: // ∛
      case 0x221c: // ∜
        return [K.Root, null];
      case APOSTROPHE:
        s.eatWhile("'");
        return [K.MathPrimes, null];
      // Delimiters are lexed as `{Left,Right}{Brace,Paren}` and converted back
      // to `MathText` or `MathShorthand` in the parser.
      case LPAREN:
        return [K.LeftParen, null];
      case RPAREN:
        return [K.RightParen, null];
      case LBRACKET:
        if (s.eatIf('|')) return [K.LeftBrace, null];
        break;
    }

    const cls = defaultMathClass(c);
    if (cls === MathClass.Opening) return [K.LeftBrace, null];
    if (cls === MathClass.Closing) return [K.RightBrace, null];

    // Identifiers.
    if (isMathIdStart(c) && s.at(isMathIdContinue)) {
      s.eatWhile(isMathIdContinue);
      // A single grapheme, such as a letter with a combining accent, is text.
      if (isSingleGrapheme(s.from(start))) return [K.MathText, null];
      return this.mathIdentOrField(start);
    }

    // Other math atoms.
    return [this.mathText(start, c), null];
  }

  /** Lexes a single `MathIdent` or an entire `MathFieldAccess`. */
  private mathIdentOrField(start: number): [SyntaxKind, SyntaxNode] {
    let kind: SyntaxKind = K.MathIdent;
    let node = SyntaxNode.leaf(kind, this.s.from(start));
    for (let ident = this.maybeDotIdent(); ident !== null; ident = this.maybeDotIdent()) {
      kind = K.MathFieldAccess;
      node = SyntaxNode.inner(kind, [node, SyntaxNode.leaf(K.Dot, '.'), SyntaxNode.leaf(K.MathIdent, ident)]);
    }
    return [kind, node];
  }

  /** If at a dot and a math identifier, eats and returns the identifier. */
  private maybeDotIdent(): string | null {
    const next = this.s.scout(1);
    if (next !== undefined && isMathIdStart(next) && this.s.eatIf('.')) {
      const identStart = this.s.cursor;
      this.s.eat();
      this.s.eatWhile(isMathIdContinue);
      return this.s.from(identStart);
    }
    return null;
  }

  private mathText(start: number, c: number): SyntaxKind {
    // Keep numbers and grapheme clusters together.
    if (isNumeric(c)) {
      this.s.eatWhile(isNumeric);
      const s = this.s.clone();
      if (s.eatIf('.') && s.eatWhile(isNumeric).length > 0) this.s = s;
    } else {
      this.s.jump(start + graphemeLength(this.s.string, start));
    }
    return K.MathText;
  }

  /** Handles named arguments in a math function call: `name: value`. */
  maybeMathNamedArg(start: number): SyntaxNode | null {
    const cursor = this.s.cursor;
    this.s.jump(start);
    if (this.s.eatIf(isIdStart)) {
      this.s.eatWhile(isIdContinue);
      // Check that a colon directly follows the identifier, and not the `:=`
      // or `::=` math shorthands.
      if (this.s.at(':') && !this.s.at(':=') && !this.s.at('::=')) {
        const text = this.s.from(start);
        // Check that the identifier is not just `_`.
        return text !== '_'
          ? SyntaxNode.leaf(K.Ident, text)
          : SyntaxNode.error('expected identifier, found underscore', text);
      }
    }
    this.s.jump(cursor);
    return null;
  }

  /** Handles spread arguments in a math function call: `..args`. */
  maybeMathSpreadArg(start: number): SyntaxNode | null {
    const cursor = this.s.cursor;
    this.s.jump(start);
    if (this.s.eatIf('..')) {
      // A spread is only inferred if not followed by space/trivia/end, a dot
      // (that would clash with the `...` shorthand), or an end-of-argument
      // character (that spreads nothing).
      if (!this.spaceOrEnd() && !this.s.at(['.', ',', ';', ')', '$'])) {
        return SyntaxNode.leaf(K.Dots, this.s.from(start));
      }
    }
    this.s.jump(cursor);
    return null;
  }

  // --- Code --------------------------------------------------------------

  private code(start: number, c: number): SyntaxKind {
    const s = this.s;
    if (c === LT && s.at(isIdContinue)) return this.label();
    if (c >= ZERO && c <= NINE) return this.number(start, c);
    if (c === DOT && s.at(isAsciiDigit)) return this.number(start, c);
    if (c === QUOTE) return this.string();

    if (c === EQ && s.eatIf('=')) return K.EqEq;
    if (c === BANG && s.eatIf('=')) return K.ExclEq;
    if (c === LT && s.eatIf('=')) return K.LtEq;
    if (c === GT && s.eatIf('=')) return K.GtEq;
    if (c === PLUS && s.eatIf('=')) return K.PlusEq;
    if ((c === MINUS || c === MINUS_SIGN) && s.eatIf('=')) return K.HyphEq;
    if (c === STAR && s.eatIf('=')) return K.StarEq;
    if (c === SLASH && s.eatIf('=')) return K.SlashEq;
    if (c === DOT && s.eatIf('.')) return K.Dots;
    if (c === EQ && s.eatIf('>')) return K.Arrow;

    switch (c) {
      case LBRACE:
        return K.LeftBrace;
      case RBRACE:
        return K.RightBrace;
      case LBRACKET:
        return K.LeftBracket;
      case RBRACKET:
        return K.RightBracket;
      case LPAREN:
        return K.LeftParen;
      case RPAREN:
        return K.RightParen;
      case DOLLAR:
        return K.Dollar;
      case COMMA:
        return K.Comma;
      case SEMICOLON:
        return K.Semicolon;
      case COLON:
        return K.Colon;
      case DOT:
        return K.Dot;
      case PLUS:
        return K.Plus;
      case MINUS:
      case MINUS_SIGN:
        return K.Minus;
      case STAR:
        return K.Star;
      case SLASH:
        return K.Slash;
      case EQ:
        return K.Eq;
      case LT:
        return K.Lt;
      case GT:
        return K.Gt;
    }

    if (isIdStart(c)) return this.ident(start);
    return this.invalidCharInCode(c);
  }

  /** An error for an invalid character in code, with hints for commonly confused operators. */
  private invalidCharInCode(c: number): SyntaxKind {
    const invalidChar = `the character \`${String.fromCodePoint(c)}\` is not valid in code`;
    const invalidStr = (s: string) => `\`${s}\` is not valid in code`;
    if (this.s.scout(-2) === HASH) {
      // A custom hint if we immediately follow a hash.
      this.error(invalidChar);
      this.hint('the preceding hash is causing this to parse in code mode');
      this.hint('try escaping the preceding hash: `\\#`');
    } else if (c === HASH) {
      this.error(invalidChar);
      this.hint('you are already in code mode');
      this.hint('try removing the `#`');
    } else if (c === AMP && this.s.eatIf('&')) {
      this.error(invalidStr('&&'));
      this.hint('in Typst, `and` is used for logical AND');
    } else if (c === PIPE && this.s.eatIf('|')) {
      this.error(invalidStr('||'));
      this.hint('in Typst, `or` is used for logical OR');
    } else if (c === BANG) {
      this.error(invalidChar);
      this.hint('in Typst, `not` is used for negation');
      this.hint('or did you mean to write `!=` for not-equal?');
    } else if (c === TILDE && this.s.eatIf('=')) {
      this.error(invalidStr('~='));
      this.hint('in Typst, `!=` is used for not-equal');
    } else {
      this.error(invalidChar);
    }
    return K.Error;
  }

  private ident(start: number): SyntaxKind {
    this.s.eatWhile(isIdContinue);
    const ident = this.s.from(start);

    const prev = this.s.get(0, start);
    if (!prev.endsWith('.') && !prev.endsWith('@')) {
      const kw = keyword(ident);
      if (kw !== null) return kw;
    } else if (prev.endsWith('..')) {
      const kw = keyword(ident);
      if (kw !== null) return kw;
    }

    return ident === '_' ? K.Underscore : K.Ident;
  }

  /**
   * Lexes a number: an integer or a float, possibly with a unit suffix (`pt`,
   * `deg`, `%`, ...). Integers may have a prefix for binary, octal or
   * hexadecimal, but only base-10 numbers can have a suffix.
   */
  private number(start: number, firstC: number): SyntaxKind {
    // Handle alternative integer bases.
    let base = 10;
    if (firstC === ZERO) {
      if (this.s.eatIf('b')) base = 2;
      else if (this.s.eatIf('o')) base = 8;
      else if (this.s.eatIf('x')) base = 16;
    }

    // Read the initial digits.
    if (base === 16) this.s.eatWhile(isAsciiAlphanumeric);
    else this.s.eatWhile(isAsciiDigit);

    // Read floating point digits and exponents.
    let isFloat = false;
    if (base === 10) {
      // Read digits following a dot. Make sure not to confuse a spread
      // operator or a method call for the decimal separator.
      if (firstC === DOT) {
        isFloat = true; // We already ate the trailing digits above.
      } else {
        const afterDot = this.s.scout(1);
        if (!this.s.at('..') && !(afterDot !== undefined && isIdStart(afterDot)) && this.s.eatIf('.')) {
          isFloat = true;
          this.s.eatWhile(isAsciiDigit);
        }
      }

      // Read the exponent.
      if (!this.s.at('em') && this.s.eatIf(['e', 'E'])) {
        isFloat = true;
        this.s.eatIf(['+', '-']);
        this.s.eatWhile(isAsciiDigit);
      }
    }

    const number = this.s.from(start);
    const suffix = this.s.eatWhile((c) => isAsciiAlphanumeric(c) || c === PERCENT);

    // Parse large integer literals as floats.
    if (base === 10 && !isFloat && BigInt(number) > I64_MAX && isValidFloat(number)) isFloat = true;

    let suffixError: string | null = null;
    const hasSuffix = suffix !== '';
    if (hasSuffix && !NUMBER_SUFFIXES.has(suffix)) suffixError = `invalid number suffix: \`${suffix}\``;

    let numberError: string | null = null;
    if (isFloat && !isValidFloat(number)) {
      // The only invalid case should be when a float lacks digits after the
      // exponent: e.g. `1.2e`, `2.3E-`, or `1EM`.
      numberError = `invalid floating point number: \`${number}\``;
    } else if (base !== 10) {
      const name = base === 2 ? 'binary' : base === 8 ? 'octal' : 'hexadecimal';
      // `slice(2)` skips the leading `0b`/`0o`/`0x`.
      const value = parseI64(number.slice(2), base);
      if (typeof value === 'bigint') {
        if (hasSuffix) {
          if (suffixError === null) suffixError = `try using a decimal number: \`${value}${suffix}\``;
          numberError = `${name} numbers cannot have a suffix`;
        }
      } else if (value === 'empty') {
        numberError = `expected a${base === 8 ? 'n' : ''} ${name} number`;
      } else {
        numberError = `invalid ${name} number: \`${number}\``;
      }
    }

    // Return our number or write an error with helpful hints.
    if (numberError === null && suffixError === null) {
      if (hasSuffix) return K.Numeric;
      return isFloat ? K.Float : K.Int;
    }
    if (numberError !== null && suffixError !== null) {
      const error = this.error(numberError);
      this.hint(suffixError);
      return error;
    }
    return this.error((numberError ?? suffixError)!);
  }

  private string(): SyntaxKind {
    let escaped = false;
    this.s.eatUntil((c) => {
      const stop = c === QUOTE && !escaped;
      escaped = c === BACKSLASH && !escaped;
      return stop;
    });

    if (!this.s.eatIf('"')) return this.error('unclosed string');
    return K.Str;
  }
}

const NUMBER_SUFFIXES = new Set(['pt', 'mm', 'cm', 'in', 'deg', 'rad', 'em', 'fr', '%']);
const I64_MAX = (1n << 63n) - 1n;
const U64_MAX = (1n << 64n) - 1n;

/** Whether `text` parses as Rust's `f64` (for the number shapes the lexer produces). */
function isValidFloat(text: string): boolean {
  return /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text);
}

/** Parses digits as Rust's `i64::from_str_radix`: a value, or why it failed. */
function parseI64(digits: string, base: number): bigint | 'empty' | 'invalid' {
  if (digits === '') return 'empty';
  const valid = base === 2 ? /^[01]+$/ : base === 8 ? /^[0-7]+$/ : /^[0-9a-fA-F]+$/;
  if (!valid.test(digits)) return 'invalid';
  const prefix = base === 2 ? '0b' : base === 8 ? '0o' : '0x';
  const value = BigInt(prefix + digits);
  return value > I64_MAX ? 'invalid' : value;
}

const KEYWORDS: Record<string, SyntaxKind> = {
  none: K.None,
  auto: K.Auto,
  true: K.Bool,
  false: K.Bool,
  not: K.Not,
  and: K.And,
  or: K.Or,
  let: K.Let,
  set: K.Set,
  show: K.Show,
  context: K.Context,
  if: K.If,
  else: K.Else,
  for: K.For,
  in: K.In,
  while: K.While,
  break: K.Break,
  continue: K.Continue,
  return: K.Return,
  import: K.Import,
  include: K.Include,
  as: K.As,
};

/** Tries to parse an identifier into a keyword. */
function keyword(ident: string): SyntaxKind | null {
  return Object.hasOwn(KEYWORDS, ident) ? KEYWORDS[ident]! : null;
}

/** Characters that end a text run in markup (ASCII only; others stop on whitespace). */
const TEXT_STOP = new Uint8Array(128);
for (const c of ' \t\n\x0b\x0c\r\\/[]~-.\'"*_:h`$<>@#') TEXT_STOP[c.charCodeAt(0)] = 1;

/** Eats a newline, treating CR LF as one. */
function eatNewline(s: Scanner): boolean {
  const ate = s.eatIf(isNewline);
  if (ate && s.before().endsWith('\r')) s.eatIf('\n');
  return ate;
}

function allWhitespace(text: string): boolean {
  for (const c of text) if (!isWhitespace(c.codePointAt(0)!)) return false;
  return true;
}

/** Rust's `str::trim_end`: trims White_Space characters (JavaScript's `trimEnd` also trims a BOM). */
function trimEndWhitespace(text: string): string {
  const s = new Scanner(text, text.length);
  while (s.cursor > 0 && isWhitespace(s.scout(-1)!)) s.uneat();
  return s.before();
}

function leadingWhitespace(text: string): number {
  let count = 0;
  for (const c of text) {
    if (!isWhitespace(c.codePointAt(0)!)) break;
    count++;
  }
  return count;
}

/** Lexes the raw language tag, and returns the length of the future tag if it will differ in the next version. */
function rawLangTag(s: Scanner): [string | null, number | null] {
  const start = s.cursor;
  const futureTag = s.eatUntil((c) => isWhitespace(c) || c === BACKTICK);
  if (futureTag === '') {
    // The future tag is always longer than the current tag; if it is empty,
    // there is no current tag either.
    return [null, null];
  }
  s.jump(start);
  let tag: string | null = null;
  if (s.eatIf(isIdStart)) {
    s.eatWhile(isIdContinue);
    tag = s.from(start);
  }
  const diff = tag === null || tag.length !== futureTag.length ? futureTag.length : null;
  return [tag, diff];
}

/**
 * Raw blocks parse a language tag, trim whitespace on the first and last
 * lines, and dedent the other lines by their common leading whitespace.
 * See typst-syntax's `Lexer::blocky_raw` for the exact rules.
 */
function blockyRaw(s: Scanner, nodes: SyntaxNode[]): void {
  // The lines between the backticks.
  const lines = splitNewlines(s.after());

  // Determine dedent level. The closing line always counts.
  let dedent = Infinity;
  for (const line of lines.slice(1)) if (!allWhitespace(line)) dedent = Math.min(dedent, leadingWhitespace(line));
  dedent = Math.min(dedent, leadingWhitespace(lines[lines.length - 1]!));
  if (dedent === Infinity) dedent = 0;

  // Trim whitespace from the last line. It is added as `RawTrimmed` at the end.
  if (allWhitespace(lines[lines.length - 1]!)) {
    lines.pop();
  } else {
    // If the last line ends in a backtick, try to trim a single space.
    const last = lines[lines.length - 1]!;
    if (trimEndWhitespace(last).endsWith('`') && last.endsWith(' ')) lines[lines.length - 1] = last.slice(0, -1);
  }

  let prev = s.cursor;
  const pushLeaf = (kind: SyntaxKind) => {
    nodes.push(SyntaxNode.leaf(kind, s.from(prev)));
    prev = s.cursor;
  };

  // The first line: trim it if it is all whitespace, else trim a single
  // leading space. It does not affect the dedent.
  let index = 0;
  if (lines.length > 0) {
    const first = lines[0]!;
    index = 1;
    if (allWhitespace(first)) {
      s.advance(first.length);
    } else {
      const lineEnd = s.cursor + first.length;
      if (s.eatIf(' ')) pushLeaf(K.RawTrimmed);
      s.jump(lineEnd);
      pushLeaf(K.Text);
    }
  }

  // Add lines.
  for (const line of lines.slice(index)) {
    let offset = 0;
    let taken = 0;
    for (const c of line) {
      if (taken++ >= dedent) break;
      offset += c.length;
    }
    eatNewline(s);
    s.advance(offset);
    pushLeaf(K.RawTrimmed);
    s.advance(line.length - offset);
    pushLeaf(K.Text);
  }

  // Add final trimmed.
  if (!s.done()) nodes.push(SyntaxNode.leaf(K.RawTrimmed, s.after()));
}

/** Inline raw text keeps all whitespace; newlines become `RawTrimmed`. */
function inlineRaw(s: Scanner, nodes: SyntaxNode[]): void {
  let prev = s.cursor;
  while (!s.done()) {
    if (s.at(isNewline)) {
      nodes.push(SyntaxNode.leaf(K.Text, s.from(prev)));
      prev = s.cursor;
      eatNewline(s);
      nodes.push(SyntaxNode.leaf(K.RawTrimmed, s.from(prev)));
      prev = s.cursor;
      continue;
    }
    s.eat();
  }
  nodes.push(SyntaxNode.leaf(K.Text, s.from(prev)));
}

/** Warns if the raw language tag will differ in the next version of Typst, or if the raw text is empty. */
function addRawWarnings(
  raw: SyntaxNode,
  backticks: number,
  diffFutureTagLen: number | null,
  tag: string | null,
  innerLen: number,
): void {
  if (diffFutureTagLen !== null) {
    const futureRange: [number, number] = [backticks, backticks + diffFutureTagLen];
    if (tag !== null) {
      raw.warnAt(futureRange, 'no whitespace between language tag and raw text');
      raw.hint(`currently, Typst is treating \`${tag}\` as the language tag`);
      raw.hint(
        'in the next version of Typst, this will change and we will treat all text until the first whitespace as the language tag',
      );
      const tagRange: [number, number] = [backticks, backticks + tag.length];
      raw.hintAt(tagRange, `if the current behavior is correct, please add a space after \`${tag}\``);
      raw.hintAt(tagRange, 'otherwise, add a space or newline after the initial backticks');
    } else {
      raw.warnAt(futureRange, 'no whitespace before raw text');
      raw.hint('in the next version of Typst, this text will be treated as the language tag for this element');
      raw.hint('to avoid this, add a space after the initial backticks');
    }
  } else if (tag !== null && innerLen === tag.length) {
    // Empty with no tag/whitespace is only possible with exactly two
    // backticks, which the caller handles.
    raw.warn('empty raw text');
    raw.hint(`Typst is treating \`${tag}\` as the language tag`);
    raw.hintAt([backticks, backticks + tag.length], 'to treat this as text, add a space after the initial backticks');
  }
}

/** Whether a character will become a `Space` token. */
function isSpace(c: number, mode: SyntaxMode): boolean {
  return mode === SyntaxMode.Markup ? c === SPACE || c === TAB || isNewline(c) : isWhitespace(c);
}

/** Whether a character is interpreted as a newline by Typst. */
export function isNewline(c: number): boolean {
  // Line Feed, Vertical Tab, Form Feed, Carriage Return, Next Line, Line
  // Separator, Paragraph Separator.
  return (c >= LF && c <= CR) || c === 0x85 || c === 0x2028 || c === 0x2029;
}

/** ASCII punctuation allowed in automatic links, besides letters, digits and brackets. */
const LINK_CHARS = "!#$%&*+,-./:;=?@_~'";

/** The prefix of the text that is a link, and whether its parentheses and brackets were balanced. */
export function linkPrefix(text: string): [string, boolean] {
  const s = new Scanner(text);
  const brackets: number[] = [];

  s.eatWhile((c) => {
    if (c >= 0x80) return false;
    if (isAsciiAlphanumeric(c) || LINK_CHARS.includes(String.fromCharCode(c))) return true;
    if (c === LBRACKET || c === LPAREN) {
      brackets.push(c);
      return true;
    }
    if (c === RBRACKET) return brackets.pop() === LBRACKET;
    if (c === RPAREN) return brackets.pop() === LPAREN;
    return false;
  });

  // Don't include the trailing characters likely to be part of text.
  const trailing = (c: number | undefined) => c !== undefined && c < 0x80 && "!,.:;?'".includes(String.fromCharCode(c));
  while (trailing(s.scout(-1))) s.uneat();

  return [s.before(), brackets.length === 0];
}

/** Splits text at newlines. The newline characters are not kept. */
export function splitNewlines(text: string): string[] {
  const s = new Scanner(text);
  const lines: string[] = [];
  let start = 0;
  let end = 0;
  for (let c = s.eat(); c !== undefined; c = s.eat()) {
    if (isNewline(c)) {
      if (c === CR) s.eatIf('\n');
      lines.push(text.slice(start, end));
      start = s.cursor;
    }
    end = s.cursor;
  }
  lines.push(text.slice(start));
  return lines;
}

/** Counts the newlines in text, treating CR LF as one. */
function countNewlines(text: string): number {
  let newlines = 0;
  const s = new Scanner(text);
  for (let c = s.eat(); c !== undefined; c = s.eat()) {
    if (isNewline(c)) {
      if (c === CR) s.eatIf('\n');
      newlines += 1;
    }
  }
  return newlines;
}

/** Whether a string is a valid identifier. */
export function isIdent(text: string): boolean {
  let first = true;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (first ? !isIdStart(c) : !isIdContinue(c)) return false;
    first = false;
  }
  return !first;
}

/** Whether a character can start an identifier. */
export function isIdStart(c: number): boolean {
  return isXidStart(c) || c === UNDERSCORE;
}

/** Whether a character can continue an identifier. */
export function isIdContinue(c: number): boolean {
  return isXidContinue(c) || c === UNDERSCORE || c === MINUS;
}

/** Whether a character can start an identifier in math. */
function isMathIdStart(c: number): boolean {
  return isXidStart(c);
}

/** Whether a character can continue an identifier in math. */
function isMathIdContinue(c: number): boolean {
  return isXidContinue(c) && c !== UNDERSCORE;
}

/** Whether a character can be part of a label literal's name. */
function isValidInLabelLiteral(c: number): boolean {
  return isIdContinue(c) || c === COLON || c === DOT;
}
