// Ported from Typst 0.15.1: crates/typst-library/src/math/ir/item.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import type { Augment, BoxElem, CancelAngle, Content, Stroke } from '../eval/content.js';
import type { Span } from '../eval/diag.js';
import type { Abs, Em, FixedAlignment, Length, Rel, RelLength } from '../eval/layout.js';
import { lengthAt, relIsOne, sc } from '../eval/layout.js';
import type { StyleChain } from '../eval/styles.js';
import { Limits, limitsForCharWithClass } from '../elements/attach.js';
import type { LeftRightAlternator } from '../elements/mod.js';
import { MathSize, equationCramped, equationSize } from '../elements/style.js';
import { MathClass, defaultMathClass } from '../utils/math-class.js';
import type { AlignedRow } from './multiline.js';

/** An item before alignment points and linebreaks are resolved. */
export type RawMathItem = MathItem | { readonly type: 'linebreak' } | { readonly type: 'align' };

export const LINEBREAK: RawMathItem = { type: 'linebreak' };
export const ALIGN: RawMathItem = { type: 'align' };

/** A math item: a component, explicit spacing, a space, or a tag. */
export type MathItem = ComponentItem | SpacingItem | SpaceItem | TagItem;

export interface SpacingItem {
  readonly type: 'spacing';
  amount: Length;
  fontSize: Abs;
  readonly weak: boolean;
}

export interface SpaceItem {
  readonly type: 'space';
}

export const SPACE: SpaceItem = { type: 'space' };

/**
 * Where an element that Typst can locate or tag starts or ends, like
 * `MathItem::Tag`: around `strong`, `emph`, `highlight`, `link`, `hide` and raw
 * text in HTML output. Tags draw nothing and take no part in spacing, but
 * Typst's MathML counts them as nodes, so a lone `#strong[x]` in a script
 * gets an `mrow`.
 */
export interface TagItem {
  readonly type: 'tag';
}

export const TAG: TagItem = { type: 'tag' };

/** A component: something with math properties and styles, like Typst's `MathComponent`. */
export interface ComponentItem {
  readonly type: 'component';
  readonly kind: MathKind;
  readonly props: MathProperties;
  readonly styles: StyleChain;
}

export type MathKind =
  | { readonly tag: 'group'; readonly items: MathItem[] }
  | { readonly tag: 'multiline'; readonly rows: AlignedRow[]; centered: boolean }
  | { readonly tag: 'radical'; readonly radicand: MathItem; readonly index: MathItem | null; readonly sqrt: MathItem }
  | {
      readonly tag: 'fenced';
      readonly open: MathItem | null;
      readonly close: MathItem | null;
      readonly body: FencedBody;
      readonly balanced: boolean;
    }
  | {
      readonly tag: 'fraction';
      readonly numerator: MathItem;
      readonly denominator: MathItem;
      readonly line: boolean;
      readonly padding: Em;
    }
  | { readonly tag: 'skewed-fraction'; readonly numerator: MathItem; readonly denominator: MathItem; readonly slash: MathItem }
  | {
      readonly tag: 'table';
      readonly cells: AlignedRow[][];
      readonly gap: { x: Rel<Abs>; y: Rel<Abs> };
      readonly augment: Augment | null;
      readonly align: FixedAlignment;
      readonly alternator: LeftRightAlternator;
    }
  | {
      readonly tag: 'scripts';
      readonly base: MathItem;
      readonly top: MathItem | null;
      readonly bottom: MathItem | null;
      readonly topLeft: MathItem | null;
      readonly bottomLeft: MathItem | null;
      readonly topRight: MathItem | null;
      readonly bottomRight: MathItem | null;
    }
  | {
      readonly tag: 'accent';
      readonly base: MathItem;
      readonly accent: MathItem;
      readonly position: Position;
      readonly dotless: boolean;
      readonly exactFrameWidth: boolean;
    }
  | {
      readonly tag: 'cancel';
      readonly base: MathItem;
      readonly length: Rel<Abs>;
      readonly stroke: Stroke;
      readonly cross: boolean;
      readonly invertFirstLine: boolean;
      readonly angle: CancelAngle | null;
    }
  | { readonly tag: 'line'; readonly base: MathItem; readonly position: Position }
  | { readonly tag: 'primes'; readonly count: number }
  | { readonly tag: 'text'; readonly text: string }
  | { readonly tag: 'number'; readonly text: string }
  | GlyphKind
  | { readonly tag: 'external'; readonly content: Content }
  /** Inline content in a box, laid out on its own. */
  | { readonly tag: 'box'; readonly elem: BoxElem };

