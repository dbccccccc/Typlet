// Ported from Typst 0.15.1: crates/typst-library/src/foundations/content/mod.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

// Typst's content is a tree of elements with typed fields. Typlet's elements
// are plain objects: `func` names the element as Typst does, and the fields
// use Typst's field names. An optional field that was never set is
// `undefined`; one explicitly set to `none` is `null`. That way Typlet's
// content serializes to the same JSON as Typst's `#metadata` (see `toJson`).

import type { Span } from './diag.js';
import type { Styles } from './styles.js';
import type { Color } from './color.js';
import type { Angle, Fr, HAlignment, RelLength } from './layout.js';
import type { MathClass } from '../utils/math-class.js';
import type { Func } from './func.js';

/** Spacing for `h`: a relative length or a fraction. */
export type Spacing = { readonly rel: RelLength } | { readonly fr: Fr };

/** A delimiter character, or `null` for none. */
export type Delimiter = string | null;

export interface DelimiterPair {
  readonly open: Delimiter;
  readonly close: Delimiter;
}

export interface Augment {
  readonly hline: readonly number[];
  readonly vline: readonly number[];
  /** `null` is `auto`. */
  readonly stroke: Stroke | null;
}

/** A stroke, with `undefined` for unset (`auto`) parts, like Typst's `Stroke`. */
export interface Stroke {
  readonly paint?: Color;
  readonly thickness?: import('./layout.js').Length;
  readonly cap?: 'butt' | 'round' | 'square';
  readonly join?: 'miter' | 'round' | 'bevel';
  /** `null` is a solid line. */
  readonly dash?: DashPattern | null;
  readonly miterLimit?: number;
}

/** A dash pattern: lengths of dashes and gaps, and where the pattern starts. */
export interface DashPattern {
  /** Lengths, or `null` for a dot: a dash as long as the stroke is thick. */
  readonly array: readonly (import('./layout.js').Length | null)[];
  readonly phase: import('./layout.js').Length;
  /** The name it was given by, such as "dashed", for `repr`. */
  readonly name?: string;
}

export type CancelAngle = { readonly angle: Angle } | { readonly func: Func };

export type FracStyle = 'vertical' | 'skewed' | 'horizontal';

interface Base {
  span: Span;
  /** A label attached in markup, such as `<intro>`, without the angle brackets. */
  readonly label?: string;
}

