// Ported from Typst 0.15.1: crates/typst-library/src/foundations/scope.rs, crates/typst-library/src/foundations/module.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { GLOBAL_NAMES } from '../generated/names.js';
import { HintedError, type Span, bail, unsupported } from './diag.js';
import type { Value } from './value.js';

/** A bound value, with the message to warn with if the binding is deprecated. */
export interface Binding {
  readonly value: Value;
  readonly deprecation: string | null;
  readonly span: Span;
}

/**
 * A map from names to bindings. Scopes of blocks and function calls hold a
 * few names at most, so a scope keeps them in a list, and makes a map only
 * when it grows, as module scopes do.
 */
export class Scope {
  private names_: string[] = [];
  private bindings: Binding[] = [];
  private map: Map<string, Binding> | null = null;

  define(name: string, value: Value, deprecation: string | null = null, span: Span = null): void {
    this.bind(name, { value, deprecation, span });
  }

  get(name: string): Binding | undefined {
    if (this.map) return this.map.get(name);
    const names = this.names_;
    for (let i = names.length - 1; i >= 0; i--) if (names[i] === name) return this.bindings[i];
    return undefined;
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  names(): IterableIterator<string> {
    return this.map ? this.map.keys() : this.names_.values();
  }

  /** Defines a binding as it is, such as a captured one. */
  bind(name: string, binding: Binding): void {
    if (this.map) {
      this.map.set(name, binding);
      return;
    }
    const i = this.names_.indexOf(name);
    if (i >= 0) {
      this.bindings[i] = binding;
      return;
    }
    this.names_.push(name);
    this.bindings.push(binding);
    if (this.names_.length > 16) {
      this.map = new Map(this.names_.map((n, j) => [n, this.bindings[j]!]));
      this.names_ = [];
      this.bindings = [];
    }
  }

  clone(): Scope {
    const scope = new Scope();
    if (this.map) scope.map = new Map(this.map);
    else {
      scope.names_ = [...this.names_];
      scope.bindings = [...this.bindings];
    }
    return scope;
  }
}

/** A module of definitions, such as `math` or `sym`. */
export interface Module {
  readonly name: string;
  readonly scope: Scope;
}

/**
 * The library: Typst's global scope and math scope, as far as Typlet
 * implements them. Names that Typst defines but Typlet doesn't are listed in
 * `GLOBAL_NAMES` so they can be refused as unsupported.
 */
export interface Library {
  readonly global: Module;
  readonly math: Module;
}

let typstGlobals: Map<string, string> | null = null;

/** The type of a name in Typst's global scope, if Typst defines it. */
export function typstGlobalType(name: string): string | undefined {
  typstGlobals ??= new Map(
    GLOBAL_NAMES.split(' ').map((entry) => entry.split(':') as [string, string]),
  );
  return typstGlobals.get(name);
}

/** Fails for a name that Typst defines in its global scope but Typlet does not. */
export function unsupportedGlobal(name: string, span: Span): never {
  const type = typstGlobalType(name);
  const what = type === 'function' ? `the \`${name}\` function` : `\`${name}\``;
  return unsupported(span, what);
}

/** The stack of scopes during evaluation, like Typst's `Scopes`. */
export class Scopes {
  /** The innermost scope. */
  top = new Scope();
  /** The outer scopes, innermost last. */
  readonly scopes: Scope[] = [];

  constructor(readonly base: Library | null) {}

  enter(): void {
    this.scopes.push(this.top);
    this.top = new Scope();
  }

  exit(): void {
    this.top = this.scopes.pop()!;
  }

  /** A binding in the local scopes, without the library. */
  local(name: string): Binding | undefined {
    const found = this.top.get(name);
    if (found) return found;
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const binding = this.scopes[i]!.get(name);
      if (binding) return binding;
    }
    return undefined;
  }

  /** Looks up a variable in code: local scopes, then the global scope. */
  get(name: string, span: Span): Binding {
    const found = this.local(name) ?? this.base?.global.scope.get(name);
    if (found) return found;
    if (this.base && name === 'std') return { value: { type: 'module', v: this.base.global }, deprecation: null, span: null };
    if (this.base && typstGlobalType(name) !== undefined) unsupportedGlobal(name, span);
    throw unknownVariable(name);
  }

  /** Looks up a variable in math: local scopes, then the math scope. */
  getInMath(name: string, span: Span): Binding {
    const found = this.local(name) ?? this.base?.math.scope.get(name);
    if (found) return found;
    if (this.base && name === 'std') return { value: { type: 'module', v: this.base.global }, deprecation: null, span: null };
    // Typst's hint depends on whether its global scope has the name, whether
    // or not Typlet implements it.
    const inGlobal = this.base !== null && (this.base.global.scope.has(name) || typstGlobalType(name) !== undefined);
    throw unknownVariableMath(name, inGlobal);
  }
}

/** The error for an unknown variable. */
export function unknownVariable(name: string): HintedError {
  const error = new HintedError(`unknown variable: ${name}`);
  if (name.includes('-')) {
    const count = name.split('-').length - 1;
    error.hint(
      `if you meant to use subtraction, try adding spaces around the minus sign${count > 1 ? 's' : ''}: \`${name.replaceAll('-', ' - ')}\``,
    );
  }
  return error;
}

/** The error for a variable that is not found in math. */
export function unknownVariableMath(name: string, inGlobal: boolean): HintedError {
  const error = new HintedError(`unknown variable: ${name}`);
  if (['none', 'auto', 'false', 'true'].includes(name)) {
    error.hint(`if you meant to use a literal, try adding a hash before it: \`#${name}\``);
  } else if (inGlobal) {
    error.hint(`\`${name}\` is not available directly in math, but is in the standard library`);
    error.hint(`to access \`${name}\` in code mode you can add a hash: \`#${name}\``);
    error.hint(`or access \`${name}\` in math mode by using the \`std\` module: \`std.${name}\``);
  } else {
    error.hint(
      `if you meant to display multiple letters as is, try adding spaces between each letter: \`${[...name].join(' ')}\``,
    );
    error.hint(`or if you meant to display this as text, try placing it in quotes: \`"${name}"\``);
  }
  return error;
}

/** Looks up a field of a module. */
export function moduleField(module: Module, field: string): Binding {
  const binding = module.scope.get(field);
  if (binding) return binding;
  return bail(`module \`${module.name}\` does not contain \`${field}\``);
}
