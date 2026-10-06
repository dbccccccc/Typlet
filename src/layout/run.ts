// Ported from Typst 0.15.1: crates/typst-layout/src/math/run.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import type { Abs, Em, FixedAlignment } from '../eval/layout.js';
import { emAt } from '../eval/layout.js';
import { type StyleChain, get } from '../eval/styles.js';
import { type LeftRightAlternator, alternatorNext } from '../elements/mod.js';
import { MathSize, equationSize } from '../elements/style.js';
import { type MathItem, asSlice } from '../ir/item.js';
import type { AlignedRow } from '../ir/multiline.js';
import { fontSize } from '../ir/resolve.js';
import { MathClass } from '../utils/math-class.js';
import { type MathFragment, SpaceFragment } from './fragment.js';
import { Frame, type Point, type Size, alignPosition, point } from './frame.js';
import type { MathContext } from './math.js';

/** Leading between rows in script and scriptscript size. */
const TIGHT_LEADING: Em = 0.25;

/** Typst's default paragraph leading. */
export const LEADING: Em = 0.65;

/** Fragments between alignment points and line breaks, like Typst's `MathRun`. */
export type MathRun = MathFragment[];

const runWidth = (run: MathRun): Abs => run.reduce((sum, f) => sum + f.width, 0);

/** Rows of frames and where they go, like `MathRunFrameBuilder`. */
export class MathRunFrameBuilder {
  constructor(
    public size: Size = { x: 0, y: 0 },
    public frames: [Frame, Point][] = [],
  ) {}

  static fromFrame(frame: Frame): MathRunFrameBuilder {
    return new MathRunFrameBuilder({ x: frame.width, y: frame.height }, [[frame, point(0, 0)]]);
  }

  private build(setBaseline: boolean): Frame {
    const frame = Frame.soft(this.size);
    for (const [sub, pos] of this.frames) {
      if (setBaseline && sub.hasBaseline()) frame.setBaseline(sub.baseline);
      frame.pushFrame(pos, sub);
      setBaseline = false;
    }
    return frame;
  }

  /** The frame, with the first row's baseline. */
  buildAligned(): Frame {
    return this.build(true);
  }

  /** The frame, without a baseline, which must be set later. */
  buildUnaligned(): Frame {
    return this.build(false);
  }
}

/** Lays out a multiline item, like `layout_multiline`. */
export function layoutMultiline(rows: AlignedRow[], ctx: MathContext, styles: StyleChain): MathRunFrameBuilder {
  const nrows = rows.length;
  const ncols = rows[0]?.length ?? 0;
  if (nrows === 0 || ncols === 0) return new MathRunFrameBuilder();

  const colWidths: Abs[] = Array(ncols).fill(0);
  const laidOut: MathRun[][] = [];
  for (const row of rows) {
    const cells = layoutAlignedRow(row, ctx, styles);
    cells.forEach((cell, c) => {
      colWidths[c] = Math.max(colWidths[c]!, runWidth(cell));
    });
    laidOut.push(cells);
  }

  const leading = emAt(equationSize(styles) >= MathSize.Text ? LEADING : TIGHT_LEADING, fontSize(styles));
  // Rows align as the text around them: a block equation's show rule
  // centers them, and equations in its boxes inherit that.
  const align = get<FixedAlignment>(styles, 'align', 'alignment', 'start');
  return stackRows(
    laidOut.map((cells) => ({ cells, frameHeight: measureRow(cells), rowHeight: null })),
    colWidths,
    'right',
    align,
    leading,
    0,
  );
}

/** Lays out the cells of a row, like `layout_aligned_row`. */
export function layoutAlignedRow(row: AlignedRow, ctx: MathContext, styles: StyleChain): MathRun[] {
  return row.map((item, c) => {
    const frags = ctx.layoutIntoFragments(item, styles);
    // For a (right-aligned, left-aligned) pair, move the lspace of the item
    // in the left-aligned column to the right-aligned column.
    const next = row[c + 1];
    if (c % 2 === 0 && next) {
      const spacing = alignmentLspace(next);
      if (spacing !== null) frags.push(new SpaceFragment(spacing));
    }
    return frags;
  });
}

/** A row of multiline math: its cells and their heights, like `RowLayout`. */
export interface RowLayout {
  readonly cells: MathRun[];
  /** The ascent and descent the row's frame should have. */
  readonly frameHeight: [Abs, Abs];
  /** The ascent and descent to stack the row with, if not the frame's. */
  readonly rowHeight: [Abs, Abs] | null;
}

/** Builds and stacks line frames for rows with aligned columns, like `stack_rows`. */
export function stackRows(
  rows: RowLayout[],
  widths: Abs[],
  alternator: LeftRightAlternator,
  align: FixedAlignment,
  leading: Abs,
  startY: Abs,
): MathRunFrameBuilder {
  const [points, totalWidth] = cumulativeAlignmentPoints(widths);
  const hasAlignment = points.length > 0;

  const frames: [Frame, Point][] = [];
  const size: Size = { x: 0, y: startY };
  rows.forEach((row, i) => {
    const sub = rowIntoLineFrame(row.cells, points, alternator, row.frameHeight);
    const [ascent, descent] = row.rowHeight ?? row.frameHeight;
    if (i > 0) size.y += leading;
    const pos = point(hasAlignment ? 0 : alignPosition(align, totalWidth - sub.width), size.y + ascent - sub.ascent);
    size.x = Math.max(size.x, sub.width);
    size.y += ascent + descent;
    frames.push([sub, pos]);
  });
  return new MathRunFrameBuilder(size, frames);
}

