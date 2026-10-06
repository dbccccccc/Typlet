// Ported from Typst 0.15.1: crates/typst-layout/src/math/line.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import type { Abs } from '../eval/layout.js';
import { emAt } from '../eval/layout.js';
import type { StyleChain } from '../eval/styles.js';
import { type MathKind, type MathProperties, Position } from '../ir/item.js';
import { fontSize, textFill } from '../ir/resolve.js';
import { MATH_CONSTANTS } from './font.js';
import { FrameFragment } from './fragment.js';
import { Frame, point } from './frame.js';
import type { MathContext } from './math.js';

type LineKind = Extract<MathKind, { tag: 'line' }>;

const constant = (name: keyof typeof MATH_CONSTANTS, size: Abs): Abs => emAt(MATH_CONSTANTS[name] as number, size);

/** Lays out a line above or below a base, like `layout_line`. */
export function layoutLine(item: LineKind, ctx: MathContext, styles: StyleChain, props: MathProperties): void {
  const content = ctx.layoutIntoFragment(item.base, styles);
  const baseStyles = item.base.type === 'component' ? item.base.styles : styles;
  const size = content.fontSize ?? fontSize(baseStyles);

  let extraHeight: Abs;
  let lineY: Abs;
  let contentY: Abs;
  let baseline: Abs;
  let thickness: Abs;
  let lineAdjust: Abs;
  if (item.position === Position.Below) {
    const sep = constant('underbarExtraDescender', size);
    thickness = constant('underbarRuleThickness', size);
    const gap = constant('underbarVerticalGap', size);
    extraHeight = sep + thickness + gap;
    lineY = content.height + gap + thickness / 2;
    contentY = 0;
    baseline = content.ascent;
    lineAdjust = -content.italicsCorrection;
  } else {
    const sep = constant('overbarExtraAscender', size);
    thickness = constant('overbarRuleThickness', size);
    const gap = constant('overbarVerticalGap', size);
    extraHeight = sep + thickness + gap;
    lineY = sep + thickness / 2;
    contentY = extraHeight;
    baseline = content.ascent + extraHeight;
    lineAdjust = 0;
  }

  const width = content.width;
  const textLike = content.isTextLike();
  const italics = content.italicsCorrection;
  const frame = Frame.soft({ x: width, y: content.height + extraHeight });
  frame.setBaseline(baseline);
  frame.pushFrame(point(0, contentY), content.intoFrame());
  frame.push(point(0, lineY), {
    kind: 'shape',
    shape: {
      geometry: { kind: 'line', to: point(width + lineAdjust, 0) },
      fill: null,
      stroke: { paint: textFill(styles), thickness, cap: 'butt' },
    },
  });
  ctx.push(new FrameFragment(props, styles, frame).withItalicsCorrection(italics).withTextLike(textLike));
}