export interface SequenceElem extends Base {
  readonly func: 'sequence';
  readonly children: Content[];
}
export interface StyledElem extends Base {
  readonly func: 'styled';
  readonly child: Content;
  readonly styles: Styles;
}
export interface SpaceElem extends Base {
  readonly func: 'space';
}
export interface LinebreakElem extends Base {
  readonly func: 'linebreak';
  readonly justify?: boolean;
}
export interface TextElem extends Base {
  readonly func: 'text';
  readonly text: string;
}
export interface SymbolElem extends Base {
  readonly func: 'symbol';
  readonly text: string;
}
export interface RawElem extends Base {
  readonly func: 'raw';
  readonly text: string;
  readonly block?: boolean;
  readonly lang?: string | null;
}
export interface HElem extends Base {
  readonly func: 'h';
  readonly amount: Spacing;
  readonly weak?: boolean;
}
export interface AlignPointElem extends Base {
  readonly func: 'align-point';
}
export interface EquationElem extends Base {
  readonly func: 'equation';
  readonly body: Content;
  readonly block?: boolean;
  /** `null` is none. */
  readonly numbering?: import('./numbering.js').Numbering | null;
  readonly 'number-align'?: import('./layout.js').Alignment;
  /** `null` is none; Typlet has no references, which use it. */
  readonly supplement?: unknown;
  readonly alt?: string | null;
}
export interface ClassElem extends Base {
  readonly func: 'class';
  readonly class: MathClass;
  readonly body: Content;
}
export interface AttachElem extends Base {
  readonly func: 'attach';
  readonly base: Content;
  t?: Content | null;
  b?: Content | null;
  tl?: Content | null;
  bl?: Content | null;
  tr?: Content | null;
  br?: Content | null;
}
export interface PrimesElem extends Base {
  readonly func: 'primes';
  readonly count: number;
}
export interface ScriptsElem extends Base {
  readonly func: 'scripts';
  readonly body: Content;
}
export interface LimitsElem extends Base {
  readonly func: 'limits';
  readonly body: Content;
  readonly inline?: boolean;
}
export interface StretchElem extends Base {
  readonly func: 'stretch';
  readonly body: Content;
  readonly size?: RelLength;
}
export interface LrElem extends Base {
  readonly func: 'lr';
  readonly body: Content;
  size?: RelLength;
}
export interface MidElem extends Base {
  readonly func: 'mid';
  readonly body: Content;
}
export interface AccentElem extends Base {
  readonly func: 'accent';
  readonly base: Content;
  readonly accent: string;
  readonly size?: RelLength;
  readonly dotless?: boolean;
}
export interface LineElem extends Base {
  readonly func: 'underline' | 'overline';
  readonly body: Content;
}
export interface UnderOverElem extends Base {
  readonly func:
    | 'underbrace'
    | 'overbrace'
    | 'underbracket'
    | 'overbracket'
    | 'underparen'
    | 'overparen'
    | 'undershell'
    | 'overshell';
  readonly body: Content;
  readonly annotation?: Content | null;
}
export interface CancelElem extends Base {
  readonly func: 'cancel';
  readonly body: Content;
  readonly length?: RelLength;
  readonly inverted?: boolean;
  readonly cross?: boolean;
  /** `null` is `auto`. */
  readonly angle?: CancelAngle | null;
  readonly stroke?: Stroke;
}
export interface FracElem extends Base {
  readonly func: 'frac';
  readonly num: Content;
  readonly denom: Content;
  readonly style?: FracStyle;
  /** Internal: the numerator was written in parentheses that the parser removed. */
  readonly numDeparenthesized?: boolean;
  /** Internal: the denominator was written in parentheses that the parser removed. */
  readonly denomDeparenthesized?: boolean;
}
export interface BinomElem extends Base {
  readonly func: 'binom';
  readonly upper: Content;
  readonly lower: Content[];
}
export interface VecElem extends Base {
  readonly func: 'vec';
  readonly children: Content[];
  readonly delim?: DelimiterPair;
  readonly align?: HAlignment;
  readonly gap?: RelLength;
}
export interface MatElem extends Base {
  readonly func: 'mat';
  readonly rows: Content[][];
  readonly delim?: DelimiterPair;
  readonly align?: HAlignment;
  readonly augment?: Augment | null;
  readonly 'row-gap'?: RelLength;
  readonly 'column-gap'?: RelLength;
}
export interface CasesElem extends Base {
  readonly func: 'cases';
  readonly children: Content[];
  readonly delim?: DelimiterPair;
  readonly reverse?: boolean;
  readonly gap?: RelLength;
}
export interface RootElem extends Base {
  readonly func: 'root';
  readonly radicand: Content;
  readonly index?: Content | null;
}
export interface OpElem extends Base {
  readonly func: 'op';
  readonly text: Content;
  readonly limits?: boolean;
}
export interface ParbreakElem extends Base {
  readonly func: 'parbreak';
}
export interface SmartQuoteElem extends Base {
  readonly func: 'smartquote';
  readonly double?: boolean;
}
export interface StrongElem extends Base {
  readonly func: 'strong';
  readonly body: Content;
  readonly delta?: number;
}
export interface EmphElem extends Base {
  readonly func: 'emph';
  readonly body: Content;
}
export interface HideElem extends Base {
  readonly func: 'hide';
  readonly body: Content;
}
export interface LinkElem extends Base {
  readonly func: 'link';
  readonly dest: string;
  readonly body: Content;
}
/** A value for each side, like Typst's `Sides<Option<T>>`: unset sides are left out. */
export interface Sides<T> {
  readonly left?: T;
  readonly top?: T;
  readonly right?: T;
  readonly bottom?: T;
}
export const SIDES = ['left', 'top', 'right', 'bottom'] as const;

/** A value for each corner, like Typst's `Corners<Option<T>>`: unset corners are left out. */
export interface Corners<T> {
  readonly 'top-left'?: T;
  readonly 'top-right'?: T;
  readonly 'bottom-right'?: T;
  readonly 'bottom-left'?: T;
}
export const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;

/** A box's baseline, like Typst's `BaselinePos`: parts not given are left out. */
export interface BoxBaseline {
  readonly at?: 'auto' | 'top' | 'horizon' | 'bottom';
  readonly shift?: RelLength;
}

/** A width: `auto`, a relative length or a fraction, like Typst's `Sizing`. */
export type Sizing = 'auto' | { readonly rel: RelLength } | { readonly fr: Fr };

