// Ported from Typst 0.15.1: crates/typst-library/src/diag.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

/**
 * A range of the source, in UTF-16 code units. `null` is a detached span:
 * one that points nowhere, like Typst's `Span::detached()`.
 */
export type Span = { readonly start: number; readonly end: number; readonly file?: 'preamble' } | null;

export type Severity = 'error' | 'warning';

/** An error or warning with a location, like Typst's `SourceDiagnostic`. */
export interface SourceDiagnostic {
  severity: Severity;
  span: Span;
  message: string;
  hints: string[];
  /** The function calls that led to the problem, innermost first. */
  trace: { point: string; span: Span }[];
  /**
   * Set for Typlet's own errors, `unsupported` when Typlet refuses a construct
   * that Typst supports and `limit` when a resource budget runs out, and for
   * the warnings the API tells apart: `deprecation` for a deprecated name,
   * `fallback` when the HTML output draws a formula as MathML, and
   * `approximation` when it draws part of a formula with the browser's fonts.
   */
  kind?: 'unsupported' | 'limit' | 'deprecation' | 'fallback' | 'approximation';
}

/**
 * The failure of an operation that has no location of its own, like Typst's
 * `HintedString`. The caller attaches a span with `at`.
 */
export class HintedError {
  constructor(
    readonly message: string,
    readonly hints: string[] = [],
    /** Set for Typlet's own errors, as on `SourceDiagnostic`. */
    readonly kind?: 'unsupported' | 'limit',
  ) {}

  hint(hint: string): this {
    this.hints.push(hint);
    return this;
  }
}

/**
 * Drops diagnostics that repeat an earlier one's location and message, as
 * Typst's compiler does for errors and its `Sink` for warnings: a function
 * called many times warns once.
 */