/** A glyph. Its stretch and the other mutable parts change while the IR is built. */
export interface GlyphKind {
  readonly tag: 'glyph';
  readonly text: string;
  class: MathClass;
  stretch: Stretch;
  midStretched: boolean | null;
  flac: boolean;
}

/** The properties of a component, like Typst's `MathProperties`. */
export interface MathProperties {
  limits: Limits;
  class: MathClass | null;
  readonly size: MathSize;
  readonly cramped: boolean;
  ignorant: boolean;
  spaced: boolean;
  lspace: Em | null;
  rspace: Em | null;
  alignFormInfix: boolean;
  readonly span: Span;
}

export function properties(styles: StyleChain, cls: MathClass | null, span: Span): MathProperties {
  return {
    limits: Limits.Never,
    class: cls,
    size: equationSize(styles),
    cramped: equationCramped(styles),
    ignorant: false,
    spaced: false,
    lspace: null,
    rspace: null,
    alignFormInfix: false,
    span,
  };
}

export function component(kind: MathKind, props: MathProperties, styles: StyleChain): ComponentItem {
  return { type: 'component', kind, props, styles };
}

// --- Item accessors ----------------------------------------------------------

export function isItem(raw: RawMathItem): raw is MathItem {
  return raw.type !== 'linebreak' && raw.type !== 'align';
}

/** One item, or a group of several. */
export function wrap(items: MathItem[], styles: StyleChain): MathItem {
  return items.length === 1 ? items[0]! : groupItem(items, styles);
}

export function limitsOf(item: MathItem): Limits {
  return item.type === 'component' ? item.props.limits : Limits.Never;
}

export function rawClass(item: MathItem): MathClass | null {
  if (item.type === 'component') return item.props.class;
  return item.type === 'tag' ? MathClass.Special : MathClass.Space;
}

export function classOf(item: MathItem): MathClass {
  return rawClass(item) ?? MathClass.Normal;
}

/** The class on the right side, where a fence with a closing delimiter closes. */
export function rclass(item: MathItem): MathClass {
  if (item.type === 'component' && item.kind.tag === 'fenced' && item.props.class === null && item.kind.close) {
    return MathClass.Closing;
  }
  return classOf(item);
}

/** The class on the left side, where a fence with an opening delimiter opens. */
export function lclass(item: MathItem): MathClass {
  if (item.type === 'component' && item.kind.tag === 'fenced' && item.props.class === null && item.kind.open) {
    return MathClass.Opening;
  }
  return classOf(item);
}

export function sizeOf(item: MathItem): MathSize | null {
  return item.type === 'component' ? item.props.size : null;
}

/** Whether automatic spacing goes around the item, like a space between letters and text. */
export function isSpaced(item: MathItem): boolean {
  if (classOf(item) === MathClass.Fence) return true;
  if (item.type !== 'component' || !item.props.spaced) return false;
  const cls = item.props.class ?? MathClass.Normal;
  return cls === MathClass.Normal || cls === MathClass.Alphabetic;
}

export function isIgnorant(item: MathItem): boolean {
  return item.type === 'tag' || (item.type === 'component' && item.props.ignorant);
}

export function isRawIgnorant(raw: RawMathItem): boolean {
  return isItem(raw) && isIgnorant(raw);
}

export function spanOf(item: MathItem): Span {
  return item.type === 'component' ? item.props.span : null;
}

export function midStretched(item: MathItem): boolean | null {
  return item.type === 'component' && item.kind.tag === 'glyph' ? item.kind.midStretched : null;
}

export function isMultiline(item: MathItem): boolean {
  return item.type === 'component' && item.kind.tag === 'multiline';
}

/** The items of a group, or the item itself. */
export function asSlice(item: MathItem): MathItem[] {
  return item.type === 'component' && item.kind.tag === 'group' ? item.kind.items : [item];
}

export function setLimits(item: MathItem, limits: Limits): void {
  if (item.type === 'component') item.props.limits = limits;
}

export function setClass(item: MathItem, cls: MathClass): void {
  if (item.type === 'component') item.props.class = cls;
}