export interface BoxElem extends Base {
  readonly func: 'box';
  readonly width?: Sizing;
  readonly height?: RelLength | 'auto';
  readonly baseline?: BoxBaseline;
  /** `null` is none. */
  readonly fill?: Color | null;
  /** A side's `null` is none. */
  readonly stroke?: Sides<Stroke | null>;
  readonly radius?: Corners<RelLength>;
  readonly inset?: Sides<RelLength>;
  readonly outset?: Sides<RelLength>;
  readonly clip?: boolean;
  readonly body?: Content | null;
}
export interface HighlightElem extends Base {
  readonly func: 'highlight';
  /** `null` is none. */
  readonly fill?: Color | null;
  readonly stroke?: Sides<Stroke | null>;
  readonly 'top-edge'?: TextEdge;
  readonly 'bottom-edge'?: TextEdge;
  readonly extent?: import('./layout.js').Length;
  readonly radius?: Corners<RelLength>;
  readonly body: Content;
}
/** A text edge: a font metric, or a length from the baseline. */
export type TextEdge = string | import('./layout.js').Length;

/** A piece of content. */
export type Content =
  | SequenceElem
  | StyledElem
  | SpaceElem
  | LinebreakElem
  | TextElem
  | SymbolElem
  | RawElem
  | HElem
  | AlignPointElem
  | EquationElem
  | ClassElem
  | AttachElem
  | PrimesElem
  | ScriptsElem
  | LimitsElem
  | StretchElem
  | LrElem
  | MidElem
  | AccentElem
  | LineElem
  | UnderOverElem
  | CancelElem
  | FracElem
  | BinomElem
  | VecElem
  | MatElem
  | CasesElem
  | RootElem
  | OpElem
  | ParbreakElem
  | SmartQuoteElem
  | StrongElem
  | EmphElem
  | HideElem
  | LinkElem
  | BoxElem
  | HighlightElem;

/** The names of Typlet's elements. */
export type ElemName = Content['func'];

/** Fields that Typst keeps internal and leaves out of serialized content. */
export const INTERNAL_FIELDS: ReadonlySet<string> = new Set(['span', 'numDeparenthesized', 'denomDeparenthesized']);

// --- Construction ----------------------------------------------------------

export const empty = (): SequenceElem => ({ func: 'sequence', children: [], span: null });
export const textElem = (text: string, span: Span = null): TextElem => ({ func: 'text', text, span });
export const symbolElem = (text: string, span: Span = null): SymbolElem => ({ func: 'symbol', text, span });
export const spaceElem = (span: Span = null): SpaceElem => ({ func: 'space', span });

/**
 * Combines content into a sequence; one item stays as it is, as
 * `Content::sequence` does. With a span, the result is also `spanned`.
 */
export function sequence(children: Content[], span: Span = null): Content {
  if (children.length === 0) return { func: 'sequence', children: [], span };
  if (children.length === 1) return spanned(children[0]!, span);
  return { func: 'sequence', children, span };
}

/** Whether the content is an empty sequence. */
export function isEmpty(content: Content): boolean {
  return content.func === 'sequence' && content.children.length === 0;
}

/** Concatenates content, merging into existing sequences, as Typst's `Content + Content` does. */
export function join(lhs: Content, rhs: Content): Content {
  if (lhs.func === 'sequence' && rhs.func === 'sequence') {
    return { ...lhs, children: [...lhs.children, ...rhs.children] };
  }
  if (lhs.func === 'sequence') return { ...lhs, children: [...lhs.children, rhs] };
  if (rhs.func === 'sequence') return { ...rhs, children: [lhs, ...rhs.children] };
  return sequence([lhs, rhs]);
}

/**
 * Applies styles to content, merging into an existing styled element. The new
 * styles are outer ones: the element's own styles keep precedence.
 */
export function styled(content: Content, styles: Styles): Content {
  if (styles.length === 0) return content;
  if (content.func === 'styled') return { ...content, styles: [...styles, ...content.styles] };
  return { func: 'styled', child: content, styles, span: null };
}

/** Attaches a span to content that has none, as `Content::spanned` does. */
export function spanned<C extends Content>(content: C, span: Span): C {
  if (content.span === null && span !== null) return { ...content, span };
  return content;
}

/** Repeats content `count` times. */
export function repeat(content: Content, count: number): Content {
  return sequence(Array.from({ length: count }, () => content));
}

/** Calls `f` on every item of the content, looking through nested sequences. */
export function forEachInSequence(content: Content, f: (item: Content) => void): void {
  if (content.func === 'sequence') {
    for (const child of content.children) forEachInSequence(child, f);
  } else {
    f(content);
  }
}
