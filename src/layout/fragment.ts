// Ported from Typst 0.15.1: crates/typst-layout/src/math/fragment/mod.rs, crates/typst-layout/src/math/fragment/glyph.rs, crates/typst-layout/src/math/shaping.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// Math fragments: glyphs, frames and spaces, as math layout produces them.
// Glyphs are shaped in New Computer Modern Math, the only math font Typlet
// has, from the metrics in ./font.ts.

import { NAMED_COLORS } from '../eval/color.js';
import { unsupported } from '../eval/diag.js';
import type { Span } from '../eval/diag.js';
import { type Abs, type Em, emAt, relRelativeTo } from '../eval/layout.js';
import type { StyleChain } from '../eval/styles.js';
import { MathSize, equationSize } from '../elements/style.js';
import { type MathProperties, type Stretch, stretchResolve } from '../ir/item.js';
import { type FrameModifiers, fontFace, fontSize, frameModifiers, textFill, textShift } from '../ir/resolve.js';
import { MathClass, defaultMathClass } from '../utils/math-class.js';
import {
  type FontFace,
  hasGlyph,
  type Axis,
  MATH_CONSTANTS,
  MIN_CONNECTOR_OVERLAP,
  UNITS_PER_EM,
  advance,
  boundingBox,
  glyphConstruction,
  isExtendedShape,
  italicCorrection,
  kernInfo,
  shapeMath,
  topAccentAttachment,
} from './font.js';
import { Frame, type Glyph, ORIGIN, type Size, type TextItem, point, textWidth } from './frame.js';

/** Maximum number of times extenders can be repeated. */
const MAX_REPEATS = 1024;

/** Typst's default text fill. */
export const BLACK = NAMED_COLORS.black!;

export type Corner = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';

/** Font units as ems, like `FontInstance::to_em`. */
export const toEm = (units: number): Em => units / UNITS_PER_EM;

// --- Shaping ---------------------------------------------------------------------

/** The OpenType features that math shaping turns on. */
export interface MathFeatures {
  readonly ssty: 0 | 1 | 2;
  readonly dtls: boolean;
  readonly flac: boolean;
}

/** The features of the styles: `ssty` by size, and the `text` features `dtls` and `flac`. */
export function mathFeatures(styles: StyleChain): MathFeatures {
  let dtls = false;
  let flac = false;
  for (let link: StyleChain | null = styles; link; link = link.tail) {
    for (const p of link.head) {
      if (p.elem === 'text' && p.field === 'features') {
        if (p.value === 'dtls') dtls = true;
        if (p.value === 'flac') flac = true;
      }
    }
  }
  const size = equationSize(styles);
  return { ssty: size === MathSize.Script ? 1 : size === MathSize.ScriptScript ? 2 : 0, dtls, flac };
}

/**
 * Calls `retry` with the feature sets that turn `flac` and `ssty` off in
 * turn, until it returns true, like `feat_fallback`.
 */
function featFallback(features: MathFeatures, retry: (features: MathFeatures) => boolean): void {
  const options: [boolean, 0 | 1 | 2][] = [
    [true, 2],
    [true, 1],
    [true, 0],
    [false, 2],
    [false, 1],
    [false, 0],
  ];
  for (const [flac, ssty] of options) {
    if ((flac && !features.flac) || ssty > features.ssty) continue;
    if (flac === features.flac && ssty === features.ssty) continue;
    if (retry({ ssty, dtls: features.dtls, flac })) break;
  }
}

/** Shapes a grapheme cluster in the math font, or refuses text the font lacks. */
function shape(text: string, features: MathFeatures, span: Span, face: FontFace): Glyph[] {
  const ids = shapeMath(text, features.ssty, features.dtls, face);
  if (ids === null || ids.some((id) => !hasGlyph(id, face))) unsupported(span, missingGlyph(text, face));
  return ids.map((id) => ({ id, xAdvance: toEm(advance(id, face)), xOffset: 0, yAdvance: 0, yOffset: 0, range: [0, text.length] }));
}

/** Why Typlet can't draw text: the font lacks it, or Typlet lacks its Bold metrics. */
export function missingGlyph(text: string, face: FontFace): string {
  return face === 'book'
    ? `${JSON.stringify(text)} in HTML output, as New Computer Modern Math has no glyph for it`
    : `bold ${JSON.stringify(text)} in HTML output yet`;
}