export function setExplicitClass(item: MathItem, cls: MathClass): void {
  setClass(item, cls);
  if (item.type === 'component' && item.kind.tag === 'glyph') {
    const glyph = item.kind;
    glyph.class = cls;
    // Add the stretch `resolve_symbol` gives large display glyphs, since the
    // class is not recursive.
    if (cls === MathClass.Large && item.props.size === MathSize.Display && !isExplicit(glyph.stretch, 'y')) {
      glyph.stretch = withY(glyph.stretch, stretchInfoDefault());
    }
  }
}

export function setLspace(item: MathItem, lspace: Em | null): void {
  if (item.type === 'component' && item.props.lspace === null) item.props.lspace = lspace;
}

export function setRspace(item: MathItem, rspace: Em | null): void {
  if (item.type === 'component' && item.props.rspace === null) item.props.rspace = rspace;
}

export function withMultilineCentering(item: MathItem): MathItem {
  if (item.type === 'component' && item.kind.tag === 'multiline') item.kind.centered = true;
  return item;
}

export function setMidStretched(item: MathItem, value: boolean | null): void {
  if (item.type === 'component' && item.kind.tag === 'glyph') item.kind.midStretched = value;
}

/** Sets an explicit stretch. */
export function setStretch(item: MathItem, stretch: Stretch): void {
  const explicit: Stretch = {
    x: stretch.x ? { ...stretch.x, explicit: true } : null,
    y: stretch.y ? { ...stretch.y, explicit: true } : null,
  };
  replaceStretch(item, explicit);
}

export function replaceStretch(item: MathItem, stretch: Stretch): void {
  if (item.type === 'component' && item.kind.tag === 'glyph') item.kind.stretch = stretch;
}

export function setYStretch(item: MathItem, info: StretchInfo): void {
  if (item.type === 'component' && item.kind.tag === 'glyph') {
    item.kind.stretch = withY(item.kind.stretch, { ...info, explicit: true });
  }
}

export function updateStretch(item: MathItem, info: StretchInfo): void {
  if (item.type === 'component' && item.kind.tag === 'glyph') {
    item.kind.stretch = stretchUpdate(item.kind.stretch, info);
  }
}

export function setFlac(item: MathItem): void {
  if (item.type === 'component' && item.kind.tag === 'glyph') item.kind.flac = true;
}

// --- Constructors ------------------------------------------------------------

export function groupItem(items: MathItem[], styles: StyleChain): MathItem {
  return component({ tag: 'group', items }, properties(styles, null, null), styles);
}

export function multilineItem(rows: AlignedRow[], styles: StyleChain): MathItem {
  return component({ tag: 'multiline', rows, centered: false }, properties(styles, null, null), styles);
}

export function radicalItem(
  radicand: MathItem,
  index: MathItem | null,
  sqrt: MathItem,
  styles: StyleChain,
  span: Span,
): MathItem {
  return component({ tag: 'radical', radicand, index, sqrt }, properties(styles, null, span), styles);
}

export function fencedItem(
  open: MathItem | null,
  close: MathItem | null,
  body: MathItem | FencedBody,
  balanced: boolean,
  styles: StyleChain,
  span: Span,
): MathItem {
  const fencedBody: FencedBody = 'shared' in body ? body : { shared: null, item: body };
  return component({ tag: 'fenced', open, close, body: fencedBody, balanced }, properties(styles, null, span), styles);
}

export function fractionItem(
  numerator: MathItem,
  denominator: MathItem,
  line: boolean,
  padding: Em,
  styles: StyleChain,
  span: Span,
): MathItem {
  return component({ tag: 'fraction', numerator, denominator, line, padding }, properties(styles, null, span), styles);
}

export function skewedFractionItem(
  numerator: MathItem,
  denominator: MathItem,
  slash: MathItem,
  styles: StyleChain,
  span: Span,
): MathItem {
  return component({ tag: 'skewed-fraction', numerator, denominator, slash }, properties(styles, null, span), styles);
}

export function tableItem(
  cells: AlignedRow[][],
  gap: { x: Rel<Abs>; y: Rel<Abs> },
  augment: Augment | null,
  align: FixedAlignment,
  alternator: LeftRightAlternator,
  styles: StyleChain,
  span: Span,
): MathItem {
  return component({ tag: 'table', cells, gap, augment, align, alternator }, properties(styles, null, span), styles);
}

