// Ported from Typst 0.15.1: crates/typst-library/src/layout/frame.rs, crates/typst-library/src/layout/transform.rs, crates/typst-library/src/text/item.rs, crates/typst-library/src/visualize/shape.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// A frame of positioned glyphs and shapes, the result of layout. Typlet keeps
// what math layout produces: groups, text and lines or rectangles. Positions
// are in raw `Abs` units with y pointing down; glyph advances and offsets are
// in ems with y pointing up, as in Typst.

import type { Color } from '../eval/color.js';
import { type Abs, type Em, type FixedAlignment, emAt } from '../eval/layout.js';

export interface Point {
  readonly x: Abs;
  readonly y: Abs;
}

export interface Size {
  x: Abs;
  y: Abs;
}

export const point = (x: Abs, y: Abs): Point => ({ x, y });
export const ORIGIN: Point = { x: 0, y: 0 };
export const pointAdd = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });

/** Where an alignment puts something in the free space `extent`, like `FixedAlignment::position`. */
export function alignPosition(align: FixedAlignment, extent: Abs): Abs {
  return align === 'start' ? 0 : align === 'center' ? extent / 2 : extent;
}

/** An affine transform: `[sx kx tx; ky sy ty]`. */
export interface Transform {
  readonly sx: number;
  readonly ky: number;
  readonly kx: number;
  readonly sy: number;
  readonly tx: Abs;
  readonly ty: Abs;
}

export const IDENTITY: Transform = { sx: 1, ky: 0, kx: 0, sy: 1, tx: 0, ty: 0 };
export const translate = (tx: Abs, ty: Abs): Transform => ({ ...IDENTITY, tx, ty });

/** A rotation by `angle` radians, clockwise on screen. */
export function rotate(angle: number): Transform {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { sx: cos, ky: sin, kx: -sin, sy: cos, tx: 0, ty: 0 };
}

export const isIdentity = (t: Transform): boolean =>
  t.sx === 1 && t.ky === 0 && t.kx === 0 && t.sy === 1 && t.tx === 0 && t.ty === 0;

/** `a` applied after `b`, like `Transform::pre_concat` (`a.pre_concat(b)` = a ∘ b). */
export function preConcat(a: Transform, b: Transform): Transform {
  return {
    sx: a.sx * b.sx + a.kx * b.ky,
    ky: a.ky * b.sx + a.sy * b.ky,
    kx: a.sx * b.kx + a.kx * b.sy,
    sy: a.ky * b.kx + a.sy * b.sy,
    tx: a.sx * b.tx + a.kx * b.ty + a.tx,
    ty: a.ky * b.tx + a.sy * b.ty + a.ty,
  };
}

export function applyTransform(t: Transform, p: Point): Point {
  return { x: t.sx * p.x + t.kx * p.y + t.tx, y: t.ky * p.x + t.sy * p.y + t.ty };
}

/** A glyph in a text item. Advances and offsets are in ems, y up. */
export interface Glyph {
  readonly id: number;
  xAdvance: Em;
  readonly xOffset: Em;
  readonly yAdvance: Em;
  readonly yOffset: Em;
  /** The glyph's part of the item's text, as UTF-16 offsets. */
  readonly range: readonly [number, number];
}

import type { FontFace } from './font.js';

export type { FontFace };

/** A run of glyphs in one font, like Typst's `TextItem`. */
export interface TextItem {
  readonly font: FontFace;
  readonly size: Abs;
  readonly fill: Color;
  readonly text: string;
  glyphs: Glyph[];
}

/** The width of a text item: the sum of its advances, like `TextItem::width`. */
export function textWidth(item: TextItem): Abs {
  let width: Em = 0;
  for (const glyph of item.glyphs) width += glyph.xAdvance;
  return emAt(width, item.size);
}

export type LineCap = 'butt' | 'round' | 'square';

/** A stroke with fixed properties, like Typst's `FixedStroke`. */
export interface FixedStroke {
  readonly paint: Color;
  readonly thickness: Abs;
  readonly cap: LineCap;
  /** Lengths of dashes and gaps, and where the pattern starts; `null` for a solid line. */
  readonly dash?: { readonly array: readonly Abs[]; readonly phase: Abs } | null;
}

