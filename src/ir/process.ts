// Ported from Typst 0.15.1: crates/typst-library/src/math/ir/process.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { lengthAt } from '../eval/layout.js';
import type { StyleChain } from '../eval/styles.js';
import { MEDIUM, THICK, THIN } from '../elements/mod.js';
import { MathSize } from '../elements/style.js';
import { MathClass } from '../utils/math-class.js';
import {
  type MathItem,
  type RawMathItem,
  classOf,
  isIgnorant,
  isItem,
  isRawIgnorant,
  isSpaced,
  lclass,
  rclass,
  setClass,
  setLspace,
  setRspace,
  sizeOf,
  wrap,
} from './item.js';
import { type AlignedRow, padTo, splitAtAlign } from './multiline.js';

export type GroupResult = { readonly flat: MathItem[] } | { readonly multiline: AlignedRow[] };

/**
 * Inserts automatic spacing and resolves linebreaks and alignment points in a
 * group. `closing` is set when the group ends with a closing delimiter; `pad`
 * pads all rows to the same number of columns; `split` splits at alignment
 * points even without linebreaks.
 */
export function processGroup(
  items: RawMathItem[],
  styles: StyleChain,
  closing: boolean,
  pad: boolean,
  split: boolean,
): GroupResult {
  const pre = preprocess(items, closing, false);
  if (pre.linebreaks > 0 || (split && pre.hasAlign)) {
    const rows: AlignedRow[] = [];
    let row: RawMathItem[] = [];
    for (const item of [...pre.items, { type: 'linebreak' } as const]) {
      if (item.type === 'linebreak') {
        rows.push(splitAtAlign(row, styles));
        row = [];
      } else {
        row.push(item);
      }
    }
    if (pad) {
      const ncols = Math.max(0, ...rows.map((r) => r.length));
      for (const r of rows) padTo(r, ncols, styles);
    }
    return { multiline: rows };
  }
  return { flat: pre.items.filter((item): item is MathItem => item.type !== 'align' && isItem(item)) };
}

/** Processes the items of a table cell, splitting them at alignment points. */
export function processTableCell(
  items: RawMathItem[],
  styles: StyleChain,
): { subColumns: AlignedRow; hadLinebreaks: boolean } {
  const pre = preprocess(items, false, true);
  const subColumns = pre.hasAlign
    ? splitAtAlign(pre.items, styles)
    : [wrap(pre.items.filter((item): item is MathItem => isItem(item)), styles)];
  return { subColumns, hadLinebreaks: pre.hadLinebreaks };
}

interface Preprocessed {
  items: RawMathItem[];
  hadLinebreaks: boolean;
  hasAlign: boolean;
  linebreaks: number;
}

