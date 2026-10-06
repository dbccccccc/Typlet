// Ported from Typst 0.15.1: crates/typst-eval/src/vm.rs, crates/typst-eval/src/flow.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { type Span, error, warning } from './diag.js';
import type { Engine } from './func.js';
import { Scopes } from './scope.js';
import type { Library } from './scope.js';
import type { Value } from './value.js';

/** A control flow event that occurred during evaluation, like Typst's `FlowEvent`. */
export type FlowEvent =
  | { readonly kind: 'break'; readonly span: Span }
  | { readonly kind: 'continue'; readonly span: Span }
  /** A return, with its value, and whether it was conditional. */
  | { readonly kind: 'return'; readonly span: Span; readonly value: Value | null; conditional: boolean };

/** The error for control flow where it is not allowed. */
export function forbidden(event: FlowEvent) {
  switch (event.kind) {
    case 'break':
      return error(event.span, 'cannot break outside of loop');
    case 'continue':
      return error(event.span, 'cannot continue outside of loop');
    case 'return':
      return error(event.span, 'cannot return outside of function');
  }
}

/** The state of evaluation, like Typst's `Vm`. */
export class Vm {
  readonly scopes: Scopes;
  /** A pending control flow event. */
  flow: FlowEvent | null = null;

  constructor(
    readonly engine: Engine,
    readonly library: Library,
    scopes?: Scopes,
  ) {
    this.scopes = scopes ?? new Scopes(library);
  }

  /** Emits a warning. */
  warn(span: Span, message: string, ...hints: string[]): void {
    this.engine.warnings.push(warning(span, message, ...hints));
  }

  /** Defines a variable in the innermost scope, like `Vm::define`. */
  define(name: string, span: Span, value: Value): void {
    if (name === 'is') {
      this.warn(
        span,
        '`is` will likely become a keyword in future versions and will not be allowed as an identifier',
        'rename this variable to avoid future errors',
        'try `is_` instead',
      );
    }
    this.scopes.top.define(name, value, null, span);
  }
}
