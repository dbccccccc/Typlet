// Ported from Typst 0.15.1: crates/typst-library/src/foundations/args.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import type { Cast } from './cast.js';
import { type Span, SourceError, at, bail, bailAt, error, rethrowAt } from './diag.js';
import { reprStr } from './repr.js';
import { type Value, arrayValue, dictValue } from './value.js';

/** One argument: positional when `name` is null. */
export interface Arg {
  /** The span of the whole argument. */
  readonly span: Span;
  readonly name: string | null;
  readonly value: Value;
  /** The span of the value. */
  readonly valueSpan: Span;
}

/** The arguments of a function call, like Typst's `Args`. */
export class Args {
  constructor(
    /** The span of the call; `null` until the caller sets it. */
    public span: Span,
    public items: Arg[],
  ) {}

  /** Sets the span if it is detached, like `Args::spanned`. */
  spanned(span: Span): this {
    if (this.span === null) this.span = span;
    return this;
  }

  /** The number of positional arguments left. */
  remaining(): number {
    return this.items.filter((item) => item.name === null).length;
  }

  /** Inserts a positional argument at `index`. */
  insert(index: number, span: Span, value: Value): void {
    this.items.splice(index, 0, { span: this.span, name: null, value, valueSpan: span });
  }

  /** Appends a positional argument. */
  push(span: Span, value: Value): void {
    this.items.push({ span: this.span, name: null, value, valueSpan: span });
  }

  /** Consumes and casts the first positional argument, if there is one. */
  eat<T>(cast: Cast<T>): T | undefined {
    const i = this.items.findIndex((item) => item.name === null);
    if (i < 0) return undefined;
    const [item] = this.items.splice(i, 1);
    try {
      return cast.cast(item!.value);
    } catch (e) {
      return rethrowAt(e, item!.valueSpan);
    }
  }

  /** Consumes `n` positional arguments. */
  consume(n: number): Arg[] {
    const list: Arg[] = [];
    for (let i = 0; i < this.items.length && list.length < n; ) {
      if (this.items[i]!.name === null) list.push(...this.items.splice(i, 1));
      else i++;
    }
    if (list.length < n) bailAt(this.span, 'not enough arguments');
    return list;
  }

  /** Consumes and casts the first positional argument, or fails because it is missing. */
  expect<T>(what: string, cast: Cast<T>): T {
    const value = this.eat(cast);
    if (value === undefined) throw new SourceError([this.missingArgument(what)]);
    return value;
  }

  private missingArgument(what: string) {
    for (const item of this.items) {
      if (item.name === what) {
        return error(item.span, `the argument \`${what}\` is positional`, `try removing \`${item.name}:\``);
      }
    }
    return error(this.span, `missing argument: ${what}`);
  }

  /** Consumes and casts the first positional argument that the cast accepts. */
  find<T>(cast: Cast<T>): T | undefined {
    const i = this.items.findIndex((item) => item.name === null && cast.castable(item.value));
    if (i < 0) return undefined;
    const [item] = this.items.splice(i, 1);
    return at(item!.valueSpan, () => cast.cast(item!.value));
  }

  /** Consumes and casts all positional arguments, reporting every failure. */
  all<T>(cast: Cast<T>): T[] {
    const list: T[] = [];
    const errors: SourceError['diagnostics'] = [];
    this.items = this.items.filter((item) => {
      if (item.name !== null) return true;
      try {
        list.push(at(item.valueSpan, () => cast.cast(item.value)));
      } catch (e) {
        if (!(e instanceof SourceError)) throw e;
        errors.push(...e.diagnostics);
      }
      return false;
    });
    if (errors.length > 0) throw new SourceError(errors);
    return list;
  }

  /** Consumes all positional arguments, uncast, with their spans. */
  allSpanned(): { value: Value; span: Span }[] {
    const list: { value: Value; span: Span }[] = [];
    this.items = this.items.filter((item) => {
      if (item.name !== null) return true;
      list.push({ value: item.value, span: item.valueSpan });
      return false;
    });
    return list;
  }

  /** Consumes all named arguments called `name` and casts the last one. */
  named<T>(name: string, cast: Cast<T>): T | undefined {
    let found: T | undefined;
    for (let i = 0; i < this.items.length; ) {
      const item = this.items[i]!;
      if (item.name === name) {
        this.items.splice(i, 1);
        found = at(item.valueSpan, () => cast.cast(item.value));
      } else {
        i++;
      }
    }
    return found;
  }

  /** A named argument, or else the first matching positional one. */
  namedOrFind<T>(name: string, cast: Cast<T>): T | undefined {
    return this.named(name, cast) ?? this.find(cast);
  }

  /** Takes all remaining arguments. */
  take(): Args {
    const taken = new Args(this.span, this.items);
    this.items = [];
    return taken;
  }

  /** Fails if any argument is left over. */
  finish(): void {
    const arg = this.items[0];
    if (!arg) return;
    if (arg.name !== null) bailAt(arg.span, `unexpected argument: ${arg.name}`);
    bailAt(arg.span, 'unexpected argument');
  }

  /** The positional arguments. */
  toPos(): Value {
    return arrayValue(this.items.filter((item) => item.name === null).map((item) => item.value));
  }

  /** The named arguments. */
  toNamed(): Value {
    return dictValue(new Map(this.items.flatMap((item) => (item.name === null ? [] : [[item.name, item.value]]))));
  }

  /** The value of the last named argument called `field`. */
  field(field: string): Value {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i]!.name === field) return this.items[i]!.value;
    }
    return bail(`no named argument ${reprStr(field)}`);
  }
}
