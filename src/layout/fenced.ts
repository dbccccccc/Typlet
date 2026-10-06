// Ported from Typst 0.15.1: crates/typst-layout/src/math/fenced.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import type { Abs } from '../eval/layout.js';
import { emAt } from '../eval/layout.js';
import type { StyleChain } from '../eval/styles.js';
import {
  type MathItem,
  type MathKind,
  asSlice,
  fencedBodyItem,
  midStretched,
  setStretchRelativeTo,
  sharedRelativeTo,
} from '../ir/item.js';
import { fontSize } from '../ir/resolve.js';
import { MATH_CONSTANTS } from './font.js';
import type { MathFragment } from './fragment.js';
import type { MathContext } from './math.js';

type FencedKind = Extract<MathKind, { tag: 'fenced' }>;

/** Lays out delimiters around a body, sized to it, like `layout_fenced`. */
export function layoutFenced(item: FencedKind, ctx: MathContext, styles: StyleChain): void {
  const body = fencedBodyItem(item.body);

  // The height the delimiters stretch relative to: the body's, or that of
  // all the lines of a fence split across lines.
  let relativeTo: Abs;
  let initialBody: MathFragment[] | null = null;
  if (item.body.shared) {
    relativeTo = sharedRelativeTo(item.body.shared, (items, sharedStyles) =>
      items.reduce((max, child) => {
        const fragments = ctx.layoutIntoFragments(child, sharedStyles);
        const childStyles = child.type === 'component' ? child.styles : sharedStyles;
        return Math.max(max, relativeToFromFragments(fragments, childStyles, item.balanced));
      }, 0),
    );
  } else {
    initialBody = ctx.layoutIntoFragments(body, styles);
    const bodyStyles = body.type === 'component' ? body.styles : styles;
    relativeTo = relativeToFromFragments(initialBody, bodyStyles, item.balanced);
  }

  // Stretched `mid` delimiters stretch with the fences.
  let hasMidStretched = false;
  for (const child of asSlice(body)) {
    if (midStretched(child) === true) {
      hasMidStretched = true;
      setStretchRelativeTo(child, relativeTo, 'y');
    }
  }

  if (item.open) {
    setStretchRelativeTo(item.open, relativeTo, 'y');
    ctx.push(ctx.layoutIntoFragment(item.open, styles));
  }

  // Lay the body out again if the mid delimiters changed, or if it wasn't yet.
  const laidOut = !hasMidStretched && initialBody ? initialBody : ctx.layoutIntoFragments(body, styles);
  for (const fragment of laidOut) ctx.push(fragment);

  if (item.close) {
    setStretchRelativeTo(item.close, relativeTo, 'y');
    ctx.push(ctx.layoutIntoFragment(item.close, styles));
  }
}

/** The height of fragments, or twice their extent from the axis if balanced. */
function relativeToFromFragments(fragments: MathFragment[], styles: StyleChain, balanced: boolean): Abs {
  let max: Abs | null = null;
  for (const f of fragments) {
    let height: Abs;
    if (balanced) {
      const size = f.fontSize ?? fontSize(styles);
      const axis = emAt(MATH_CONSTANTS.axisHeight, size);
      height = 2 * Math.max(f.ascent - axis, f.descent + axis);
    } else {
      height = f.height;
    }
    max = max === null ? height : Math.max(max, height);
  }
  return max ?? 0;
}

export type { MathItem };
