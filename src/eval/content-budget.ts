// Typlet original: not ported from Typst.

import type { Content } from './content.js';
import { type ElementBudget, type Span, limit } from './diag.js';

/** Structural children, without descending into spans, functions or other metadata. */
function* children(content: Content): Generator<unknown> {
  for (const [field, value] of Object.entries(content)) {
    if (field !== 'span' && field !== 'styles') yield value;
  }
  if (content.func === 'styled') {
    for (const property of content.styles) yield property.value;
  }
}

/**
 * Check runtime-built content before recursive realization, layout, MathML or
 * numbering consumers see it. Syntax depth cannot bound definitions assembled
 * into a deeper tree. Iterator frames keep a wide array from filling the stack.
 */
export function checkContentDepth(root: Content): void {
  const stack = [{ items: [root].values() as Iterator<unknown>, depth: 0 }];
  const depths = new WeakMap<object, number>();
  let visits = 0;
  while (stack.length) {
    const frame = stack[stack.length - 1]!;
    const next = frame.items.next();
    if (next.done) { stack.pop(); continue; }
    const value = next.value;
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      stack.push({ items: value.values(), depth: frame.depth });
      continue;
    }
    if (!('func' in value) || typeof value.func !== 'string') continue;
    const content = value as Content;
    const depth = frame.depth;
    if (depth > 256) limit(content.span, 'Typlet stopped at a content depth of more than 256');
    if (++visits > 100_000) limit(content.span, 'Typlet stopped after 100000 content visits');
    if (content.func === 'text' || content.func === 'symbol' || content.func === 'space') continue;
    if ((depths.get(content) ?? -1) >= depth) continue;
    depths.set(content, depth);
    stack.push({ items: children(content), depth: depth + 1 });
  }
}

/** Counts logical content occurrences before IR allocation, including shared children. */
export function checkContentExpansion(root: Content, budget: ElementBudget): void {
  const stack = [[root].values() as Iterator<unknown>];
  while (stack.length) {
    const next = stack[stack.length - 1]!.next();
    if (next.done) { stack.pop(); continue; }
    const value = next.value;
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) { stack.push(value.values()); continue; }
    if (!('func' in value) || typeof value.func !== 'string') continue;
    const content = value as Content;
    budget.visit(content.span);
    if (content.func === 'space') continue;
    if (content.func === 'text' || content.func === 'symbol' || content.func === 'raw') {
      budget.consume(content.text.length, content.span);
      continue;
    }
    // Style values may be unused, and supplements are reference metadata.
    // Keep this pass structural; consumers still check actual expansion.
    const fields = Object.entries(content).filter(([key]) =>
      key !== 'span' && key !== 'styles' && (content.func !== 'equation' || key !== 'supplement'));
    stack.push(fields.map(([, child]) => child).values());
  }
}

/** Bounds actual recursion after inherited styles supply content or create cycles. */
export class DepthBudget {
  private depth = 0;

  withDepth<T>(span: Span, body: () => T): T {
    if (this.depth >= 256) limit(span, 'Typlet stopped at a rendering depth of more than 256');
    this.depth++;
    try { return body(); }
    finally { this.depth--; }
  }
}
