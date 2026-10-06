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
   * Set for Typlet's own errors: `unsupported` when Typlet refuses a construct
   * that Typst supports, `limit` when a resource budget runs out.
   */
  kind?: 'unsupported' | 'limit';
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

/** One or more errors at locations in the source, like Typst's `SourceResult` errors. */
export class SourceError {
  readonly diagnostics: SourceDiagnostic[];

  /** Errors with the same span and message are reported once, as Typst's compiler does. */
  constructor(diagnostics: SourceDiagnostic[]) {
    const seen = new Set<string>();
    this.diagnostics = diagnostics.filter((d) => {
      const key = d.span ? `${d.span.file ?? ''}:${d.span.start}:${d.span.end}:${d.message}` : `:${d.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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

/**
 * Counts the elements content realizes to, so that content that refers to
 * itself over and over, doubling at each step, stops (docs/DESIGN.md §6.6).
 */
export class ElementBudget {
  private count = 0;

  constructor(readonly max: number = elementLimit) {}

  visit(span: Span): void {
    if (++this.count > this.max) limit(span, `Typlet stopped after ${this.max} elements`);
  }
}

let elementLimit = 10_000;

/** Sets the element budget for the following formulas. */
export function setElementLimit(max: number): void {
  elementLimit = max;
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