export function dedupe(diagnostics: SourceDiagnostic[]): SourceDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((d) => {
    const key = d.span ? `${d.span.file ?? ''}:${d.span.start}:${d.span.end}:${d.message}` : `:${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One or more errors at locations in the source, like Typst's `SourceResult` errors. */
export class SourceError {
  readonly diagnostics: SourceDiagnostic[];

  constructor(diagnostics: SourceDiagnostic[]) {
    this.diagnostics = dedupe(diagnostics);
  }
}

/** Fails with a message and hints and no location. */
export function bail(message: string, ...hints: string[]): never {
  throw new HintedError(message, hints);
}

export function error(span: Span, message: string, ...hints: string[]): SourceDiagnostic {
  return { severity: 'error', span, message, hints, trace: [] };
}

export function warning(span: Span, message: string, ...hints: string[]): SourceDiagnostic {
  return { severity: 'warning', span, message, hints, trace: [] };
}

/** A warning that the HTML drew something only approximately, such as text with the browser's fonts. */
export function approximation(span: Span, message: string): SourceDiagnostic {
  return { ...warning(span, message), kind: 'approximation' };
}

/** Fails with an error at a location. */
export function bailAt(span: Span, message: string, ...hints: string[]): never {
  throw new SourceError([error(span, message, ...hints)]);
}

/** Fails because Typlet does not support a construct that Typst does. */
export function unsupported(span: Span, what: string, ...hints: string[]): never {
  throw new SourceError([{ ...error(span, `Typlet does not support ${what}`, ...hints), kind: 'unsupported' }]);
}

/** Fails because a resource budget ran out. */
export function limit(span: Span, message: string, ...hints: string[]): never {
  throw new SourceError([{ ...error(span, message, ...hints), kind: 'limit' }]);
}

/** Runs `f`, attaching `span` to an error that has no location yet, like Typst's `At::at`. */
export function at<T>(span: Span, f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof HintedError) {
      const diag = error(span, e.message, ...e.hints);
      throw new SourceError([e.kind ? { ...diag, kind: e.kind } : diag]);
    }
    throw e;
  }
}

/**
 * Rethrows an error from code run at a location, with the location attached
 * if it has none, like `at` for callers that catch errors themselves.
 */
export function rethrowAt(e: unknown, span: Span): never {
  if (e instanceof HintedError) {
    const diag = error(span, e.message, ...e.hints);
    throw new SourceError([e.kind ? { ...diag, kind: e.kind } : diag]);
  }
  throw e;
}

/** Fails because a resource budget ran out; the caller attaches the span. */
export function bailLimit(message: string, ...hints: string[]): never {
  throw new HintedError(message, hints, 'limit');
}

// The budgets for collections and strings (docs/DESIGN.md §6.6). The evaluator
// sets them for each formula; evaluation is synchronous.
let maxItems = 10_000;
let maxChars = 100_000;

/** Sets the collection and string budgets for the following evaluation. */
export function setCollectionLimits(items: number, chars: number): void {
  maxItems = items;
  maxChars = chars;
}

/** Fails if `len` items repeated `n` times would exceed the collection budget. */
export function checkItems(len: number, n: number): void {
  if (len * n > maxItems) bailLimit(`Typlet stopped at a collection of more than ${maxItems} items`);
}

/** Fails if a string of `n` characters would exceed the string budget. */
export function checkStringLength(n: number): void {
  if (n > maxChars) bailLimit(`Typlet stopped at a string longer than ${maxChars} characters`);
}

/** Fails if a sequence of `n` pieces of content would exceed the collection budget. */
export function checkContentItems(n: number): void {
  if (n > maxItems) bailLimit(`Typlet stopped at content of more than ${maxItems} items`);
}

// The largest size a formula may give spacing, boxes and text, and the
// longest length the output may hold, in ems of the font size (docs/DESIGN.md
// §6.6). The renderer sets it for each formula.
let maxSize = 1000;

/** Sets the size budget for the following formulas: the `maxSize` option. */
export function setMaxSize(ems: number): void {
  maxSize = ems;
}

/** Fails for a size beyond the budget, at a font size, in points. */
export function checkSize(size: number, fontSize: number, span: Span): void {
  if (!(Math.abs(size) <= maxSize * fontSize)) limit(span, `Typlet stopped at a size of more than ${maxSize}em`);
}

/**
 * Fails for a length written to the output beyond the budget, in ems of the
 * font size it is written in. Every length the HTML and the MathML carry
 * passes here, so whatever the layout computed, none reaches the page
 * unchecked.
 */
export function checkEm(em: number, span: Span = null): void {
  if (!(Math.abs(em) <= maxSize)) limit(span, `Typlet stopped at a size of more than ${maxSize}em`);
}

/**
 * Counts the elements content realizes to, so that content that refers to
 * itself over and over, doubling at each step, stops (docs/DESIGN.md §6.6).
 */
export class ElementBudget {
  private count = 0;

  constructor(readonly max: number = elementLimit) {}

  visit(span: Span): void {
    this.consume(1, span);
  }

  /** Counts `count` elements at once, such as the primes of `primes(#n)`. */
  consume(count: number, span: Span): void {
    this.count += count;
    if (!(this.count <= this.max)) limit(span, `Typlet stopped after ${this.max} elements`);
  }
}

let elementLimit = 10_000;

/** Sets the element budget for the following formulas. */
export function setElementLimit(max: number): void {
  elementLimit = max;
}

/**
 * The parts of glyphs assembled to stretch, such as a tall parenthesis's, in
 * the current formula. Each is a glyph in the output, and a chain of ever
 * taller delimiters multiplies them, so they have a budget of their own, the
 * size of the element budget.
 */
let parts = 0;

/** Starts a formula's count of glyph parts. */
export function resetParts(): void {
  parts = 0;
}

/** Counts `count` parts of an assembled glyph. */
export function consumeParts(count: number, span: Span): void {
  parts += count;
  if (!(parts <= elementLimit)) limit(span, `Typlet stopped after ${elementLimit} parts of stretched glyphs`);
}

// --- Depth guards (docs/DESIGN.md §6.6) ---------------------------------------
//
// Recursion in the evaluator and in everything after it follows the formula's
// structure, which the parser bounds only for nesting: a chain of operators,
// definitions that build content, values that share parts and styles that
// feed content back into itself can all go deeper than the native stack.
// Rendering is synchronous, so the counters are module-level, like the
// limits above, and each is restored in `finally`.

/** Expressions and rule tails being evaluated. */
let evalDepth = 0;
/** Content being resolved, laid out or converted, and values being compared or shown. */
let nesting = 0;
/** Steps spent comparing and showing values in the current formula. */
let valueSteps = 0;

export function enterEval(span: Span): void {
  if (evalDepth >= 1024) limit(span, 'Typlet stopped at an expression depth of more than 1024');
  evalDepth++;
}

export function exitEval(): void {
  evalDepth--;
}

/** Runs `f` one level deeper in the evaluator, as the rest of a block after a rule is. */
export function deeper<T>(span: Span, f: () => T): T {
  enterEval(span);
  try {
    return f();
  } finally {
    exitEval();
  }
}

export function enterNesting(span: Span): void {
  if (nesting >= 256) limit(span, 'Typlet stopped at a nesting depth of more than 256');
  nesting++;
}

export function exitNesting(): void {
  nesting--;
}

/** Runs `f` one level deeper in content. */
export function nested<T>(span: Span, f: () => T): T {
  enterNesting(span);
  try {
    return f();
  } finally {
    exitNesting();
  }
}

/**
 * Runs `f`, a step of comparing or showing values, one level deeper. Values
 * that share parts, such as `(x, x)` built thirty times over, take
 * exponential work otherwise. The caller attaches the span, as for other
 * errors of value operations.
 */
export function valueStep<T>(f: () => T): T {
  if (++valueSteps > 100_000) bailLimit('Typlet stopped after 100000 steps of comparing or showing values');
  if (nesting >= 256) bailLimit('Typlet stopped at a nesting depth of more than 256');
  nesting++;
  try {
    return f();
  } finally {
    nesting--;
  }
}

/** Starts a formula's count of value steps. */
export function resetValueSteps(): void {
  valueSteps = 0;
}

/** Collects warnings, like Typst's `Sink`. */
export interface Sink {
  warnings: SourceDiagnostic[];
}

/** Records `point` on errors from `f` that lie outside `span`, like Typst's `Trace::trace`. */
export function trace<T>(point: string, span: Span, f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof SourceError && span) {
      for (const diag of e.diagnostics) {
        const inside =
          diag.span && diag.span.file === span.file && span.start <= diag.span.start && span.end >= diag.span.end;
        if (!inside) diag.trace.push({ point, span });
      }
    }
    throw e;
  }
}