/** The ascent and descent of a row, like `measure_row`. */
export function measureRow(cells: MathRun[]): [Abs, Abs] {
  let result: [Abs, Abs] | null = null;
  for (const cell of cells) {
    for (const f of cell) {
      if (f.kind === 'tag') continue;
      result = result ? [Math.max(result[0], f.ascent), Math.max(result[1], f.descent)] : [f.ascent, f.descent];
    }
  }
  return result ?? [0, 0];
}

/** A run as one frame, like `MathFragmentsExt::into_frame`. */
export function runIntoFrame(run: MathRun): Frame {
  return rowIntoLineFrame([run], [], 'right', null);
}

/** An item of a paragraph: a frame, or a space where a line can break. */
export type InlineItem = { readonly kind: 'frame'; readonly frame: Frame } | { readonly kind: 'space'; readonly width: Abs };

/**
 * A run as items of a paragraph, split after binary operators and
 * relations, where lines can break, like `into_par_items`.
 */
export function runIntoParItems(run: MathRun): InlineItem[] {
  const items: InlineItem[] = [];
  let x = 0;
  let ascent = 0;
  let descent = 0;
  let frame = Frame.soft({ x: 0, y: 0 });
  let empty = true;
  let spaceIsVisible = false;

  const finalize = (f: Frame, width: Abs, a: Abs, d: Abs) => {
    f.size = { x: width, y: a + d };
    f.setBaseline(0);
    f.translate(point(0, a));
  };
  const breaksAfter = (cls: MathClass, next: MathClass | undefined) =>
    cls === MathClass.Binary
      ? next !== MathClass.Closing
      : cls === MathClass.Relation && next !== MathClass.Relation && next !== MathClass.Closing;
  // The spaces are weak: where they meet, the paragraph keeps the widest.
  const pushSpace = (width: Abs) => {
    const last = items.at(-1);
    if (last?.kind === 'space') items[items.length - 1] = { kind: 'space', width: Math.max(last.width, width) };
    else items.push({ kind: 'space', width });
  };

  run.forEach((fragment, i) => {
    if (spaceIsVisible && fragment.kind === 'space') {
      pushSpace(fragment.width);
      return;
    }
    const cls = fragment.class;
    const y = fragment.ascent;
    ascent = Math.max(ascent, y);
    descent = Math.max(descent, fragment.descent);
    const pos = point(x, -y);
    x += fragment.width;
    frame.pushFrame(pos, fragment.intoFrame());
    empty = false;

    // Split the frame after binary operators and relations, so lines can
    // break there.
    const next = run[i + 1];
    if (breaksAfter(cls, next?.class)) {
      finalize(frame, x, ascent, descent);
      items.push({ kind: 'frame', frame });
      frame = Frame.soft({ x: 0, y: 0 });
      empty = true;
      x = 0;
      ascent = 0;
      descent = 0;
      spaceIsVisible = true;
      if (next && next.kind !== 'space') pushSpace(0);
    } else {
      spaceIsVisible = false;
    }
  });

  if (!empty) {
    finalize(frame, x, ascent, descent);
    items.push({ kind: 'frame', frame });
  }
  return items;
}

/** Builds a frame from a row's cells at alignment points, like `row_into_line_frame`. */
function rowIntoLineFrame(
  cells: MathRun[],
  points: Abs[],
  alternator: LeftRightAlternator,
  height: [Abs, Abs] | null,
): Frame {
  const [ascent, descent] = height ?? measureRow(cells);
  const frame = Frame.soft({ x: 0, y: ascent + descent });
  frame.setBaseline(ascent);

  let prevPoint = 0;
  let pointIndex = 0;
  let alt = alternator;
  let xEnd = 0;
  for (const cell of cells) {
    const width = runWidth(cell);
    let cellX = prevPoint;
    const p = points[pointIndex++];
    if (p !== undefined) {
      const side = alt;
      alt = alternatorNext(alt);
      cellX = side === 'right' ? p - width : prevPoint;
      prevPoint = p;
    }
    let x = cellX;
    for (const frag of cell) {
      const y = ascent - frag.ascent;
      const w = frag.width;
      frame.pushFrame(point(x, y), frag.intoFrame());
      x += w;
    }
    xEnd = x;
  }
  frame.size.x = xEnd;
  return frame;
}

/** The alignment points of columns with these widths, like `cumulative_alignment_points`. */
function cumulativeAlignmentPoints(widths: Abs[]): [Abs[], Abs] {
  if (widths.length <= 1) return [[], widths[0] ?? 0];
  const points: Abs[] = [];
  let cumulative = 0;
  for (const w of widths) {
    cumulative += w;
    points.push(cumulative);
  }
  return [points, cumulative];
}

/** The lspace of a cell's first item, if its alignment form is infix, like `alignment_lspace`. */
function alignmentLspace(cell: MathItem): Abs | null {
  const first = asSlice(cell).find((item) => item.type !== 'tag');
  if (first?.type !== 'component' || !first.props.alignFormInfix || first.props.lspace === null) return null;
  return emAt(first.props.lspace, fontSize(first.styles));
}