function preprocess(items: RawMathItem[], closing: boolean, stripLinebreaks: boolean): Preprocessed {
  const resolved: RawMathItem[] = [];
  let last: number | null = null;
  let space: MathItem | null = null;
  let hadLinebreaks = false;
  let hasAlign = false;
  let linebreaks = 0;

  const lastNonIgnorantIndex = (): number => {
    for (let i = resolved.length - 1; i >= 0; i--) if (!isRawIgnorant(resolved[i]!)) return i;
    return -1;
  };

  for (const raw of items) {
    // Tags don't affect layout.
    if (raw.type === 'tag') {
      resolved.push(raw);
      continue;
    }
    if (raw.type === 'space') {
      // Keep a space only if spaced items support it.
      if (last !== null) space = raw;
      continue;
    }
    if (raw.type === 'spacing') {
      // Explicit spacing disables automatic spacing.
      last = null;
      space = null;
      if (raw.weak) {
        const i = lastNonIgnorantIndex();
        if (i < 0) continue;
        const prev = resolved[i]!;
        if (prev.type === 'spacing' && prev.weak) {
          if (lengthAt(prev.amount, prev.fontSize) < lengthAt(raw.amount, raw.fontSize)) {
            prev.amount = raw.amount;
            prev.fontSize = raw.fontSize;
          }
          continue;
        }
      }
      resolved.push(raw);
      continue;
    }
    if (raw.type === 'align') {
      // Alignment points are resolved later.
      hasAlign = true;
      resolved.push(raw);
      continue;
    }
    if (raw.type === 'linebreak') {
      hadLinebreaks = true;
      if (stripLinebreaks) continue;
      linebreaks++;
      resolved.push(raw);
      space = null;
      last = null;
      continue;
    }

    const item: MathItem = raw;

    // Variable operators become binary operators when they follow something
    // that isn't an operator or a comparison.
    if (classOf(item) === MathClass.Vary && last !== null) {
      const prev = resolved[last]!;
      if (isItem(prev)) {
        const cls = classOf(prev);
        if (cls === MathClass.Normal || cls === MathClass.Alphabetic || cls === MathClass.Closing || cls === MathClass.Fence) {
          setClass(item, MathClass.Binary);
        }
      }
    }

    // Insert spacing between the last non-ignorant item and this one.
    if (!isIgnorant(item)) {
      if (last !== null) {
        const prev = resolved[last]!;
        if (isItem(prev)) {
          const s = spacing(prev, space, item);
          space = null;
          if (s) resolved.splice(last + 1, 0, s);
        }
      }
      last = resolved.length;
    }

    resolved.push(item);
  }

  // Apply closing punctuation spacing if applicable.
  const lastIndex = lastNonIgnorantIndex();
  const lastItem = lastIndex >= 0 ? resolved[lastIndex] : undefined;
  if (
    closing &&
    lastItem !== undefined &&
    isItem(lastItem) &&
    rclass(lastItem) === MathClass.Punctuation &&
    (sizeOf(lastItem) === null || sizeOf(lastItem)! > MathSize.Script)
  ) {
    setRspace(lastItem, THIN);
  } else if (lastIndex >= 0) {
    const item = resolved[lastIndex]!;
    if (item.type === 'spacing' && item.weak) resolved.splice(lastIndex, 1);
  }

  // Strip a final trailing linebreak.
  if (!closing) {
    const i = lastNonIgnorantIndex();
    if (i >= 0 && resolved[i]!.type === 'linebreak') {
      resolved.splice(i, 1);
      linebreaks--;
    }
  }

  return { items: resolved, hadLinebreaks, hasAlign, linebreaks };
}

/** The automatic spacing between two items: none, or the space item to keep. */
function spacing(l: MathItem, space: MathItem | null, r: MathItem): MathItem | null {
  const script = (item: MathItem) => {
    const size = sizeOf(item);
    return size !== null && size <= MathSize.Script;
  };
  const left = rclass(l);
  const right = lclass(r);
  const C = MathClass;

  // No spacing before punctuation; thin spacing after punctuation, unless in
  // script size.
  if (right === C.Punctuation) return null;
  if (left === C.Punctuation && !script(l)) {
    setRspace(l, THIN);
    return null;
  }

  // No spacing after opening delimiters and before closing delimiters.
  if (left === C.Opening || right === C.Closing) return null;

  // Thick spacing around relations, unless followed by another relation or in
  // script size.
  if (left === C.Relation && right === C.Relation) return null;
  if (left === C.Relation && !script(l)) {
    setRspace(l, THICK);
    return null;
  }
  if (right === C.Relation && !script(r)) {
    setLspace(r, THICK);
    return null;
  }

  // Medium spacing around binary operators, unless in script size.
  if (left === C.Binary && !script(l)) {
    setRspace(l, MEDIUM);
    return null;
  }
  if (right === C.Binary && !script(r)) {
    setLspace(r, MEDIUM);
    return null;
  }

  // Thin spacing around large operators, unless to the left of an opening
  // delimiter. TeXBook, p170.
  if (left === C.Large && (right === C.Opening || right === C.Fence)) return null;
  if (left === C.Large) {
    setRspace(l, THIN);
    return null;
  }
  if (right === C.Large) {
    setLspace(r, THIN);
    return null;
  }

  // Spacing around spaced frames.
  if (isSpaced(l) || isSpaced(r)) return space;

  return null;
}
