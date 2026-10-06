// Ported from Typst 0.15.1: crates/typst-layout/src/math/mod.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// Math layout: turns the math IR into frames, as Typst lays out equations
// for its paged export. Typlet lays out with New Computer Modern Math only;
// content that isn't math, such as a displayed value, is refused.

import type { Content, EquationElem } from '../eval/content.js';
import { type SourceDiagnostic, type Span, unsupported, warning } from '../eval/diag.js';
import { type Abs, type Alignment, type FixedAlignment, emAt, lengthAt } from '../eval/layout.js';
import { type StyleChain, type Styles, get } from '../eval/styles.js';
import { type MathItem, asSlice, isMultiline, properties } from '../ir/item.js';
import { equationStyles, fontSize, resolveEquation } from '../ir/resolve.js';
import { layoutAccent } from './accent.js';
import { layoutCancel } from './cancel.js';
import { layoutFenced } from './fenced.js';
import { FONT_METRICS, MATH_CONSTANTS } from './font.js';
import { layoutFraction, layoutSkewedFraction } from './fraction.js';
import { FrameFragment, type MathFragment, SpaceFragment, TagFragment } from './fragment.js';
import { Frame, type Point, type Size, point } from './frame.js';
import { applyShift, layoutBox, layoutParagraph } from './inline.js';
import { layoutLine } from './line.js';
import { layoutRadical } from './radical.js';
import {
  type InlineItem,
  LEADING,
  type MathRun,
  MathRunFrameBuilder,
  layoutMultiline,
  runIntoFrame,
  runIntoParItems,
} from './run.js';
import { layoutPrimes, layoutScripts } from './scripts.js';
import { layoutTable } from './table.js';
import { layoutGlyph, layoutNumber, layoutText } from './text.js';

/** The context of math layout: the fragments laid out so far, like `MathContext`. */
export class MathContext {
  fragments: MathFragment[] = [];

  constructor(
    readonly warnings: SourceDiagnostic[],
    /** The horizontal alignment of rows without alignment points. */
    readonly align: FixedAlignment,
    /** The width of the region the equation is laid out in, which boxes in it get; `null` for no limit. */
    readonly region: Abs | null = null,
  ) {}

  push(fragment: MathFragment): void {
    this.fragments.push(fragment);
  }

  warn(span: Span, message: string): void {
    this.warnings.push(warning(span, message));
  }

  /** Lays out an item into fragments. */
  layoutIntoFragments(item: MathItem, styles: StyleChain): MathRun {
    const start = this.fragments.length;
    this.layoutIntoSelf(item, styles);
    return this.fragments.splice(start);
  }

  /** Lays out an item into a single fragment, framing several. */
  layoutIntoFragment(item: MathItem, styles: StyleChain): MathFragment {
    const fragments = this.layoutIntoFragments(item, styles);
    if (fragments.length === 1) return fragments[0]!;
    // Fragments without a math size don't count: size doesn't apply to them.
    const textLike = fragments.filter((f) => f.mathSize !== null).every((f) => f.isTextLike());
    const itemStyles = item.type === 'component' ? item.styles : styles;
    const props = properties(itemStyles, null, null);
    return new FrameFragment(props, itemStyles, runIntoFrame(fragments)).withTextLike(textLike);
  }

  private layoutIntoSelf(item: MathItem, styles: StyleChain): void {
    const outer = item.type === 'component' ? item.styles : styles;
    for (const child of asSlice(item)) layoutRealized(child, this, child.type === 'component' ? child.styles : outer);
  }
}

