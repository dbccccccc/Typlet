// Typlet original: not ported from Typst.

import type { SyntaxNode } from '../syntax/node.js';
import { limit } from './diag.js';

/** Checks raw structure before recursive syntax consumers or evaluation. */
export function checkSyntaxDepth(root: SyntaxNode, file?: 'preamble'): void {
  const stack = [{ node: root, next: 0, offset: 0 }];
  let depth = 0;
  while (depth >= 0) {
    const frame = stack[depth]!;
    if (frame.next === frame.node.children.length) { depth--; continue; }
    const node = frame.node.children[frame.next++]!;
    const start = frame.offset;
    frame.offset += node.len;
    if (depth >= 256) {
      limit({ start, end: start + node.len, ...(file ? { file } : {}) }, 'Typlet stopped at a syntax tree depth of more than 256');
    }
    if (node.children.length) {
      depth++;
      const next = stack[depth];
      if (next) { next.node = node; next.next = 0; next.offset = start; }
      else stack.push({ node, next: 0, offset: start });
    }
  }
}
