// Ported from Typst 0.15.1: crates/typst-library/src/foundations/styles.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

// Typst's styles are lists of properties, each setting one field of one
// element, such as `equation.size`. A style chain links such lists from the
// innermost outward. Typlet keeps that model, carries show-set rules as
// properties of their own, and drops other show rules (recipes) and
// revocations, which it does not support.

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

/**
 * A show-set rule, `show selector: set elem(..)`: styles for the elements
 * the selector matches, like a `Recipe` whose transformation is a `Style`.
 * Typlet supports them for equations (docs/DESIGN.md §6.3).
 */
export interface ShowSet {
  /** The element the selector matches, such as `equation`. */
  readonly elem: string;
  /** The field values `where()` asks for, such as `block: true`. */
  readonly fields: readonly (readonly [string, unknown])[];
  readonly styles: Styles;
}

/** The element name of the properties that carry show-set rules. */
export const SHOW_SET = '#show';

/** A show-set rule as a property, so that it travels with the styles of a block or a preamble. */
export function showSet(rule: ShowSet): Property {
  return { elem: SHOW_SET, field: rule.elem, value: rule };
}

/**
 * The styles the chain's show-set rules give an element whose fields
 * `matches` accepts, from the outermost rule to the innermost, so that later
 * rules take precedence, as Typst's realization collects them.
 */
export function showSetStyles(chain: StyleChain, elem: string, matches: (field: string, value: unknown) => boolean): Styles {
  const links: Styles[] = [];
  for (let link: StyleChain | null = chain; link; link = link.tail) links.push(link.head);
  const out: Property[] = [];
  for (let i = links.length - 1; i >= 0; i--) {
    for (const p of links[i]!) {
      if (p.elem !== SHOW_SET || p.field !== elem) continue;
      const rule = p.value as ShowSet;
      if (rule.fields.every(([field, value]) => matches(field, value))) out.push(...rule.styles);
    }
  }
  return out;
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
