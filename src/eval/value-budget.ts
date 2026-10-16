// Typlet original: not ported from Typst.

import { bailLimit } from './diag.js';

/** Work shared by recursive value operations during one evaluation. */
export class ValueBudget {
  private visits = 0;

  constructor(readonly stringLength = 100_000) {}

  visit(depth = 0): void {
    if (depth > 256) bailLimit('Typlet stopped at a value depth of more than 256');
    if (++this.visits > 100_000) bailLimit('Typlet stopped after 100000 value visits');
  }

  checkString(length: number): void {
    if (length > this.stringLength) bailLimit(`Typlet stopped at a string longer than ${this.stringLength} characters`);
  }
}

let active: ValueBudget | null = null;

/** The active synchronous scope, or a bounded default for a standalone helper. */
export function getValueBudget(): ValueBudget {
  return active ?? new ValueBudget();
}

/** Restores the caller even after a nested render or a failed traversal. */
export function withValueBudget<T>(budget: ValueBudget, body: (budget: ValueBudget) => T): T {
  const previous = active;
  active = budget;
  try {
    return body(budget);
  } finally {
    active = previous;
  }
}

/** Gives standalone operations a scope that all their recursive helpers share. */
export function withValueContext<T>(body: (budget: ValueBudget) => T): T {
  return withValueBudget(getValueBudget(), body);
}

/** Builds one result, checking its UTF-16 length before each append. */
export class ReprBuilder {
  private parts: string[] = [];
  private length = 0;
  private readonly budget = getValueBudget();

  push(text: string): void {
    this.budget.checkString(this.length + text.length);
    this.parts.push(text);
    this.length += text.length;
  }

  finish(): string {
    return this.parts.join('');
  }
}
