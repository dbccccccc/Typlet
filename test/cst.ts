import { SyntaxKind, type SyntaxNode } from '../src/syntax/index.js';

/**
 * Dumps a syntax tree in the oracle's compact format (oracle/src/cst.rs):
 * `[kind, start, end, [children]]`, `[kind, start, end]` for leaves, and
 * `["Error", start, end, message, [hints]]` for errors.
 */
export function dumpCst(node: SyntaxNode, start = 0): unknown[] {
  const end = start + node.len;
  const kind = SyntaxKind[node.kind];
  if (node.kind === SyntaxKind.Error) {
    return [kind, start, end, node.error?.message ?? '', node.error?.hints.map((h) => h.message) ?? []];
  }
  if (node.children.length === 0) return [kind, start, end];
  let at = start;
  const children = node.children.map((child) => {
    const dumped = dumpCst(child, at);
    at += child.len;
    return dumped;
  });
  return [kind, start, end, children];
}