/** Lays out a single item, like `layout_realized`. */
function layoutRealized(item: MathItem, ctx: MathContext, styles: StyleChain): void {
  if (item.type === 'spacing') {
    ctx.push(new SpaceFragment(lengthAt(item.amount, item.fontSize)));
    return;
  }
  if (item.type === 'space') {
    ctx.push(new SpaceFragment(emAt(MATH_CONSTANTS.spaceWidth, fontSize(styles))));
    return;
  }
  // A tag draws nothing, but counts as a fragment.
  if (item.type === 'tag') {
    ctx.push(new TagFragment());
    return;
  }

  const props = item.props;
  // Items with an alignment form get their spacing from the multiline
  // layout instead.
  if (props.lspace !== null && !props.alignFormInfix && props.lspace !== 0) {
    ctx.push(new SpaceFragment(emAt(props.lspace, fontSize(styles))));
  }

  const kind = item.kind;
  switch (kind.tag) {
    case 'glyph':
      layoutGlyph(item, kind, ctx, styles, props);
      break;
    case 'text':
      layoutText(kind.text, ctx, styles, props);
      break;
    case 'number':
      layoutNumber(kind.text, ctx, styles, props);
      break;
    case 'scripts':
      layoutScripts(kind, ctx, styles, props);
      break;
    case 'primes':
      layoutPrimes(kind.count, ctx, styles, props);
      break;
    case 'fraction':
      layoutFraction(kind, ctx, styles, props);
      break;
    case 'skewed-fraction':
      layoutSkewedFraction(kind, ctx, styles, props);
      break;
    case 'radical':
      layoutRadical(kind, ctx, styles, props);
      break;
    case 'fenced':
      layoutFenced(kind, ctx, styles);
      break;
    case 'accent':
      layoutAccent(kind, ctx, styles, props);
      break;
    case 'line':
      layoutLine(kind, ctx, styles, props);
      break;
    case 'cancel':
      layoutCancel(kind, ctx, styles, props);
      break;
    case 'table':
      layoutTable(kind, ctx, styles, props);
      break;
    case 'multiline': {
      // The baseline is the first row's, unless the item is centered.
      const frame = layoutMultiline(kind.rows, ctx, styles).buildUnaligned();
      if (kind.centered) frame.setBaseline(frame.height / 2 + emAt(MATH_CONSTANTS.axisHeight, fontSize(styles)));
      ctx.push(new FrameFragment(props, styles, frame));
      break;
    }
    case 'group': {
      const fragment = ctx.layoutIntoFragment(item, styles);
      ctx.push(
        new FrameFragment(props, styles, fragment.intoFrame())
          .withItalicsCorrection(fragment.italicsCorrection)
          .withAccentAttach(fragment.accentAttach),
      );
      break;
    }
    case 'box':
      ctx.push(new FrameFragment(props, styles, layoutBox(kind.elem, styles, ctx.warnings, ctx.region)));
      break;
    case 'external':
      // A smart quote is laid out on its own, so it opens a quote.
      if (kind.content.func !== 'smartquote') unsupported(props.span, `${kind.content.func} in HTML output yet`);
      ctx.push(new FrameFragment(props, styles, layoutParagraph(kind.content, styles, ctx.warnings, null, ctx.region)));
      break;
  }

  if (props.rspace !== null && props.rspace !== 0) {
    ctx.push(new SpaceFragment(emAt(props.rspace, fontSize(styles))));
  }
}

/**
 * Lays out an inline equation into paragraph items, like
 * `layout_equation_inline`. Each frame is at least as tall as the font's
 * cap height, with its baseline at the text's.
 */
export function layoutEquationInline(equation: EquationElem, warnings: SourceDiagnostic[], outer: Styles = []): InlineItem[] {
  const styles = equationStyles(false, outer);
  return layoutInline(resolveEquation(equation.body, styles, warnings), warnings, styles);
}

/**
 * Lays out an inline equation's resolved math IR in the equation's styles,
 * like `layoutEquationInline`, in a region of the given width: a box's, or
 * `null` for no limit.
 */
export function layoutInline(item: MathItem, warnings: SourceDiagnostic[], styles = equationStyles(false), region: Abs | null = null): InlineItem[] {
  const ctx = new MathContext(warnings, 'start', region);
  const items: InlineItem[] = isMultiline(item)
    ? [{ kind: 'frame', frame: ctx.layoutIntoFragment(item, styles).intoFrame() }]
    : runIntoParItems(ctx.layoutIntoFragments(item, styles));

  // An empty equation still has a height.
  if (items.length === 0) items.push({ kind: 'frame', frame: Frame.soft({ x: 0, y: 0 }) });

  const size = fontSize(styles);
  const slack = emAt(LEADING, size) * 0.7;
  const top = emAt(FONT_METRICS.capHeight, size);
  for (const item of items) {
    if (item.kind !== 'frame') continue;
    const frame = item.frame;
    const ascent = Math.max(top, frame.ascent - slack);
    const descent = Math.max(0, frame.descent - slack);
    frame.translate(point(0, ascent - frame.baseline));
    frame.size.y = ascent + descent;
    // The paragraph around the equation shifts its frames by the text's
    // baseline shift. Its show rule leaves the shift as it is around it.
    applyShift(frame, styles);
  }
  return items;
}

/** Lays out a block equation into one frame, with its number if it has one, like `layout_equation_block`. */
export function layoutEquationBlock(
  equation: EquationElem,
  warnings: SourceDiagnostic[],
  outer: Styles = [],
  number: Content | null = null,
): Frame {
  const styles = equationStyles(true, outer);
  return layoutBlock(resolveEquation(equation.body, styles, warnings), warnings, styles, number);
}

/** Lays out a block equation's resolved math IR in the equation's styles, like `layoutEquationBlock`. */
export function layoutBlock(
  item: MathItem,
  warnings: SourceDiagnostic[],
  styles = equationStyles(true),
  number: Content | null = null,
): Frame {
  const builder = blockBuilder(item, warnings, styles);
  if (number === null) return builder.buildAligned();
  // Without a page width, the equation gets the number's width on both sides.
  const numberFrame = layoutParagraph(number, styles, warnings);
  const fullNumberWidth = numberFrame.width + emAt(NUMBER_GUTTER, fontSize(styles));
  return addEquationNumber(builder, numberFrame, numberAlign(styles), 'center', Infinity, fullNumberWidth);
}

/** The rows of a block equation, laid out centered. */
function blockBuilder(item: MathItem, warnings: SourceDiagnostic[], styles: StyleChain): MathRunFrameBuilder {
  const ctx = new MathContext(warnings, 'center');
  return item.type === 'component' && item.kind.tag === 'multiline'
    ? layoutMultiline(item.kind.rows, ctx, item.styles)
    : MathRunFrameBuilder.fromFrame(runIntoFrame(ctx.layoutIntoFragments(item, styles)));
}

