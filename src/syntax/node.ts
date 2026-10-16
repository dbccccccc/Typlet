// Ported from Typst 0.15.1: crates/typst-syntax/src/node.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// Typlet's syntax nodes have no spans: offsets come from walking the tree, and
// lengths are in UTF-16 code units. Nodes are mutable, so the parser converts
// them in place where typst-syntax replaces them.

import { isKeyword, kindName, SyntaxKind } from './kind.js';

/** A hint attached to an error or warning, optionally targeting a sub-range of the node's text. */
export interface Hint {
  message: string;
  range?: [number, number];
}

/** A warning wrapped around a node. */
export interface Warning {
  message: string;
  /** A sub-range of the node's text the warning targets. */
  range?: [number, number];
  hints: Hint[];
}

/** An error or warning found in a syntax tree, with absolute UTF-16 offsets. */
export interface SyntaxDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  hints: string[];
  start: number;
  end: number;
}

/** A node in the untyped syntax tree. */
export class SyntaxNode {
  /** The node's kind. */
  kind: SyntaxKind;
  /** The node's length in UTF-16 code units. */
  len: number;
  /** The text of a leaf or error node; empty for inner nodes. */
  text: string;
  /** The children of an inner node; empty for leaves and errors. */
  children: SyntaxNode[];
  /** The message and hints of an error node. */
  error: { message: string; hints: Hint[] } | null;
  /** Warnings wrapped around this node, innermost first. */
  warnings: Warning[] | null;

  private constructor(kind: SyntaxKind, text: string, children: SyntaxNode[], len: number) {
    this.kind = kind;
    this.text = text;
    this.children = children;
    this.len = len;
    this.error = null;
    this.warnings = null;
  }

  /** Creates a new leaf node. */
  static leaf(kind: SyntaxKind, text: string): SyntaxNode {
    return new SyntaxNode(kind, text, [], text.length);
  }

  /** Creates a new inner node with children. */
  static inner(kind: SyntaxKind, children: SyntaxNode[]): SyntaxNode {
    let len = 0;
    for (const child of children) len += child.len;
    return new SyntaxNode(kind, '', children, len);
  }

  /**
   * Creates a new error node with a user-presentable message for the given
   * text. The message is the first argument, the text causing the error the
   * second.
   */
  static error(message: string, text: string): SyntaxNode {
    const node = new SyntaxNode(SyntaxKind.Error, text, [], text.length);
    node.error = { message, hints: [] };
    return node;
  }

  /** Adds a warning to this node. */
  warn(message: string): void {
    (this.warnings ??= []).push({ message, hints: [] });
  }

  /** Adds a warning that targets a sub-range of this node's text. */
  warnAt(range: [number, number], message: string): void {
    (this.warnings ??= []).push({ message, range, hints: [] });
  }

  /** The hint list of the outermost warning, or of the error. */
  private hintList(): Hint[] | null {
    if (this.warnings && this.warnings.length > 0) return this.warnings[this.warnings.length - 1]!.hints;
    return this.error ? this.error.hints : null;
  }

  /** Adds a hint to an error or warning. Does nothing on other nodes. */
  hint(message: string): void {
    this.hintList()?.push({ message });
  }

  /** Adds a hint that targets a sub-range of this node's text. */
  hintAt(range: [number, number], message: string): void {
    this.hintList()?.push({ message, range });
  }

  /** Adds hints while building an error or warning. */
  withHints(hints: Iterable<string>): this {
    for (const hint of hints) this.hint(hint);
    return this;
  }

  /** Whether the length is 0. */
  isEmpty(): boolean {
    return this.len === 0;
  }

  /** The full source text of the node. */
  fullText(): string {
    let out = '';
    for (const { node } of this.walk()) if (node.children.length === 0) out += node.text;
    return out;
  }

  /** Converts the node to another kind. Must not be used on or for errors. */
  convertToKind(kind: SyntaxKind): void {
    this.kind = kind;
  }

  /** Converts the node to an error, if it isn't already one. */
  convertToError(message: string): void {
    if (this.kind === SyntaxKind.Error) return;
    const text = this.fullText();
    this.kind = SyntaxKind.Error;
    this.text = text;
    this.len = text.length;
    this.children = [];
    this.error = { message, hints: [] };
    this.warnings = null;
  }

  /** Converts the node to an error stating that `expected` was expected, but this node's kind was found. */
  expected(expected: string): void {
    const kind = this.kind;
    this.convertToError(`expected ${expected}, found ${kindName(kind)}`);
    if (isKeyword(kind) && (expected === 'identifier' || expected === 'pattern')) {
      this.hint(`keyword \`${this.text}\` is not allowed as an identifier; try \`${this.text}_\` instead`);
    }
  }

  /** Converts the node to an error stating it was unexpected. */
  unexpected(): void {
    this.convertToError(`unexpected ${kindName(this.kind)}`);
  }

  /** A shallow copy: a new node object sharing the children. */
  clone(): SyntaxNode {
    const node = new SyntaxNode(this.kind, this.text, [...this.children], this.len);
    node.error = this.error && { message: this.error.message, hints: [...this.error.hints] };
    node.warnings = this.warnings && this.warnings.map((w) => ({ ...w, hints: [...w.hints] }));
    return node;
  }

  /** A deep copy of the whole subtree. */
  deepClone(): SyntaxNode {
    const root = this.clone();
    const stack = [{ source: this as SyntaxNode, target: root, next: 0 }];
    while (stack.length) {
      const frame = stack.at(-1)!;
      if (frame.next === frame.source.children.length) { stack.pop(); continue; }
      const source = frame.source.children[frame.next]!;
      const target = source.clone();
      frame.target.children[frame.next++] = target;
      stack.push({ source, target, next: 0 });
    }
    return root;
  }

  /** Whether this node or one of its descendants is an error. */
  erroneous(): boolean {
    if (this.kind === SyntaxKind.Error) return true;
    // This query needs no source offsets or yielded records. Keep its stack
    // proportional to depth, and avoid allocating a frame for every leaf.
    const stack = [{ node: this as SyntaxNode, next: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      if (frame.next === frame.node.children.length) { stack.pop(); continue; }
      const node = frame.node.children[frame.next++]!;
      if (node.kind === SyntaxKind.Error) return true;
      if (node.children.length) stack.push({ node, next: 0 });
    }
    return false;
  }

  /** All errors and warnings in the subtree, with absolute offsets from `offset`. */
  diagnostics(offset = 0): SyntaxDiagnostic[] {
    const out: SyntaxDiagnostic[] = [];
    for (const { node, start } of this.walk(offset)) {
      for (const warning of node.warnings ?? []) {
        const [s, e] = warning.range ?? [0, node.len];
        out.push({
          severity: 'warning',
          message: warning.message,
          hints: warning.hints.map((h) => h.message),
          start: start + s,
          end: start + e,
        });
      }
      if (node.error) {
        out.push({
          severity: 'error',
          message: node.error.message,
          hints: node.error.hints.map((h) => h.message),
          start,
          end: start + node.len,
        });
      }
    }
    return out;
  }

  /** Visits nodes in source order without using the JavaScript call stack. */
  private *walk(offset = 0): Generator<{ node: SyntaxNode; start: number }> {
    const stack = [{ node: this as SyntaxNode, next: 0, start: offset }];
    yield { node: this, start: offset };
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      if (frame.next === frame.node.children.length) { stack.pop(); continue; }
      const node = frame.node.children[frame.next++]!;
      const start = frame.start;
      frame.start += node.len;
      yield { node, start };
      if (node.children.length) stack.push({ node, next: 0, start });
    }
  }
}