/** Applies hidden content and links to a fragment's frame, like `FrameModify`. */
export function modifyFrame(frame: Frame, modifiers: FrameModifiers): void {
  if (modifiers.link !== null) frame.push(ORIGIN, { kind: 'link', dest: modifiers.link, size: { ...frame.size } });
  if (modifiers.hidden) frame.hide();
}

// --- Fragments -----------------------------------------------------------------------

export type MathFragment = GlyphFragment | FrameFragment | SpaceFragment | TagFragment;

/** Horizontal space. */
export class SpaceFragment {
  readonly kind = 'space';

  constructor(readonly amount: Abs) {}

  get size(): Size {
    return { x: this.amount, y: 0 };
  }
  get width(): Abs {
    return this.amount;
  }
  get height(): Abs {
    return 0;
  }
  get ascent(): Abs {
    return 0;
  }
  get descent(): Abs {
    return 0;
  }
  get baseAscent(): Abs {
    return 0;
  }
  get baseDescent(): Abs {
    return 0;
  }
  get class(): MathClass {
    return MathClass.Space;
  }
  get mathSize(): MathSize | null {
    return null;
  }
  get fontSize(): Abs | null {
    return null;
  }
  get italicsCorrection(): Abs {
    return 0;
  }
  get accentAttach(): [Abs, Abs] {
    return [this.amount / 2, this.amount / 2];
  }
  isTextLike(): boolean {
    return false;
  }
  kernAtHeight(): Abs {
    return 0;
  }
  intoFrame(): Frame {
    return Frame.soft(this.size);
  }
}

/**
 * A tag, like `MathFragment::Tag`: it draws nothing and has no size, but it
 * counts as a fragment, so a hidden base of three becomes a frame of its own.
 */
export class TagFragment {
  readonly kind = 'tag';

  get size(): Size {
    return { x: 0, y: 0 };
  }
  get width(): Abs {
    return 0;
  }
  get height(): Abs {
    return 0;
  }
  get ascent(): Abs {
    return 0;
  }
  get descent(): Abs {
    return 0;
  }
  get baseAscent(): Abs {
    return 0;
  }
  get baseDescent(): Abs {
    return 0;
  }
  get class(): MathClass {
    return MathClass.Special;
  }
  get mathSize(): MathSize | null {
    return null;
  }
  get fontSize(): Abs | null {
    return null;
  }
  get italicsCorrection(): Abs {
    return 0;
  }
  get accentAttach(): [Abs, Abs] {
    return [0, 0];
  }
  isTextLike(): boolean {
    return false;
  }
  kernAtHeight(): Abs {
    return 0;
  }
  intoFrame(): Frame {
    return Frame.soft(this.size);
  }
}

/** A laid-out frame with the math properties it came from. */
export class FrameFragment {
  readonly kind = 'frame';
  readonly fontSize: Abs;
  readonly class: MathClass;
  readonly mathSize: MathSize;
  baseAscent: Abs;
  baseDescent: Abs;
  italicsCorrection: Abs = 0;
  accentAttach: [Abs, Abs];
  textLike = false;

  constructor(
    props: MathProperties,
    styles: StyleChain,
    readonly frame: Frame,
  ) {
    this.baseAscent = frame.ascent;
    this.baseDescent = frame.descent;
    const attach = frame.width / 2;
    this.accentAttach = [attach, attach];
    this.fontSize = fontSize(styles);
    this.class = props.class ?? MathClass.Normal;
    this.mathSize = props.size;
    modifyFrame(frame, frameModifiers(styles));
  }

  withBaseAscent(baseAscent: Abs): this {
    this.baseAscent = baseAscent;
    return this;
  }
  withBaseDescent(baseDescent: Abs): this {
    this.baseDescent = baseDescent;
    return this;
  }
  withItalicsCorrection(italics: Abs): this {
    this.italicsCorrection = italics;
    return this;
  }
  withAccentAttach(attach: [Abs, Abs]): this {
    this.accentAttach = attach;
    return this;
  }
  withTextLike(textLike: boolean): this {
    this.textLike = textLike;
    return this;
  }

