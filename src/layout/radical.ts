// Ported from Typst 0.15.1: crates/typst-layout/src/math/radical.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import type { Abs } from '../eval/layout.js';
import { emAt } from '../eval/layout.js';
import type { StyleChain } from '../eval/styles.js';
import { MathSize, equationSize } from '../elements/style.js';
import { type MathKind, type MathProperties, setStretchRelativeTo } from '../ir/item.js';
import { fontSize, textFill } from '../ir/resolve.js';
import { MATH_CONSTANTS } from './font.js';
import { FrameFragment } from './fragment.js';
import { Frame, point } from './frame.js';
import type { MathContext } from './math.js';

type RadicalKind = Extract<MathKind, { tag: 'radical' }>;

const constant = (name: keyof typeof MATH_CONSTANTS, size: Abs): Abs => emAt(MATH_CONSTANTS[name] as number, size);

/** Lays out a root (TeXbook pp. 360, 443; MathML Core), like `layout_radical`. */
export function layoutRadical(item: RadicalKind, ctx: MathContext, styles: StyleChain, props: MathProperties): void {
  const radicand = ctx.layoutIntoFragment(item.radicand, styles).intoFrame();
  const sqrtStyles = item.sqrt.type === 'component' ? item.sqrt.styles : styles;
  const display = equationSize(sqrtStyles) === MathSize.Display;

  // The radical sign stretches to cover the radicand, the gap and the rule.
  const target = (() => {
    const sqrt = ctx.layoutIntoFragment(item.sqrt, styles);
    const size = sqrt.fontSize ?? fontSize(sqrtStyles);
    const thickness = constant('radicalRuleThickness', size);
    const gap = constant(display ? 'radicalDisplayStyleVerticalGap' : 'radicalVerticalGap', size);
    return radicand.height + thickness + gap;
  })();

  setStretchRelativeTo(item.sqrt, target, 'y');
  const sqrtFragment = ctx.layoutIntoFragment(item.sqrt, styles);
  const size = sqrtFragment.fontSize ?? fontSize(sqrtStyles);
  const thickness = constant('radicalRuleThickness', size);
  const extraAscender = constant('radicalExtraAscender', size);
  const kernBefore = constant('radicalKernBeforeDegree', size);
  const kernAfter = constant('radicalKernAfterDegree', size);
  const raiseFactor = MATH_CONSTANTS.radicalDegreeBottomRaisePercent;
  let gap = constant(display ? 'radicalDisplayStyleVerticalGap' : 'radicalVerticalGap', size);

  const lineWidth = radicand.width;
  const sqrt = sqrtFragment.intoFrame();

  const index = item.index ? ctx.layoutIntoFragment(item.index, styles).intoFrame() : null;

  // TeXbook p. 443, item 11: keep the gap, and distribute any free space
  // equally above and below.
  gap = Math.max(gap, (sqrt.height - thickness - radicand.height + gap) / 2);

  const sqrtAscent = radicand.ascent + gap + thickness;
  const descent = sqrt.height - sqrtAscent;
  const innerAscent = sqrtAscent + extraAscender;

  let sqrtOffset = 0;
  let shiftUp = 0;
  let ascent = innerAscent;
  if (index) {
    sqrtOffset = kernBefore + index.width + kernAfter;
    // The TeXbook's `\root` raise (p. 360), plus the index's descent, so
    // that descenders don't collide with the surd.
    shiftUp = raiseFactor * (innerAscent - descent) + index.descent;
    ascent = Math.max(ascent, shiftUp + index.ascent);
  }

  const sqrtX = Math.max(sqrtOffset, 0);
  const radicandX = sqrtX + sqrt.width;
  const radicandY = ascent - radicand.ascent;

  // The sign is placed by its top, hence the extra thickness.
  const sqrtPos = point(sqrtX, radicandY - gap - thickness);
  const linePos = point(radicandX, radicandY - gap - thickness / 2);

  const frame = Frame.soft({ x: radicandX + lineWidth, y: ascent + descent });
  frame.setBaseline(ascent);
  if (index) frame.pushFrame(point(-Math.min(sqrtOffset, 0) + kernBefore, ascent - index.ascent - shiftUp), index);
  frame.pushFrame(sqrtPos, sqrt);
  // The horizontal line of the radical sign.
  frame.push(linePos, {
    kind: 'shape',
    shape: {
      geometry: { kind: 'line', to: point(lineWidth, 0) },
      fill: null,
      stroke: { paint: sqrtFragment.kind === 'glyph' ? sqrtFragment.item.fill : textFill(styles), thickness, cap: 'butt' },
    },
  });
  frame.pushFrame(point(radicandX, radicandY), radicand);
  ctx.push(new FrameFragment(props, styles, frame));
}
