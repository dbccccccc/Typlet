// Ported from Typst 0.15.1: crates/typst-library/src/foundations/styles.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

// Typst's styles are lists of properties, each setting one field of one
// element, such as `equation.size`. A style chain links such lists from the
// innermost outward. Typlet keeps that model but drops show rules (recipes)
// and revocations, which it does not support.

/** One style property: the value of an element's field. */
export interface Property {
  readonly elem: string;
  readonly field: string;
  readonly value: unknown;
}

/** A list of style properties. Later properties take precedence over earlier ones. */
export type Styles = readonly Property[];

export function property(elem: string, field: string, value: unknown): Property {
  return { elem, field, value };
}

/** A chain of style lists, innermost first. */
export interface StyleChain {
  readonly head: Styles;
  readonly tail: StyleChain | null;
}

export const EMPTY_CHAIN: StyleChain = { head: [], tail: null };

/** Adds `styles` in front of the chain, unless they are empty. */
export function chain(base: StyleChain, styles: Styles): StyleChain {
  return styles.length === 0 ? base : { head: styles, tail: base };
}

/** The innermost value of a field, or `fallback` if no style sets it. */
export function get<T>(chain: StyleChain, elem: string, field: string, fallback: T): T {
  for (let link: StyleChain | null = chain; link; link = link.tail) {
    for (let i = link.head.length - 1; i >= 0; i--) {
      const p = link.head[i]!;
      if (p.field === field && p.elem === elem) return p.value as T;
    }
  }
  return fallback;
}

/** Folds all values of a field from the innermost outward, as Typst does for `#[fold]` fields. */
export function getFolded<T>(
  chain: StyleChain,
  elem: string,
  field: string,
  fallback: T,
  fold: (inner: T, outer: T) => T,
): T {
  const values: T[] = [];
  for (let link: StyleChain | null = chain; link; link = link.tail) {
    for (let i = link.head.length - 1; i >= 0; i--) {
      const p = link.head[i]!;
      if (p.field === field && p.elem === elem) values.push(p.value as T);
    }
  }
  return values.reduceRight((outer, inner) => fold(inner, outer), fallback);
}

/** The number of links in the chain. */
export function linkCount(chain: StyleChain): number {
  let n = 0;
  for (let link: StyleChain | null = chain; link; link = link.tail) if (link.head.length > 0) n++;
  return n;
}

/** The styles of the innermost links above the outermost `depth` links, outermost first. */
export function suffix(chain: StyleChain, depth: number): Styles {
  const links: Styles[] = [];
  for (let link: StyleChain | null = chain; link; link = link.tail) {
    if (link.head.length > 0) links.push(link.head);
  }
  const out: Property[] = [];
  for (let i = links.length - depth - 1; i >= 0; i--) out.push(...links[i]!);
  return out;
}