  get size(): Size {
    return this.frame.size;
  }
  get width(): Abs {
    return this.frame.width;
  }
  get height(): Abs {
    return this.frame.height;
  }
  get ascent(): Abs {
    return this.frame.ascent;
  }
  get descent(): Abs {
    return this.frame.descent;
  }
  isTextLike(): boolean {
    return this.textLike;
  }
  kernAtHeight(): Abs {
    return 0;
  }
  intoFrame(): Frame {
    return this.frame;
  }
}

/** Where a glyph needs stretching, and how, like `Action`. */
type Action =
  | { readonly kind: 'keep' }
  | { readonly kind: 'stretch'; readonly axis: Axis; readonly target: Abs; readonly shortFall: Abs }
  | { readonly kind: 'warn-both-axes' }
  | { readonly kind: 'fallback' };

/** A single glyph, or an assembly of glyph parts. */
export class GlyphFragment {
  readonly kind = 'glyph';
  size: Size = { x: 0, y: 0 };
  private baselineValue: Abs | null = null;
  italicsCorrection: Abs = 0;
  accentAttach: [Abs, Abs] = [0, 0];
  extendedShape = false;
  private align: Abs = 0;
  class: MathClass;

  private constructor(
    readonly item: TextItem,
    readonly mathSize: MathSize,
    cls: MathClass,
    readonly span: Span,
    private readonly modifiers: FrameModifiers,
    /** How far down the text's baseline shifts the glyph, without moving its frame. */
    private readonly shift: Abs,
  ) {
    this.class = cls;
    this.updateGlyph();
  }

  /** A glyph for a character, outside the IR, like `GlyphFragment::synthetic`. */
  static synthetic(styles: StyleChain, c: string, span: Span): GlyphFragment {
    const cls = defaultMathClass(c.codePointAt(0)!) ?? MathClass.Normal;
    return GlyphFragment.base(styles, mathFeatures(styles), c, cls, equationSize(styles), span);
  }

  /** A glyph for text, stretched as the stretch info asks, like `GlyphFragment::new`. */
  static create(
    text: string,
    stretch: Stretch,
    styles: StyleChain,
    props: MathProperties,
    cls: MathClass,
    warn: (message: string) => void,
  ): GlyphFragment {
    const span = props.span;
    const features = mathFeatures(styles);
    const shaped = (f: MathFeatures) => GlyphFragment.base(styles, f, text, cls, props.size, span);
    let glyph = shaped(features);
    let action = decide(glyph, stretch);
    // If the glyph isn't sufficient, retry shaping without `ssty` and `flac`
    // until one satisfies the stretch request; else keep the original.
    if (action.kind === 'fallback') {
      featFallback(features, (f) => {
        const next = shaped(f);
        const nextAction = decide(next, stretch);
        if (nextAction.kind === 'fallback') return false;
        glyph = next;
        action = nextAction;
        return true;
      });
    }
    if (action.kind === 'stretch') {
      glyph.stretch(action.target, action.shortFall, action.axis, warn);
      if (action.axis === 'vertical') glyph.centerOnAxis();
    } else if (action.kind === 'warn-both-axes') {
      warn('glyph has both vertical and horizontal constructions');
    }
    return glyph;
  }

  private static base(
    styles: StyleChain,
    features: MathFeatures,
    text: string,
    cls: MathClass,
    mathSize: MathSize,
    span: Span,
  ): GlyphFragment {
    const face = fontFace(styles, span);
    const item: TextItem = { font: face, size: fontSize(styles), fill: textFill(styles), text, glyphs: shape(text, features, span, face) };
    return new GlyphFragment(item, mathSize, cls, span, frameModifiers(styles), textShift(styles));
  }