/** A box's border: per side, and per corner. */
export interface BoxBorder {
  readonly strokes: { readonly [side in 'left' | 'top' | 'right' | 'bottom']: FixedStroke | null };
  readonly radius: { readonly [corner in 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left']: Abs };
}

export type Geometry =
  /** A line from the origin to a point. */
  | { readonly kind: 'line'; readonly to: Point }
  /** A rectangle from the origin. */
  | { readonly kind: 'rect'; readonly size: Size }
  /**
   * A box with rounded corners or different strokes per side. Typst draws
   * these as paths (`segmented_rect`); Typlet's HTML draws them with CSS.
   */
  | { readonly kind: 'box'; readonly size: Size; readonly border: BoxBorder };

export interface Shape {
  readonly geometry: Geometry;
  readonly fill: Color | null;
  readonly stroke: FixedStroke | null;
}

export type FrameItem =
  | { readonly kind: 'group'; readonly frame: Frame; readonly transform: Transform }
  | { readonly kind: 'text'; readonly text: TextItem }
  | { readonly kind: 'shape'; readonly shape: Shape }
  /** A link over an area: the content below it links to `dest`. */
  | { readonly kind: 'link'; readonly dest: string; readonly size: Size };

/**
 * A finished layout: a size, an optional baseline, and positioned items.
 * Soft frames merge into their parent when pushed into it, if they are small
 * or the parent is empty, as in Typst.
 */
export class Frame {
  size: Size;
  private baselineValue: Abs | null = null;
  items: [Point, FrameItem][] = [];

  private constructor(
    size: Size,
    readonly soft: boolean,
  ) {
    this.size = { x: size.x, y: size.y };
  }

  static soft(size: Size): Frame {
    return new Frame(size, true);
  }

  static hard(size: Size): Frame {
    return new Frame(size, false);
  }

  get width(): Abs {
    return this.size.x;
  }

  get height(): Abs {
    return this.size.y;
  }

  /** The baseline, or the bottom edge if there is none. */
  get baseline(): Abs {
    return this.baselineValue ?? this.size.y;
  }

  hasBaseline(): boolean {
    return this.baselineValue !== null;
  }

  setBaseline(baseline: Abs): void {
    this.baselineValue = baseline;
  }

  get ascent(): Abs {
    return this.baseline;
  }

  get descent(): Abs {
    return this.size.y - this.baseline;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  push(pos: Point, item: FrameItem): void {
    this.items.push([pos, item]);
  }

  /** Adds a frame's items, as a group or merged in. */
  pushFrame(pos: Point, frame: Frame): void {
    if (frame.soft && (this.items.length === 0 || frame.items.length <= 5)) {
      if (pos.x === 0 && pos.y === 0) {
        for (const item of frame.items) this.items.push(item);
      } else {
        for (const [p, item] of frame.items) this.items.push([pointAdd(p, pos), item]);
      }
    } else {
      this.push(pos, { kind: 'group', frame, transform: IDENTITY });
    }
  }

  /** Adds items below the existing ones, like `prepend_multiple`. */
  prepend(items: [Point, FrameItem][]): void {
    this.items = [...items, ...this.items];
  }

  /** Hides the content but keeps the size, like `Frame::hide`. */
  hide(): void {
    this.items = this.items.filter(([, item]) => {
      if (item.kind !== 'group') return false;
      item.frame.hide();
      return !item.frame.isEmpty();
    });
  }

  /** Moves every item and the baseline. */
  translate(offset: Point): void {
    if (offset.x === 0 && offset.y === 0) return;
    if (this.baselineValue !== null) this.baselineValue += offset.y;
    this.items = this.items.map(([p, item]) => [pointAdd(p, offset), item]);
  }

  /** Resizes the frame, moving its content as the alignment says; returns the offset. */
  resize(target: Size, alignX: FixedAlignment, alignY: FixedAlignment): Point {
    if (this.size.x === target.x && this.size.y === target.y) return ORIGIN;
    const offset = point(alignPosition(alignX, target.x - this.size.x), alignPosition(alignY, target.y - this.size.y));
    this.size = { x: target.x, y: target.y };
    this.translate(offset);
    return offset;
  }

  /** Applies a transform to the frame's content, through a group. */
  transform(transform: Transform): void {
    if (this.isEmpty()) return;
    const inner = Frame.hard(this.size);
    inner.items = this.items;
    if (this.baselineValue !== null) inner.setBaseline(this.baselineValue);
    this.items = [[ORIGIN, { kind: 'group', frame: inner, transform }]];
  }
}

/** A glyph or shape with its position on the page, from `walkFrame`. */
export type Placed =
  | {
      readonly kind: 'glyph';
      readonly font: FontFace;
      readonly id: number;
      /** The glyph's origin, on its baseline. */
      readonly at: Point;
      readonly size: Abs;
      readonly text: string;
      readonly fill: Color;
      readonly transform: Transform;
    }
  | { readonly kind: 'shape'; readonly shape: Shape; readonly transform: Transform }
  | { readonly kind: 'link'; readonly dest: string; readonly size: Size; readonly transform: Transform };

/** Visits every glyph and shape of a frame, with the transform that places it. */
export function walkFrame(frame: Frame, ts: Transform, visit: (placed: Placed) => void): void {
  for (const [pos, item] of frame.items) {
    const at = preConcat(ts, translate(pos.x, pos.y));
    switch (item.kind) {
      case 'group':
        walkFrame(item.frame, preConcat(at, item.transform), visit);
        break;
      case 'text': {
        const text = item.text;
        let x = 0;
        let y = 0;
        for (const glyph of text.glyphs) {
          visit({
            kind: 'glyph',
            font: text.font,
            id: glyph.id,
            at: applyTransform(at, point(x + emAt(glyph.xOffset, text.size), -(y + emAt(glyph.yOffset, text.size)))),
            size: text.size,
            text: text.text.slice(glyph.range[0], glyph.range[1]),
            fill: text.fill,
            transform: at,
          });
          x += emAt(glyph.xAdvance, text.size);
          y += emAt(glyph.yAdvance, text.size);
        }
        break;
      }
      case 'shape':
        visit({ kind: 'shape', shape: item.shape, transform: at });
        break;
      case 'link':
        visit({ kind: 'link', dest: item.dest, size: item.size, transform: at });
        break;
    }
  }
}
