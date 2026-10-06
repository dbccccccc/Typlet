// Ported from Typst 0.15.1: crates/typst-layout/src/math/cancel.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import type { Color } from '../eval/color.js';
import type { Stroke } from '../eval/content.js';
import { Args } from '../eval/args.js';
import { angleCast } from '../eval/cast.js';
import { at } from '../eval/diag.js';
import { callFunc, newEngine } from '../eval/func.js';
import type { Span } from '../eval/diag.js';
import { type Abs, type Rel, absPt, lengthAt, relRelativeTo } from '../eval/layout.js';
import type { StyleChain } from '../eval/styles.js';
import type { MathKind, MathProperties } from '../ir/item.js';
import { fontSize, textFill } from '../ir/resolve.js';
import { FrameFragment } from './fragment.js';
import { type FixedStroke, Frame, type Size, point, rotate } from './frame.js';
import type { MathContext } from './math.js';

type CancelKind = Extract<MathKind, { tag: 'cancel' }>;

/** Lays out a struck-through base, like `layout_cancel`. */
export function layoutCancel(item: CancelKind, ctx: MathContext, styles: StyleChain, props: MathProperties): void {
  const body = ctx.layoutIntoFragment(item.base, styles);
  // Keep the body's properties.
  const textLike = body.isTextLike();
  const italics = body.italicsCorrection;
  const attach = body.accentAttach;

  const frame = body.intoFrame();
  const size: Size = { x: frame.width, y: frame.height };
  const stroke = resolveStroke(item.stroke, fontSize(styles), textFill(styles));

  // The lines' origin is the middle of the body.
  const center = point(size.x / 2, size.y / 2);
  frame.pushFrame(center, drawCancelLine(item.length, stroke, item.invertFirstLine, item.angle, size, props.span));
  if (item.cross) frame.pushFrame(center, drawCancelLine(item.length, stroke, true, item.angle, size, props.span));

  ctx.push(new FrameFragment(props, styles, frame).withItalicsCorrection(italics).withTextLike(textLike).withAccentAttach(attach));
}

/** The stroke at a font size, with the text's color unless set, like `unwrap_or` with Typst's defaults. */
export function resolveStroke(stroke: Stroke, size: Abs, fill: Color): FixedStroke {
  const thickness = stroke.thickness ? lengthAt(stroke.thickness, size) : absPt(1);
  const dash = stroke.dash
    ? {
        // A dot is as long as the stroke is thick.
        array: stroke.dash.array.map((l) => (l === null ? thickness : lengthAt(l, size))),
        phase: lengthAt(stroke.dash.phase, size),
      }
    : null;
  return { paint: stroke.paint ?? fill, thickness, cap: stroke.cap ?? 'butt', dash };
}

/** A cancel line through the middle, rotated by its angle, like `draw_cancel_line`. */
function drawCancelLine(
  lengthScale: Rel<Abs>,
  stroke: FixedStroke,
  invert: boolean,
  angleSpec: CancelKind['angle'],
  body: Size,
  span: Span,
): Frame {
  // By default, the line is the body's diagonal: its angle from the y-axis,
  // clockwise, in [0, π/2].
  const ratio = body.x / body.y;
  const defaultAngle = Number.isNaN(Math.atan(ratio)) ? 0 : Math.atan(ratio);
  let angle = defaultAngle;
  if (angleSpec !== null) {
    if ('func' in angleSpec) {
      // A function gets the default angle and returns the angle.
      const args = new Args(span, [{ span, name: null, value: { type: 'angle', v: defaultAngle }, valueSpan: span }]);
      const value = callFunc(angleSpec.func, newEngine(), args);
      angle = at(span, () => angleCast.cast(value));
    } else {
      angle = angleSpec.angle;
    }
  }
  // Inverting flips the line along the y-axis.
  if (invert) angle *= -1;

  // By default, the line is as long as the diagonal.
  const length = relRelativeTo(lengthScale, Math.hypot(body.x, body.y));

  // A vertical line of that length through the origin, rotated.
  const frame = Frame.soft(body);
  frame.push(point(0, length / 2), {
    kind: 'shape',
    shape: { geometry: { kind: 'line', to: point(0, -length) }, fill: null, stroke },
  });
  frame.transform(rotate(angle));
  return frame;
}