  /** Sets the metrics after the glyph changed, like `update_glyph`. */
  private updateGlyph(): void {
    const first = this.item.glyphs[0]!;
    const id = first.id;
    const face = this.item.font;
    const extendedShape = isExtendedShape(id, face);
    const italics = toEm(italicCorrection(id, face) ?? 0);
    const width = textWidth(this.item);
    if (!extendedShape) first.xAdvance += italics;
    const italicsAbs = emAt(italics, this.item.size);

    const [ascent, descent] = ascentDescent(id, face) ?? [0, 0];

    // The fallback for accents is half the width plus or minus the italic
    // correction, like for top and bottom attachments.
    const accent = topAccentAttachment(id, face);
    const top = accent !== undefined ? emAt(toEm(accent), this.item.size) : (width + italicsAbs) / 2;
    const bottom = (width - italicsAbs) / 2;

    this.baselineValue = emAt(ascent, this.item.size);
    this.size = { x: textWidth(this.item), y: emAt(ascent, this.item.size) + emAt(descent, this.item.size) };
    this.italicsCorrection = italicsAbs;
    this.accentAttach = [top, bottom];
    this.extendedShape = extendedShape;
  }

  get baseline(): Abs {
    return this.ascent;
  }
  /** The distance from the baseline to the top of the frame. */
  get ascent(): Abs {
    return this.baselineValue ?? this.size.y;
  }
  /** The distance from the baseline to the bottom of the frame. */
  get descent(): Abs {
    return this.size.y - this.ascent;
  }
  get width(): Abs {
    return this.size.x;
  }
  get height(): Abs {
    return this.size.y;
  }
  get baseAscent(): Abs {
    return this.ascent;
  }
  get baseDescent(): Abs {
    return this.descent;
  }
  get fontSize(): Abs {
    return this.item.size;
  }
  isTextLike(): boolean {
    return !this.extendedShape;
  }

  /** The math kern at a corner and height; zero without a kern table. */
  kernAtHeight(corner: Corner, height: Abs): Abs {
    // For glyph assemblies, the start or end glyph, depending on the corner.
    const glyphs = this.item.glyphs;
    const vertical = glyphs.every((g) => g.yAdvance !== 0);
    const index =
      (vertical && (corner === 'topLeft' || corner === 'topRight')) ||
      (!vertical && (corner === 'topRight' || corner === 'bottomRight'))
        ? glyphs.length - 1
        : 0;
    const em = kernAtHeight(glyphs[index]!.id, corner, emFromAbs(height, this.item.size), this.item.font);
    return emAt(em ?? 0, this.item.size);
  }

  intoFrame(): Frame {
    const frame = Frame.soft(this.size);
    frame.setBaseline(this.baseline);
    frame.push(point(0, this.ascent + this.shift + this.align), { kind: 'text', text: this.item });
    modifyFrame(frame, this.modifiers);
    return frame;
  }

  /** Stretches the glyph to a size along an axis, if it can, like `stretch`. */
  stretch(target: Abs, shortFall: Abs, axis: Axis, warn: (message: string) => void): void {
    // If the base glyph is good enough, use it.
    const adv = this.stretchAdvance(axis);
    const shortTarget = target - shortFall;
    if (shortTarget <= adv) return;

    const id = this.item.glyphs[0]!.id;
    const face = this.item.font;
    const construction = glyphConstruction(id, axis, face);
    if (!construction) return;
    // Typlet has the Bold face's metrics for unstretched glyphs only.
    const glyphs = [...construction.variants.map((v) => v.glyph), ...(construction.assembly?.parts.map((p) => p.glyph) ?? [])];
    if (glyphs.some((glyph) => !hasGlyph(glyph, face))) unsupported(this.span, `stretched ${missingGlyph(this.item.text, face)}`);

    // Search for a pre-made variant with a good advance.
    let bestId = id;
    let bestAdvance = adv;
    for (const variant of construction.variants) {
      bestId = variant.glyph;
      bestAdvance = emAt(toEm(variant.advance), this.item.size);
      if (shortTarget <= bestAdvance) break;
    }

    // This is either good or the best we've got.
    if (shortTarget <= bestAdvance || !construction.assembly) {
      this.item.glyphs = [
        { id: bestId, xAdvance: toEm(advance(bestId, face)), xOffset: 0, yAdvance: 0, yOffset: 0, range: this.item.glyphs[0]!.range },
      ];
      this.updateGlyph();
      return;
    }

    // Assemble from parts.
    const minOverlap = emAt(toEm(MIN_CONNECTOR_OVERLAP ?? 0), this.item.size);
    assemble(this, construction.assembly, minOverlap, target, axis, warn);
  }

