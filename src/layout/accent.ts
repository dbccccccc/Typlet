// Ported from Typst 0.15.1: crates/typst-layout/src/math/accent.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import type { Abs } from '../eval/layout.js';
import { emAt } from '../eval/layout.js';
import type { StyleChain } from '../eval/styles.js';
import {
  type MathKind,
  type MathProperties,
  Position,
  setFlac,
  setStretchFontSize,
  setStretchRelativeTo,
} from '../ir/item.js';
import { fontSize } from '../ir/resolve.js';
import { MATH_CONSTANTS } from './font.js';
import { FrameFragment } from './fragment.js';
import { Frame, point } from './frame.js';
import type { MathContext } from './math.js';

type AccentKind = Extract<MathKind, { tag: 'accent' }>;

/** Lays out an accent above or below a base, like `layout_accent`. */
export function layoutAccent(item: AccentKind, ctx: MathContext, styles: StyleChain, props: MathProperties): void {
  const top = item.position === Position.Above;

  const base = ctx.layoutIntoFragment(item.base, styles);
  const baseStyles = item.base.type === 'component' ? item.base.styles : styles;
  const size = base.fontSize ?? fontSize(baseStyles);
  const baseAttach = base.accentAttach;

  // Use the flattened accent over tall bases.
  if (top && base.ascent > emAt(MATH_CONSTANTS.flattenedAccentBaseHeight, size)) setFlac(item.accent);

  setStretchRelativeTo(item.accent, base.width, 'x');
  setStretchFontSize(item.accent, size, 'x');

  const accentFragment = ctx.layoutIntoFragment(item.accent, styles);
  const accentAttach = accentFragment.accentAttach[0];
  const accent = accentFragment.intoFrame();

  // The frame's width, and where the base and accent start in it.
  let width: Abs;
  let baseX: Abs;
  let accentX: Abs;
  const attach = top ? baseAttach[0] : baseAttach[1];
  if (!item.exactFrameWidth) {
    width = base.width;
    baseX = 0;
    accentX = attach - accentAttach;
  } else {
    const pre = accentAttach - attach;
    const post = accent.width - accentAttach - (base.width - attach);
    width = Math.max(pre, 0) + base.width + Math.max(post, 0);
    [baseX, accentX] = pre < 0 ? [0, -pre] : [pre, 0];
  }

  let gap: Abs;
  let accentY: Abs;
  let baseY: Abs;
  if (top) {
    // The accent's ink is above its baseline, so its descent is negative:
    // the gap is that minus the accent base height, unless the base is
    // short, so that the accent doesn't come too low.
    gap = -accent.descent - Math.min(base.ascent, emAt(MATH_CONSTANTS.accentBaseHeight, size));
    accentY = 0;
    baseY = accent.height + gap;
  } else {
    gap = -accent.ascent;
    accentY = base.height + gap;
    baseY = 0;
  }

  const textLike = !item.exactFrameWidth && base.isTextLike();
  const italics = base.italicsCorrection;
  const baseAscent = base.baseAscent;
  const baseDescent = base.baseDescent;

  const frame = Frame.soft({ x: width, y: accent.height + gap + base.height });
  frame.setBaseline(baseY + base.ascent);
  frame.pushFrame(point(baseX, baseY), base.intoFrame());
  frame.pushFrame(point(accentX, accentY), accent);
  ctx.push(
    new FrameFragment(props, styles, frame)
      .withBaseAscent(baseAscent)
      .withBaseDescent(baseDescent)
      .withItalicsCorrection(italics)
      .withTextLike(textLike)
      .withAccentAttach(baseAttach),
  );
}
