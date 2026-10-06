// Typlet original: not ported from Typst.
//
// A string scanner with the API of the `unscanny` crate, which typst-syntax's
// lexer is written against. Positions are UTF-16 indices, and the scanner
// steps over whole code points, as Rust steps over `char`s.

/**
 * What the scanner can match at its cursor:
 * - a string: the text must start with it;
 * - an array of characters: the next character must be one of them;
 * - a predicate: the next code point must satisfy it.
 */
export type Pattern = string | readonly string[] | ((c: number) => boolean);

export class Scanner {
  cursor: number;

  constructor(
    readonly string: string,
    cursor = 0,
  ) {
    this.cursor = cursor;
  }

  clone(): Scanner {
    return new Scanner(this.string, this.cursor);
  }

  done(): boolean {
    return this.cursor >= this.string.length;
  }

  /** The text before the cursor. */
  before(): string {
    return this.string.slice(0, this.cursor);
  }

  /** The text after the cursor. */
  after(): string {
    return this.string.slice(this.cursor);
  }

  /** The text from `start` to the cursor. */
  from(start: number): string {
    return start >= this.cursor ? '' : this.string.slice(start, this.cursor);
  }

  /** The text in `[start, end)`, clamped to the string. */
  get(start: number, end: number): string {
    return this.string.slice(Math.max(0, start), Math.min(this.string.length, end));
  }

  /** Moves the cursor to `target`, clamped to the string. */
  jump(target: number): void {
    this.cursor = Math.max(0, Math.min(this.string.length, target));
  }

  /** Advances the cursor by `by` UTF-16 units. */
  advance(by: number): void {
    this.jump(this.cursor + by);
  }

  /** The code point at the cursor, without consuming it. */
  peek(): number | undefined {
    return this.string.codePointAt(this.cursor);
  }

  /** Consumes and returns the code point at the cursor. */
  eat(): number | undefined {
    const c = this.string.codePointAt(this.cursor);
    if (c !== undefined) this.cursor += c > 0xffff ? 2 : 1;
    return c;
  }

  /** Moves the cursor back by one code point. */
  uneat(): void {
    this.cursor = this.locate(-1);
  }

  /** The index of the code point after the one at `i`. */
  private next(i: number): number {
    return i + (this.string.codePointAt(i)! > 0xffff ? 2 : 1);
  }

  /** The index of the code point before index `i` (which must be > 0). */
  private prev(i: number): number {
    const low = this.string.charCodeAt(i - 1);
    if (low >= 0xdc00 && low <= 0xdfff && i >= 2) {
      const high = this.string.charCodeAt(i - 2);
      if (high >= 0xd800 && high <= 0xdbff) return i - 2;
    }
    return i - 1;
  }

  /**
   * The UTF-16 index of the code point `n` code points from the cursor,
   * clamped to the string.
   */
  locate(n: number): number {
    let i = this.cursor;
    for (let k = 0; k < n && i < this.string.length; k++) i = this.next(i);
    for (let k = 0; k < -n && i > 0; k++) i = this.prev(i);
    return i;
  }

  /**
   * The code point `n` code points from the cursor: `scout(0)` is `peek()`,
   * `scout(-1)` the code point before the cursor. Undefined past either end.
   */
  scout(n: number): number | undefined {
    let i = this.cursor;
    for (let k = 0; k < n; k++) {
      if (i >= this.string.length) return undefined;
      i = this.next(i);
    }
    for (let k = 0; k < -n; k++) {
      if (i <= 0) return undefined;
      i = this.prev(i);
    }
    return this.string.codePointAt(i);
  }

  /** The UTF-16 length of the match at the cursor, or -1 if `pattern` doesn't match. */
  private match(pattern: Pattern): number {
    if (typeof pattern === 'string') {
      return this.string.startsWith(pattern, this.cursor) ? pattern.length : -1;
    }
    const c = this.string.codePointAt(this.cursor);
    if (c === undefined) return -1;
    const len = c > 0xffff ? 2 : 1;
    if (typeof pattern === 'function') return pattern(c) ? len : -1;
    return pattern.includes(String.fromCodePoint(c)) ? len : -1;
  }

  at(pattern: Pattern): boolean {
    return this.match(pattern) >= 0;
  }

  /** Consumes the match of `pattern` if it matches; returns whether it did. */
  eatIf(pattern: Pattern): boolean {
    const len = this.match(pattern);
    if (len < 0) return false;
    this.cursor += len;
    return true;
  }

  /** Consumes matches of `pattern` while there are any; returns the eaten text. */
  eatWhile(pattern: Pattern): string {
    const start = this.cursor;
    for (;;) {
      const len = this.match(pattern);
      if (len <= 0) break;
      this.cursor += len;
    }
    return this.from(start);
  }

  /** Consumes code points until `pattern` matches or the text ends; returns the eaten text. */
  eatUntil(pattern: Pattern): string {
    const start = this.cursor;
    while (!this.done() && this.match(pattern) < 0) this.eat();
    return this.from(start);
  }
}