/** A numbered block equation in parts, for HTML that places the number at the edge of the page. */
export interface NumberedBlock {
  readonly equation: Frame;
  readonly number: Frame;
  /** The top of the number, relative to the top of the equation. */
  readonly numberTop: Abs;
  /** The side the number is on. */
  readonly side: 'start' | 'end';
  /** The number's width with the gap to the equation. */
  readonly numberWidth: Abs;
}

/** Lays out a numbered block equation in parts, placed as `add_equation_number` places them. */
export function layoutNumberedBlock(
  item: MathItem,
  warnings: SourceDiagnostic[],
  styles: StyleChain,
  number: Content,
): NumberedBlock {
  const builder = blockBuilder(item, warnings, styles);
  const numberFrame = layoutParagraph(number, styles, warnings);
  const align = numberAlign(styles);
  const rows = builder.frames;
  const isMultiline = rows.length >= 2;
  const row = rows[align.y === 'end' ? rows.length - 1 : 0];
  const equation = builder.buildAligned();
  const numberTop =
    align.y === 'center' && isMultiline
      ? (equation.height - numberFrame.height) / 2
      : row
        ? row[1].y + row[0].baseline - numberFrame.baseline
        : -numberFrame.baseline;
  return {
    equation,
    number: numberFrame,
    numberTop,
    side: align.x,
    numberWidth: numberFrame.width + emAt(NUMBER_GUTTER, fontSize(styles)),
  };
}

/** The gap between an equation and its number. */
const NUMBER_GUTTER = 0.5;

/** Where an equation's number goes, resolved for left-to-right text, like `number_align`. */
export function numberAlign(styles: StyleChain): { x: 'start' | 'end'; y: FixedAlignment } {
  const align = get<Alignment>(styles, 'equation', 'number-align', { x: 'end', y: 'horizon' });
  const x = align.x ?? 'end';
  const y = align.y ?? 'horizon';
  return {
    x: x === 'start' || x === 'left' ? 'start' : 'end',
    y: y === 'top' ? 'start' : y === 'horizon' ? 'center' : 'end',
  };
}

/** A row of an equation: its size, position and baseline. */
type Row = { readonly size: Size; readonly pos: Point; readonly baseline: Abs };

/** Places an equation's number beside it, like `add_equation_number`. */
function addEquationNumber(
  builder: MathRunFrameBuilder,
  number: Frame,
  align: { x: 'start' | 'end'; y: FixedAlignment },
  equationAlign: FixedAlignment,
  regionWidth: Abs,
  fullNumberWidth: Abs,
): Frame {
  const row = (entry: [Frame, Point] | undefined): Row =>
    entry ? { size: { ...entry[0].size }, pos: entry[1], baseline: entry[0].baseline } : { size: builder.size, pos: point(0, 0), baseline: 0 };
  const first = row(builder.frames[0]);
  const last = row(builder.frames.at(-1));
  const isMultiline = builder.frames.length >= 2;
  const equation = builder.buildAligned();

  const width = Number.isFinite(regionWidth) ? regionWidth : equation.width + 2 * fullNumberWidth;
  const offset = resizeEquation(equation, number, align, equationAlign, width, isMultiline, first, last);
  equation.translate(
    point(equationAlign === 'start' && align.x === 'start' ? fullNumberWidth : equationAlign === 'end' && align.x === 'end' ? -fullNumberWidth : 0, 0),
  );

  const x = align.x === 'start' ? 0 : equation.width - number.width;
  const alignBaselines = (r: Row) => offset.y + r.pos.y + r.baseline - number.baseline;
  const y =
    align.y === 'start' || (align.y === 'center' && !isMultiline)
      ? alignBaselines(first)
      : align.y === 'center'
        ? (equation.height - number.height) / 2
        : alignBaselines(last);
  equation.pushFrame(point(x, y), number);
  return equation;
}

/** Resizes the equation's frame to hold the number, like `resize_equation`. */
function resizeEquation(
  equation: Frame,
  number: Frame,
  align: { x: 'start' | 'end'; y: FixedAlignment },
  equationAlign: FixedAlignment,
  width: Abs,
  isMultiline: boolean,
  first: Row,
  last: Row,
): Point {
  // The centers of a multiline equation and its number line up.
  if (align.y === 'center' && isMultiline) {
    return equation.resize({ x: width, y: Math.max(equation.height, number.height) }, equationAlign, 'center');
  }
  const excessAbove = Math.max(0, !isMultiline || align.y === 'start' ? number.baseline - first.baseline : 0);
  const excessBelow = Math.max(
    0,
    !isMultiline || align.y === 'end' ? number.height - number.baseline - (last.size.y - last.baseline) : 0,
  );
  const offset = equation.resize({ x: width, y: equation.height + excessAbove + excessBelow }, equationAlign, 'start');
  equation.translate(point(0, excessAbove));
  return point(offset.x, offset.y + excessAbove);
}

