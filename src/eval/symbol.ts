// Ported from Typst 0.15.1: crates/typst-library/src/foundations/symbol.rs, crates/typst-library/src/symbols.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// The modifier matching is ported from codex 0.3.0, `src/shared.rs`
// (Apache-2.0), the crate that defines Typst's symbols.

import { BINDING_DEPRECATIONS, SYMBOLS, VARIANT_DEPRECATIONS } from '../generated/symbols.js';
import { bail } from './diag.js';
import { prettyArrayLike, reprStr } from './repr.js';

/** A symbol variant: its modifiers (dot-separated), its value and an optional deprecation message. */
export type Variant = readonly [modifiers: string, value: string, deprecation: string | null];

/**
 * A Unicode symbol with named variants. `modifiers` are the ones applied so
 * far, dot-separated. Typst distinguishes single, complex and modified symbols
 * internally; here a single symbol is a list with one variant.
 */
export interface Symbol {
  readonly list: readonly Variant[];
  readonly modifiers: string;
  /** Whether a deprecation warning was already emitted for the applied modifiers. */
  readonly deprecated: boolean;
}

const NO_MODIFIERS: string[] = [];
const splitCache = new Map<string, string[]>();

/** The modifiers of a dot-separated set, cached: symbols have few distinct sets. */
function split(set: string): string[] {
  if (set === '') return NO_MODIFIERS;
  let parts = splitCache.get(set);
  if (!parts) {
    parts = set.split('.');
    splitCache.set(set, parts);
  }
  return parts;
}

// The best matches found so far, per variant list. Lists are the `sym`
// module's, so there are few; the sets per list are capped, since a formula
// can repeat a modifier any number of times (`arrow.r.r.r`).
const matchCache = new WeakMap<readonly Variant[], Map<string, Variant | null>>();
const MAX_CACHED_SETS = 32;

/**
 * Finds the best match for the modifier set `set` among `variants`. A match
 * contains all of `set`'s modifiers; the best one has the most modifiers in
 * common with `set`, then the fewest modifiers overall, then comes first.
 */
export function bestMatch(set: string, variants: readonly Variant[]): Variant | null {
  let cache = matchCache.get(variants);
  if (!cache) {
    cache = new Map();
    matchCache.set(variants, cache);
  }
  let best = cache.get(set);
  if (best === undefined) {
    best = findBestMatch(set, variants);
    if (cache.size < MAX_CACHED_SETS) cache.set(set, best);
  }
  return best;
}

function findBestMatch(set: string, variants: readonly Variant[]): Variant | null {
  const wanted = split(set);
  let best: Variant | null = null;
  let bestMatching = -1;
  let bestTotal = 0;
  for (const variant of variants) {
    const have = split(variant[0]);
    if (!wanted.every((m) => have.includes(m))) continue;
    const matching = have.filter((m) => wanted.includes(m)).length;
    const total = have.length;
    if (matching > bestMatching || (matching === bestMatching && total < bestTotal)) {
      best = variant;
      bestMatching = matching;
      bestTotal = total;
    }
  }
  return best;
}

/** A symbol with one variant. */
export function singleSymbol(value: string): Symbol {
  return { list: [['', value, null]], modifiers: '', deprecated: false };
}

/** The symbol's value for the applied modifiers. */
export function symbolGet(symbol: Symbol): string {
  // Without modifiers, the best match is the first variant without any.
  const first = symbol.list[0]!;
  if (symbol.modifiers === '' && first[0] === '') return first[1];
  return bestMatch(symbol.modifiers, symbol.list)![1];
}

/**
 * Applies a modifier. Returns the modified symbol and, the first time a
 * deprecated variant is reached, its deprecation message.
 */
export function symbolModified(symbol: Symbol, modifier: string): [Symbol, string | null] {
  const modifiers = symbol.modifiers === '' ? modifier : `${symbol.modifiers}.${modifier}`;
  const variant = bestMatch(modifiers, symbol.list);
  if (!variant) bail('unknown symbol modifier');
  const warn = !symbol.deprecated && variant[2] !== null;
  return [{ list: symbol.list, modifiers, deprecated: symbol.deprecated || warn }, warn ? variant[2] : null];
}

export function symbolEq(a: Symbol, b: Symbol): boolean {
  return a.list === b.list && a.modifiers === b.modifiers;
}

export function reprSymbol(symbol: Symbol): string {
  const applied = split(symbol.modifiers);
  if (symbol.list.length === 1 && symbol.list[0]![0] === '') return `symbol(${reprStr(symbol.list[0]![1])})`;
  const pieces = symbol.list
    // Keep the variants that can still be reached.
    .filter(([m]) => applied.every((a) => split(m).includes(a)))
    .map(([m, value]) => {
      const trimmed = split(m).filter((x) => !applied.includes(x));
      return trimmed.length === 0 ? reprStr(value) : `(${reprStr(trimmed.join('.'))}, ${reprStr(value)})`;
    });
  return `symbol${prettyArrayLike(pieces, false)}`;
}

// --- The `sym` module ------------------------------------------------------

/** A definition in a symbol module: a symbol or a nested module. */
export type SymDef =
  | { readonly kind: 'symbol'; readonly symbol: Symbol; readonly deprecation: string | null }
  | { readonly kind: 'module'; readonly name: string; readonly defs: ReadonlyMap<string, SymDef> };

let sym: ReadonlyMap<string, SymDef> | null = null;

/** The definitions of Typst's `sym` module, decoded on first use. */
export function symModule(): ReadonlyMap<string, SymDef> {
  if (sym) return sym;
  const variantDeprecation = new Map(VARIANT_DEPRECATIONS.map(([path, m, message]) => [`${path}:${m}`, message]));
  const bindingDeprecation = new Map(BINDING_DEPRECATIONS);
  const root = new Map<string, SymDef>();
  for (const line of SYMBOLS.split('\n')) {
    const [path, ...fields] = line.split('\t') as [string, ...string[]];
    const list: Variant[] = fields.map((field) => {
      const eq = field.indexOf('=');
      const modifiers = field.slice(0, eq);
      return [modifiers, field.slice(eq + 1), variantDeprecation.get(`${path}:${modifiers}`) ?? null];
    });
    // Walk to the nested module that defines the symbol, creating it if needed.
    const parts = path.split('.');
    let scope = root;
    for (const part of parts.slice(0, -1)) {
      let def = scope.get(part);
      if (!def) {
        def = { kind: 'module', name: part, defs: new Map() };
        scope.set(part, def);
      }
      scope = def.kind === 'module' ? (def.defs as Map<string, SymDef>) : scope;
    }
    scope.set(parts.at(-1)!, {
      kind: 'symbol',
      symbol: { list, modifiers: '', deprecated: false },
      deprecation: bindingDeprecation.get(path) ?? null,
    });
  }
  sym = root;
  return root;
}
