// Typlet original: not ported from Typst.

import type { SyntaxNode } from '../syntax/node.js';
import { limit } from './diag.js';

/** Checks raw structure before recursive syntax consumers or evaluation. */
export function checkSyntaxDepth(root: SyntaxNode, file?: 'preamble'): void {
  const stack = [{ node: root, next: 0, offset: 0 }];
  while (stack.length) {
    const frame = stack[stack.length - 1]!;
    if (frame.next === frame.node.children.length) { stack.pop(); continue; }
    const node = frame.node.children[frame.next++]!;
    const start = frame.offset;
    frame.offset += node.len;
    if (stack.length > 256) {
      limit({ start, end: start + node.len, ...(file ? { file } : {}) }, 'Typlet stopped at a syntax tree depth of more than 256');
    }
    if (node.children.length) stack.push({ node, next: 0, offset: start });
  }
}
