// Ported from Typst 0.15.1: crates/typst-layout/src/math/fraction.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import type { Abs } from '../eval/layout.js';
import { emAt } from '../eval/layout.js';
import type { StyleChain } from '../eval/styles.js';
import { MathSize } from '../elements/style.js';
import { type MathKind, type MathProperties, setStretchRelativeTo } from '../ir/item.js';
import { fontSize, textFill } from '../ir/resolve.js';
import { MATH_CONSTANTS } from './font.js';
import { FrameFragment } from './fragment.js';
import { Frame, point } from './frame.js';
import type { MathContext } from './math.js';

type FractionKind = Extract<MathKind, { tag: 'fraction' }>;
type SkewedFractionKind = Extract<MathKind, { tag: 'skewed-fraction' }>;

const constant = (name: keyof typeof MATH_CONSTANTS, size: Abs): Abs => emAt(MATH_CONSTANTS[name] as number, size);

/** Lays out a fraction or binomial, like `layout_fraction`. */
export function layoutFraction(item: FractionKind, ctx: MathContext, styles: StyleChain, props: MathProperties): void {
  const num = ctx.layoutIntoFragment(item.numerator, styles).intoFrame();
  const denom = ctx.layoutIntoFragment(item.denominator, styles).intoFrame();
  const size = fontSize(styles);
  const display = props.size === MathSize.Display;

  let frame: Frame;
  if (item.line) {
    const axis = constant('axisHeight', size);
    const thickness = constant('fractionRuleThickness', size);
    const shiftUp = constant(display ? 'fractionNumeratorDisplayStyleShiftUp' : 'fractionNumeratorShiftUp', size);
    const shiftDown = constant(
      display ? 'fractionDenominatorDisplayStyleShiftDown' : 'fractionDenominatorShiftDown',
      size,
    );
    const numMin = constant(display ? 'fractionNumDisplayStyleGapMin' : 'fractionNumeratorGapMin', size);
    const denomMin = constant(display ? 'fractionDenomDisplayStyleGapMin' : 'fractionDenominatorGapMin', size);

    const numGap = Math.max(shiftUp - (axis + thickness / 2) - num.descent, numMin);
    const denomGap = Math.max(shiftDown + (axis - thickness / 2) - denom.ascent, denomMin);

    const lineWidth = Math.max(num.width, denom.width);
    const width = lineWidth + 2 * emAt(item.padding, size);
    const height = num.height + numGap + thickness + denomGap + denom.height;
    const numPos = point((width - num.width) / 2, 0);
    const linePos = point((width - lineWidth) / 2, num.height + numGap + thickness / 2);
    const denomPos = point((width - denom.width) / 2, height - denom.height);

    frame = Frame.soft({ x: width, y: height });
    frame.setBaseline(linePos.y + axis);
    frame.pushFrame(numPos, num);
    frame.pushFrame(denomPos, denom);
    frame.push(linePos, {
      kind: 'shape',
      shape: { geometry: { kind: 'line', to: point(lineWidth, 0) }, fill: null, stroke: { paint: textFill(styles), thickness, cap: 'butt' } },
    });
  } else {
    const shiftUp = constant(display ? 'stackTopDisplayStyleShiftUp' : 'stackTopShiftUp', size);
    const shiftDown = constant(display ? 'stackBottomDisplayStyleShiftDown' : 'stackBottomShiftDown', size);
    const gapMin = constant(display ? 'stackDisplayStyleGapMin' : 'stackGapMin', size);

    const gap = shiftUp - num.descent + (shiftDown - denom.ascent);
    const width = Math.max(num.width, denom.width) + 2 * emAt(item.padding, size);
    const height = num.height + Math.max(gap, gapMin) + denom.height;

    frame = Frame.soft({ x: width, y: height });
    frame.setBaseline(num.ascent + shiftUp + Math.max(gapMin - gap, 0) / 2);
    frame.pushFrame(point((width - num.width) / 2, 0), num);
    frame.pushFrame(point((width - denom.width) / 2, height - denom.height), denom);
  }

  ctx.push(new FrameFragment(props, styles, frame));
}

/** Lays out a skewed fraction, like `layout_skewed_fraction`. */
export function layoutSkewedFraction(
  item: SkewedFractionKind,
  ctx: MathContext,
  styles: StyleChain,
  props: MathProperties,
): void {
  const size = fontSize(styles);
  const vgap = constant('skewedFractionVerticalGap', size);
  const hgap = constant('skewedFractionHorizontalGap', size);
  const axis = constant('axisHeight', size);

  const num = ctx.layoutIntoFragment(item.numerator, styles).intoFrame();
  const denom = ctx.layoutIntoFragment(item.denominator, styles).intoFrame();

  // The fraction's height, larger if the slash overflows.
  let height = num.height + denom.height + vgap;

  setStretchRelativeTo(item.slash, height, 'y');
  const slash = ctx.layoutIntoFragment(item.slash, styles).intoFrame();

  const verticalOffset = Math.max(0, slash.height - height) / 2;
  height = Math.max(height, slash.height);

  // The top-left corners of the slash, numerator and denominator.
  let slashX = num.width + hgap / 2 - slash.width / 2;
  const slashY = height / 2 - slash.height / 2;
  let numX = 0;
  const numY = verticalOffset;
  let denomX = numX + num.width + hgap;
  const denomY = numY + num.height + vgap;

  const width = Math.max(denomX + denom.width, slashX + slash.width) + Math.max(0, -slashX);
  // Shift everything right, so that no coordinate is negative.
  const shift = Math.max(0, -slashX);
  slashX += shift;
  numX += shift;
  denomX += shift;

  const frame = Frame.soft({ x: width, y: height });
  // The axis centers the slash.
  frame.setBaseline(height / 2 + axis);
  frame.pushFrame(point(numX, numY), num);
  frame.pushFrame(point(denomX, denomY), denom);
  frame.pushFrame(point(slashX, slashY), slash);
  ctx.push(new FrameFragment(props, styles, frame));
}