  /** The advance along an axis that stretching compares, like `stretch_advance`. */
  stretchAdvance(axis: Axis): Abs {
    let adv = axis === 'horizontal' ? this.size.x : this.size.y;
    // The italic correction was added to the width in `updateGlyph`.
    if (axis === 'horizontal' && !this.extendedShape) adv -= this.italicsCorrection;
    return adv;
  }

  /** Centers the glyph vertically on the math axis. */
  centerOnAxis(): void {
    const h = this.size.y;
    const axis = emAt(MATH_CONSTANTS.axisHeight, this.item.size);
    this.align += this.baseline;
    this.baselineValue = (h + axis * 2) / 2;
    this.align -= this.baseline;
  }

  /** Sets the assembled glyphs and metrics, for `assemble`. */
  setAssembly(glyphs: Glyph[], size: Size, baseline: Abs | null, italics: Abs, accentAttach: [Abs, Abs] | null): void {
    this.item.glyphs = glyphs;
    this.size = size;
    this.baselineValue = baseline;
    this.italicsCorrection = italics;
    if (accentAttach) this.accentAttach = accentAttach;
    this.extendedShape = true;
  }
}

/** Ems from an absolute length at a font size, like `Em::from_abs`. */
export function emFromAbs(length: Abs, fontSize: Abs): Em {
  const result = length / fontSize;
  return Number.isFinite(result) ? result : 0;
}

/** The ascent and descent of a glyph's bounding box, in ems. */
function ascentDescent(id: number, face: FontFace): [Em, Em] | null {
  const box = boundingBox(id, face);
  return box ? [toEm(box.yMax), -toEm(box.yMin)] : null;
}

/** A math kern at a corner and height, in ems, like `kern_at_height`. */
export function kernAtHeight(id: number, corner: Corner, height: Em, face: FontFace = 'book'): Em | null {
  const kern = kernInfo(id, face)?.[corner];
  if (!kern) return null;
  let i = 0;
  while (i < kern.heights.length && height > toEm(kern.heights[i]!)) i++;
  const value = kern.kerns[i];
  return value === undefined ? null : toEm(value);
}

/** How the glyph needs stretching, like `decide`. */
function decide(glyph: GlyphFragment, stretch: Stretch): Action {
  const id = glyph.item.glyphs[0]!.id;
  const face = glyph.item.font;
  const stretchable = (axis: Axis) => glyphConstruction(id, axis, face) !== undefined;

  const assess = (axis: Axis): Action | 'sufficient' => {
    const resolved = resolveStretch(glyph, stretch, axis);
    if (!resolved) return 'sufficient';
    const [target, shortFall] = resolved;
    if (stretchable(axis)) return { kind: 'stretch', axis, target, shortFall };
    // The glyph isn't stretchable on this axis, but might be wide enough.
    let adv = glyph.stretchAdvance(axis);
    // Combining marks typically have zero advance, so use their bounds.
    const box = boundingBox(id, face);
    if (box) {
      const extent = axis === 'horizontal' ? toEm(box.xMax - box.xMin) : toEm(box.yMax - box.yMin);
      adv = Math.max(adv, emAt(extent, glyph.item.size));
    }
    return target - shortFall <= adv ? 'sufficient' : { kind: 'fallback' };
  };

  const x = assess('horizontal');
  const y = assess('vertical');
  if (x !== 'sufficient' && x.kind === 'stretch' && y !== 'sufficient' && y.kind === 'stretch') {
    return { kind: 'warn-both-axes' };
  }
  if (x !== 'sufficient' && x.kind === 'stretch') return x;
  if (y !== 'sufficient' && y.kind === 'stretch') return y;
  if (x === 'sufficient' && y === 'sufficient') return { kind: 'keep' };
  return { kind: 'fallback' };
}