export function scriptsItem(
  base: MathItem,
  top: MathItem | null,
  bottom: MathItem | null,
  topLeft: MathItem | null,
  bottomLeft: MathItem | null,
  topRight: MathItem | null,
  bottomRight: MathItem | null,
  styles: StyleChain,
): MathItem {
  return component(
    { tag: 'scripts', base, top, bottom, topLeft, bottomLeft, topRight, bottomRight },
    properties(styles, rawClass(base), null),
    styles,
  );
}

export function accentItem(
  base: MathItem,
  accent: MathItem,
  position: Position,
  dotless: boolean,
  exactFrameWidth: boolean,
  styles: StyleChain,
): MathItem {
  return component(
    { tag: 'accent', base, accent, position, dotless, exactFrameWidth },
    properties(styles, rawClass(base), null),
    styles,
  );
}

export function cancelItem(
  base: MathItem,
  length: Rel<Abs>,
  stroke: Stroke,
  cross: boolean,
  invertFirstLine: boolean,
  angle: CancelAngle | null,
  styles: StyleChain,
  span: Span,
): MathItem {
  return component(
    { tag: 'cancel', base, length, stroke, cross, invertFirstLine, angle },
    properties(styles, rawClass(base), span),
    styles,
  );
}

export function lineItem(base: MathItem, position: Position, styles: StyleChain, span: Span): MathItem {
  return component({ tag: 'line', base, position }, properties(styles, rawClass(base), span), styles);
}

/** The prime character. */
export const PRIME_CHAR = '′';

export function primesItem(count: number, styles: StyleChain): MathItem {
  return component({ tag: 'primes', count }, properties(styles, null, null), styles);
}

export function textItem(text: string, styles: StyleChain, span: Span): MathItem {
  const props = properties(styles, MathClass.Alphabetic, span);
  props.spaced = true;
  return component({ tag: 'text', text }, props, styles);
}

export function numberItem(text: string, styles: StyleChain, span: Span): MathItem {
  return component({ tag: 'number', text }, properties(styles, null, span), styles);
}

export function glyphItem(text: string, styles: StyleChain, span: Span): ComponentItem {
  const c = text.codePointAt(0)!;
  const cls = defaultMathClass(c) ?? null;
  const props = properties(styles, cls, span);
  props.limits = limitsForCharWithClass(c, cls ?? undefined);
  return component(
    { tag: 'glyph', text, class: cls ?? MathClass.Normal, stretch: NO_STRETCH, midStretched: null, flac: false },
    props,
    styles,
  );
}

export function boxItem(elem: BoxElem, styles: StyleChain): MathItem {
  const props = properties(styles, null, elem.span);
  props.spaced = true;
  return component({ tag: 'box', elem }, props, styles);
}

export function externalItem(content: Content, styles: StyleChain): MathItem {
  const props = properties(styles, null, content.span);
  props.spaced = true;
  return component({ tag: 'external', content }, props, styles);
}

// --- Fences shared across lines -------------------------------------------------

/** The bodies of a fence split across lines, sized together. */
export interface SharedFenceSizing {
  readonly items: MathItem[];
  readonly styles: StyleChain;
  /** The height the fences stretch relative to, once layout has measured it. */
  relativeTo: Abs | null;
}

/** The shared height, measured by `f` the first time, like `try_get_or_update`. */
export function sharedRelativeTo(sizing: SharedFenceSizing, f: (items: MathItem[], styles: StyleChain) => Abs): Abs {
  sizing.relativeTo ??= f(sizing.items, sizing.styles);
  return sizing.relativeTo;
}

/** A fence's body: its own item, or one of a shared sizing's items. */
export type FencedBody =
  | { readonly shared: null; readonly item: MathItem }
  | { readonly shared: SharedFenceSizing; readonly index: number };

export function fencedBodyItem(body: FencedBody): MathItem {
  return body.shared === null ? body.item : body.shared.items[body.index]!;
}

// --- Stretching ------------------------------------------------------------

/** How a glyph stretches, horizontally and vertically. */
export interface Stretch {
  readonly x: StretchInfo | null;
  readonly y: StretchInfo | null;
}

export interface StretchInfo {
  readonly target: Rel<Abs>;
  readonly buffer: Rel<Abs> | null;
  readonly explicit: boolean;
  readonly requestedTarget: RelLength | null;
  readonly shortFall: Em;
  readonly relativeTo: Abs | null;
  readonly fontSize: Abs | null;
}

export const NO_STRETCH: Stretch = { x: null, y: null };

