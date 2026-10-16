// Typlet original: not ported from Typst.

import { DepthBudget } from './content-budget.js';
import { ElementBudget, type Span, limit } from './diag.js';

/** Bounds character and glyph expansion before an output allocates it. */
export class ExpansionBudget extends ElementBudget {
  readonly depth = new DepthBudget();

  constructor(max?: number, readonly maxOutputSize = 1_000_000) { super(max); }

  override consume(count: number, span: Span): void {
    if (count > this.maxOutputSize - this.count) limit(span, `the output is longer than ${this.maxOutputSize} characters`);
    super.consume(count, span);
  }
}

let active: ExpansionBudget | null = null;

/** Standalone backends also receive a finite default allowance. */
export function getExpansionBudget(): ExpansionBudget {
  return active ?? new ExpansionBudget();
}

/** Each output owns a scope; nested contexts reuse it and restore callers. */
export function withExpansionBudget<T>(budget: ExpansionBudget, body: () => T): T {
  const previous = active;
  active = budget;
  try { return body(); }
  finally { active = previous; }
}
