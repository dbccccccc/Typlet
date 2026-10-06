// Ported from Typst 0.15.1: crates/typst-library/src/math/ir/multiline.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import type { Span } from '../eval/diag.js';
import type { StyleChain } from '../eval/styles.js';
import { MathClass } from '../utils/math-class.js';
import {
  ALIGN,
  LINEBREAK,
  type MathItem,
  type RawMathItem,
  type SharedFenceSizing,
  classOf,
  fencedItem,
  isIgnorant,
  wrap,
} from './item.js';

/** A row of columns, split at alignment points. */
export type AlignedRow = MathItem[];

/** Pads a row with empty columns up to `length`. */
export function padTo(row: AlignedRow, length: number, styles: StyleChain): void {
  while (row.length < length) row.push(wrap([], styles));
}

/**
 * Splits fenced content that spans several lines into one fenced item per
 * cell, all sized together. The opening delimiter goes with the first cell,
 * the closing one with the last.
 */
export function expandMultilineFence(
  rows: AlignedRow[],
  open: MathItem | null,
  close: MathItem | null,
  styles: StyleChain,
  span: Span,
): RawMathItem[] {
  const nrows = rows.length;
  const bodies: MathItem[] = [];
  const rowLengths: number[] = [];
  for (const row of rows) {
    rowLengths.push(row.length);
    bodies.push(...row);
  }
  const sizing: SharedFenceSizing = { items: bodies, styles, relativeTo: null };

  const result: RawMathItem[] = [];
  let bodyIndex = 0;
  rowLengths.forEach((ncols, rowIndex) => {
    if (rowIndex > 0) result.push(LINEBREAK);
    for (let colIndex = 0; colIndex < ncols; colIndex++) {
      if (colIndex > 0) result.push(ALIGN);
      const isFirst = rowIndex === 0 && colIndex === 0;
      const isLast = rowIndex + 1 === nrows && colIndex + 1 === ncols;
      result.push(
        fencedItem(
          isFirst ? open : null,
          isLast ? close : null,
          { shared: sizing, index: bodyIndex },
          true,
          styles,
          span,
        ),
      );
      if (isFirst) open = null;
      if (isLast) close = null;
      bodyIndex++;
    }
  });
  return result;
}

/** Splits items at alignment points into columns. */
export function splitAtAlign(items: Iterable<RawMathItem>, styles: StyleChain): AlignedRow {
  const cols: MathItem[][] = [[]];
  let atBoundary = false;
  for (const raw of items) {
    if (raw.type === 'align') {
      cols.push([]);
      atBoundary = true;
      continue;
    }
    if (raw.type === 'linebreak') throw new Error('unreachable: linebreak in a row');
    const item = raw;
    // Right after an alignment point, check whether the item is semantically infix.
    if (atBoundary && !isIgnorant(item)) {
      const cls = classOf(item);
      if (cols.length % 2 === 0 && (cls === MathClass.Relation || cls === MathClass.Binary) && item.type === 'component') {
        item.props.alignFormInfix = true;
      }
      atBoundary = false;
    }
    cols[cols.length - 1]!.push(item);
  }
  return cols.map((col) => wrap(col, styles));
}