/** The absolute target and short fall of a stretch along an axis, like `resolve_stretch`. */
function resolveStretch(glyph: GlyphFragment, stretch: Stretch, axis: Axis): [Abs, Abs] | null {
  const info = stretchResolve(stretch, axis === 'horizontal' ? 'x' : 'y');
  if (!info) return null;
  let relativeTo = info.relativeTo;
  if (relativeTo === null) {
    relativeTo =
      axis === 'vertical' && glyph.class === MathClass.Large && glyph.mathSize === MathSize.Display
        ? emAt(MATH_CONSTANTS.displayOperatorMinHeight, glyph.item.size)
        : axis === 'horizontal'
          ? glyph.size.x
          : glyph.size.y;
  }
  const target = relRelativeTo(info.target, relativeTo);
  const shortFall = emAt(info.shortFall, info.fontSize ?? glyph.item.size);
  return [target, shortFall];
}

/** The parts of an assembly, with extenders repeated, like `parts`. */
function* parts(assembly: NonNullable<ReturnType<typeof glyphConstruction>>['assembly'], repeat: number) {
  for (const part of assembly!.parts) {
    const count = part.extender ? repeat : 1;
    for (let i = 0; i < count; i++) yield part;
  }
}

/** Assembles a glyph from parts, like `assemble`. */
function assemble(
  base: GlyphFragment,
  assembly: NonNullable<NonNullable<ReturnType<typeof glyphConstruction>>['assembly']>,
  minOverlap: Abs,
  target: Abs,
  axis: Axis,
  warn: (message: string) => void,
): void {
  const size = base.item.size;
  const at = (units: number) => emAt(toEm(units), size);

  // The number of times the extenders repeat, and how far to spread the
  // parts (0 = maximal overlap, 1 = minimal overlap).
  let full = 0;
  let ratio = 0;
  let repeat = 0;
  for (;;) {
    full = 0;
    ratio = 0;
    const list = [...parts(assembly, repeat)];
    let growable = 0;
    list.forEach((part, i) => {
      let adv = at(part.fullAdvance);
      const next = list[i + 1];
      if (next) {
        const maxOverlap = at(Math.min(part.endConnector, next.startConnector));
        if (maxOverlap < minOverlap) {
          warn('glyph has assembly parts with overlap less than minConnectorOverlap');
        }
        adv -= maxOverlap;
        growable += Math.max(maxOverlap - minOverlap, 0);
      }
      full += adv;
    });
    if (full < target) {
      const delta = target - full;
      ratio = Math.min(delta / growable, 1);
      full += ratio * growable;
    }
    if (target <= full || repeat >= MAX_REPEATS) break;
    repeat++;
  }

  const glyphs: Glyph[] = [];
  const range = base.item.glyphs[0]!.range;
  const list = [...parts(assembly, repeat)];
  list.forEach((part, i) => {
    let adv = at(part.fullAdvance);
    const next = list[i + 1];
    if (next) {
      const maxOverlap = at(Math.min(part.endConnector, next.startConnector));
      adv -= maxOverlap;
      adv += ratio * (maxOverlap - minOverlap);
    }
    // Vertical parts are aligned at their bounding box's bottom, so that
    // they combine whatever the font's origin.
    glyphs.push(
      axis === 'horizontal'
        ? { id: part.glyph, xAdvance: emFromAbs(adv, size), xOffset: 0, yAdvance: 0, yOffset: 0, range }
        : {
            id: part.glyph,
            xAdvance: 0,
            xOffset: 0,
            yAdvance: emFromAbs(adv, size),
            yOffset: ascentDescent(part.glyph, base.item.font)?.[1] ?? 0,
            range,
          },
    );
  });

  const italics = emAt(toEm(assembly.italic), size);
  if (axis === 'horizontal') {
    let ascent = 0;
    let descent = 0;
    let any = false;
    for (const glyph of glyphs) {
      const ad = ascentDescent(glyph.id, base.item.font);
      if (!ad) continue;
      ascent = any ? Math.max(ascent, ad[0]) : ad[0];
      descent = any ? Math.max(descent, ad[1]) : ad[1];
      any = true;
    }
    base.setAssembly(glyphs, { x: full, y: emAt(ascent + descent, size) }, emAt(ascent, size), italics, [full / 2, full / 2]);
  } else {
    let width: Em = 0;
    glyphs.forEach((glyph, i) => {
      const adv = toEm(advance(glyph.id, base.item.font));
      width = i === 0 ? adv : Math.max(width, adv);
    });
    base.setAssembly(glyphs, { x: emAt(width, size), y: full }, null, italics, null);
  }
}