export function stretchInfo(target: Rel<Abs>, shortFall: Em): StretchInfo {
  return { target, buffer: null, explicit: false, requestedTarget: null, shortFall, relativeTo: null, fontSize: null };
}

export function stretchInfoDefault(): StretchInfo {
  return stretchInfo({ rel: 1, abs: 0 }, 0);
}

/** Stretch info for a size relative to the font size, like `StretchInfo::from_size`. */
export function stretchInfoFromSize(size: RelLength, shortFall: Em, fontSize: Abs): StretchInfo {
  return {
    target: { rel: size.rel, abs: lengthAt(size.abs, fontSize) },
    buffer: null,
    explicit: false,
    requestedTarget: relIsOne(size) ? null : size,
    shortFall,
    relativeTo: null,
    fontSize: null,
  };
}

export const withX = (s: Stretch, x: StretchInfo): Stretch => ({ x, y: s.y });
export const withY = (s: Stretch, y: StretchInfo): Stretch => ({ x: s.x, y });

/** Multiplies stretch infos, like `StretchInfo: MulAssign`. */
function mulInfo(lhs: StretchInfo, rhs: StretchInfo): StretchInfo {
  let target = lhs.target;
  if (lhs.buffer) {
    target = { rel: lhs.target.rel * lhs.buffer.rel, abs: sc(lhs.buffer.rel * lhs.target.abs) + lhs.buffer.abs };
  }
  let requestedTarget = lhs.requestedTarget;
  if (rhs.requestedTarget) {
    const requested = rhs.requestedTarget;
    requestedTarget = requestedTarget
      ? {
          rel: requestedTarget.rel * requested.rel,
          abs: {
            abs: requested.rel * requestedTarget.abs.abs + requested.abs.abs,
            em: requested.rel * requestedTarget.abs.em + requested.abs.em,
          },
        }
      : requested;
  }
  return {
    ...lhs,
    target,
    buffer: rhs.target,
    requestedTarget,
    explicit: lhs.explicit || rhs.explicit,
    shortFall: rhs.shortFall,
  };
}

/** Applies a stretch on both axes, like `Stretch::update`. */
export function stretchUpdate(s: Stretch, info: StretchInfo): Stretch {
  const explicit = { ...info, explicit: true };
  return {
    x: s.x ? mulInfo(s.x, explicit) : explicit,
    y: s.y ? mulInfo(s.y, explicit) : explicit,
  };
}

/** Sets the size a relative stretch target refers to, unless set, like `set_stretch_relative_to`. */
export function setStretchRelativeTo(item: MathItem, relativeTo: Abs, axis: 'x' | 'y'): void {
  if (item.type !== 'component' || item.kind.tag !== 'glyph') return;
  const info = item.kind.stretch[axis];
  if (info && info.relativeTo === null) item.kind.stretch = { ...item.kind.stretch, [axis]: { ...info, relativeTo } };
}

/** Sets the font size of the short fall, unless set, like `set_stretch_font_size`. */
export function setStretchFontSize(item: MathItem, fontSize: Abs, axis: 'x' | 'y'): void {
  if (item.type !== 'component' || item.kind.tag !== 'glyph') return;
  const info = item.kind.stretch[axis];
  if (info && info.fontSize === null) item.kind.stretch = { ...item.kind.stretch, [axis]: { ...info, fontSize } };
}

/** The stretch info on an axis, with its buffer applied, like `Stretch::resolve`. */
export function stretchResolve(s: Stretch, axis: 'x' | 'y'): StretchInfo | null {
  const info = s[axis];
  if (!info?.buffer) return info;
  const buffer = info.buffer;
  const target =
    info.relativeTo !== null
      ? buffer
      : { rel: info.target.rel * buffer.rel, abs: sc(buffer.rel * info.target.abs) + buffer.abs };
  return { ...info, target };
}

/** Whether the stretch on an axis was set explicitly. */
export function isExplicit(s: Stretch, axis: 'x' | 'y'): boolean {
  return s[axis]?.explicit ?? false;
}

/** The requested stretch on an axis, if it differs from 100%, like `resolve_requested`. */
export function resolveRequested(s: Stretch, axis: 'x' | 'y'): RelLength | null {
  const target = s[axis]?.requestedTarget ?? null;
  return target && !relIsOne(target) ? target : null;
}

export enum Position {
  Above,
  Below,
}

