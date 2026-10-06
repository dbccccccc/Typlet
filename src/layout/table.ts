// Ported from Typst 0.15.1: crates/typst-layout/src/math/table.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import type { Abs, Em, Rel } from '../eval/layout.js';
import { emAt, lengthAt } from '../eval/layout.js';
import { type StyleChain, chain } from '../eval/styles.js';
import { styleForDenominator } from '../elements/style.js';
import type { MathKind, MathProperties } from '../ir/item.js';
import type { AlignedRow } from '../ir/multiline.js';
import { fontSize, textFill } from '../ir/resolve.js';
import { MATH_CONSTANTS } from './font.js';
import { FrameFragment, GlyphFragment } from './fragment.js';
import { type FixedStroke, Frame, point } from './frame.js';
import type { MathContext } from './math.js';
import { type MathRun, layoutAlignedRow, measureRow, stackRows } from './run.js';

type TableKind = Extract<MathKind, { tag: 'table' }>;

/** The default thickness of augmentation lines, which scales with the font. */
const DEFAULT_STROKE_THICKNESS: Em = 0.05;

/** A ratio of the region, which is unbounded in math: only the absolute part counts. */
const inRegion = (rel: Rel<Abs>): Abs => rel.abs;

/** A cell, split at alignment points into sub-columns, like `CellLayout`. */
interface CellLayout {
  readonly subColumns: MathRun[];
  readonly height: [Abs, Abs];
}

/** Lays out a matrix, vector or cases, like `layout_table`. */
export function layoutTable(item: TableKind, ctx: MathContext, styles: StyleChain, props: MathProperties): void {
  const rows = item.cells;
  const nrows = rows.length;
  const ncols = rows[0]?.length ?? 0;
  if (ncols === 0 || nrows === 0) {
    ctx.push(new FrameFragment(props, styles, Frame.soft({ x: 0, y: 0 })));
    return;
  }

  const gap = { x: inRegion(item.gap.x), y: inRegion(item.gap.y) };
  const halfGap = { x: gap.x * 0.5, y: gap.y * 0.5 };

  // The default augmentation stroke scales with the font, with square caps.
  const size = fontSize(styles);
  const userStroke = item.augment?.stroke ?? null;
  const stroke: FixedStroke = {
    paint: userStroke?.paint ?? textFill(styles),
    thickness: userStroke?.thickness ? lengthAt(userStroke.thickness, size) : emAt(DEFAULT_STROKE_THICKNESS, size),
    cap: 'square',
  };
  const hline = [...(item.augment?.hline ?? [])].map((line) => (line < 0 ? line + nrows : line));
  const vline = [...(item.augment?.vline ?? [])].map((line) => (line < 0 ? line + ncols : line));

  // The cells are laid out first, so that rows and columns can align.
  const cols: CellLayout[][] = Array.from({ length: ncols }, () => []);
  // The largest ascent and descent of each row.
  const heights: [Abs, Abs][] = Array.from({ length: nrows }, () => [0, 0]);

  // Rows are at least as tall as a parenthesis, so that ordinary matrices
  // align with each other.
  const paren = GlyphFragment.synthetic(chain(styles, styleForDenominator(styles)), '(', null);
  const [ascent, descent] = [paren.ascent, paren.descent];

  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      const layout = layoutCell(cell, ctx, styles);
      heights[r]![0] = Math.max(heights[r]![0], Math.max(layout.height[0], ascent));
      heights[r]![1] = Math.max(heights[r]![1], Math.max(layout.height[1], descent));
      cols[c]!.push(layout);
    });
  });

  // The rows' heights, plus the gaps between them, and before or after the
  // rows if a line goes there.
  let totalHeight = heights.reduce((sum, [a, b]) => sum + (a + b), 0) + gap.y * (nrows - 1);
  if (hline.includes(0)) totalHeight += gap.y;
  if (hline.includes(nrows)) totalHeight += gap.y;

  const frame = Frame.soft({ x: 0, y: totalHeight });
  const line = (length: Abs, vertical: boolean) => ({
    kind: 'shape' as const,
    shape: { geometry: { kind: 'line' as const, to: vertical ? point(0, length) : point(length, 0) }, fill: null, stroke },
  });

  let x = 0;
  if (vline.includes(0)) {
    frame.push(point(x + halfGap.x, 0), line(totalHeight, true));
    x += gap.x;
  }

  cols.forEach((col, index) => {
    const subWidths = computeSubColumnWidths(col);
    const builder = stackRows(
      col.map((cell, row) => ({ cells: cell.subColumns, frameHeight: cell.height, rowHeight: heights[row]! })),
      subWidths,
      item.alternator,
      item.align,
      gap.y,
      hline.includes(0) ? gap.y : 0,
    );
    for (const [cell, pos] of builder.frames) frame.pushFrame(point(pos.x + x, pos.y), cell);
    // The end of the column, then a line if one goes after it.
    x += builder.size.x;
    if (vline.includes(index + 1)) frame.push(point(x + halfGap.x, 0), line(totalHeight, true));
    // The start of the next column.
    x += gap.x;
  });

  const totalWidth = vline.includes(ncols) ? x : x - gap.x;

  for (const l of hline) {
    const offset =
      l === 0 ? gap.y : heights.slice(0, l).reduce((sum, [a, b]) => sum + (a + b), 0) + gap.y * (l - 1) + halfGap.y;
    frame.push(point(0, offset), line(totalWidth, false));
  }

  frame.size.x = totalWidth;
  frame.setBaseline(frame.height / 2 + emAt(MATH_CONSTANTS.axisHeight, size));
  ctx.push(new FrameFragment(props, styles, frame));
}

/** Lays out a cell, split at alignment points into sub-columns, like `layout_cell`. */
function layoutCell(cell: AlignedRow, ctx: MathContext, styles: StyleChain): CellLayout {
  const subColumns = layoutAlignedRow(cell, ctx, styles);
  return { subColumns, height: measureRow(subColumns) };
}

/** The widest sub-columns across a column, like `compute_sub_column_widths`. */
function computeSubColumnWidths(col: CellLayout[]): Abs[] {
  const length = col.length === 0 ? 1 : Math.max(...col.map((cell) => cell.subColumns.length));
  const widths: Abs[] = Array(length).fill(0);
  for (const cell of col) {
    cell.subColumns.forEach((sub, i) => {
      widths[i] = Math.max(widths[i]!, sub.reduce((sum, f) => sum + f.width, 0));
    });
  }
  return widths;
}
