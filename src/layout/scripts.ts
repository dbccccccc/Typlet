// Ported from Typst 0.15.1: crates/typst-layout/src/math/scripts.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import type { Abs } from '../eval/layout.js';
import { emAt } from '../eval/layout.js';
import type { StyleChain } from '../eval/styles.js';
import { equationCramped } from '../elements/style.js';
import { type MathItem, type MathKind, type MathProperties, PRIME_CHAR, setStretchRelativeTo } from '../ir/item.js';
import { fontSize } from '../ir/resolve.js';
import { MATH_CONSTANTS } from './font.js';
import { type Corner, FrameFragment, GlyphFragment, type MathFragment } from './fragment.js';
import { Frame, point } from './frame.js';
import type { MathContext } from './math.js';

type ScriptsKind = Extract<MathKind, { tag: 'scripts' }>;
type Maybe = MathFragment | null;

const measure = (f: Maybe, key: 'width' | 'ascent' | 'descent'): Abs => (f ? f[key] : 0);
const constant = (name: keyof typeof MATH_CONSTANTS, size: Abs): Abs => emAt(MATH_CONSTANTS[name] as number, size);

/** Lays out a base with attachments, like `layout_scripts`. */
export function layoutScripts(item: ScriptsKind, ctx: MathContext, styles: StyleChain, props: MathProperties): void {
  const layout = (script: MathItem | null): Maybe => (script ? ctx.layoutIntoFragment(script, styles) : null);

  // The limits come first: a stretched base is relative to their width.
  const t = layout(item.top);
  const b = layout(item.bottom);
  setStretchRelativeTo(item.base, Math.max(measure(t, 'width'), measure(b, 'width')), 'x');
  const base = ctx.layoutIntoFragment(item.base, styles);

  const tl = layout(item.topLeft);
  const tr = layout(item.topRight);
  const bl = layout(item.bottomLeft);
  const br = layout(item.bottomRight);
  const baseStyles = item.base.type === 'component' ? item.base.styles : styles;
  layoutAttachments(ctx, props, baseStyles, base, [tl, t, tr, bl, b, br]);
}

/** Lays out primes, as glyphs half a prime's width apart, like `layout_primes`. */
export function layoutPrimes(count: number, ctx: MathContext, styles: StyleChain, props: MathProperties): void {
  const prime = GlyphFragment.synthetic(styles, PRIME_CHAR, props.span).intoFrame();
  const width = (prime.width * (count + 1)) / 2;
  const frame = Frame.soft({ x: width, y: prime.height });
  frame.setBaseline(prime.ascent);
  for (let i = 0; i < count; i++) frame.pushFrame(point(prime.width * (i / 2), 0), prime);
  ctx.push(new FrameFragment(props, styles, frame).withTextLike(true));
}

/** Lays out the attachments around a base, like `layout_attachments`. */
function layoutAttachments(
  ctx: MathContext,
  props: MathProperties,
  styles: StyleChain,
  base: MathFragment,
  [tl, t, tr, bl, b, br]: [Maybe, Maybe, Maybe, Maybe, Maybe, Maybe],
): void {
  const size = base.fontSize ?? fontSize(styles);
  const cramped = equationCramped(styles);

  // The distance from the base's baseline to the scripts' baselines.
  const [txShift, bxShift] =
    !tl && !tr && !bl && !br ? [0, 0] : computeScriptShifts(size, cramped, base, [tl, tr, bl, br]);

  // The distance from the base's baseline to the limits' baselines.
  const [tShift, bShift] = computeLimitShifts(size, base, t, b);

  // The frame's height.
  const ascent = Math.max(
    base.ascent,
    txShift + measure(tr, 'ascent'),
    txShift + measure(tl, 'ascent'),
    tShift + measure(t, 'ascent'),
  );
  const descent = Math.max(
    base.descent,
    bxShift + measure(br, 'descent'),
    bxShift + measure(bl, 'descent'),
    bShift + measure(b, 'descent'),
  );
  const height = ascent + descent;

  // Each element's vertical position.
  const baseY = ascent - base.ascent;
  const txY = (f: MathFragment) => ascent - txShift - f.ascent;
  const bxY = (f: MathFragment) => ascent + bxShift - f.ascent;
  const tY = (f: MathFragment) => ascent - tShift - f.ascent;
  const bY = (f: MathFragment) => ascent + bShift - f.ascent;

  // How far each limit extends beyond the base's width.
  const [[tPre, tPost], [bPre, bPost]] = computeLimitWidths(base, t, b);

  // Extra spacing before each pre-script and after each post-script.
  const spaceAfterScript = constant('spaceAfterScript', size);

  const [tlPre, blPre] = computePreScriptWidths(base, tl, bl, txShift, bxShift, spaceAfterScript);
  const [[trPost, trKern], [brPost, brKern]] = computePostScriptWidths(base, tr, br, txShift, bxShift, spaceAfterScript);

  // The frame's width.
  const preWidth = Math.max(tPre, bPre, tlPre, blPre);
  const baseWidth = base.width;
  const postWidth = Math.max(tPost, bPost, trPost, brPost);
  const width = preWidth + baseWidth + postWidth;

  // Each element's horizontal position.
  const baseX = preWidth;
  const tlX = preWidth - tlPre + spaceAfterScript;
  const blX = preWidth - blPre + spaceAfterScript;
  const trX = preWidth + baseWidth + trKern;
  const brX = preWidth + baseWidth + brKern;
  const tX = preWidth - tPre;
  const bX = preWidth - bPre;

  const frame = Frame.soft({ x: width, y: height });
  frame.setBaseline(ascent);
  frame.pushFrame(point(baseX, baseY), base.intoFrame());
  const place = (f: Maybe, x: Abs, y: (f: MathFragment) => Abs) => {
    if (f) frame.pushFrame(point(x, y(f)), f.intoFrame());
  };
  place(tl, tlX, txY); // pre-superscript
  place(bl, blX, bxY); // pre-subscript
  place(tr, trX, txY); // post-superscript
  place(br, brX, bxY); // post-subscript
  place(t, tX, tY); // upper limit
  place(b, bX, bY); // lower limit

  ctx.push(new FrameFragment(props, styles, frame));
}

/**
 * How far each post-script extends beyond the base, and its kern, like
 * `compute_post_script_widths`.
 */
function computePostScriptWidths(
  base: MathFragment,
  tr: Maybe,
  br: Maybe,
  trShift: Abs,
  brShift: Abs,
  spaceAfterPostScript: Abs,
): [[Abs, Abs], [Abs, Abs]] {
  const trValues: [Abs, Abs] = tr
    ? (() => {
        const kern = mathKern(base, tr, trShift, 'topRight');
        return [spaceAfterPostScript + tr.width + kern, kern];
      })()
    : [0, 0];
  // The base's bounds include its italic correction, so the subscript moves
  // left by it (see the MATH table's kerning algorithm).
  const brValues: [Abs, Abs] = br
    ? (() => {
        const kern = mathKern(base, br, brShift, 'bottomRight') - base.italicsCorrection;
        return [spaceAfterPostScript + br.width + kern, kern];
      })()
    : [0, 0];
  return [trValues, brValues];
}

/** How far each pre-script extends beyond the base, like `compute_pre_script_widths`. */
function computePreScriptWidths(
  base: MathFragment,
  tl: Maybe,
  bl: Maybe,
  tlShift: Abs,
  blShift: Abs,
  spaceBeforePreScript: Abs,
): [Abs, Abs] {
  const tlPre = tl ? spaceBeforePreScript + tl.width + mathKern(base, tl, tlShift, 'topLeft') : 0;
  const blPre = bl ? spaceBeforePreScript + bl.width + mathKern(base, bl, blShift, 'bottomLeft') : 0;
  return [tlPre, blPre];
}

/** How far each limit extends beyond the base, on each side, like `compute_limit_widths`. */
function computeLimitWidths(base: MathFragment, t: Maybe, b: Maybe): [[Abs, Abs], [Abs, Abs]] {
  // The upper (lower) limit shifts right (left) of the base's center by half
  // its italic correction.
  const delta = base.italicsCorrection / 2;
  const tWidths: [Abs, Abs] = t
    ? (() => {
        const half = (t.width - base.width) / 2;
        return [half - delta, half + delta];
      })()
    : [0, 0];
  const bWidths: [Abs, Abs] = b
    ? (() => {
        const half = (b.width - base.width) / 2;
        return [half + delta, half - delta];
      })()
    : [0, 0];
  return [tWidths, bWidths];
}

/** The distance from the base's baseline to each limit's baseline, like `compute_limit_shifts`. */
function computeLimitShifts(size: Abs, base: MathFragment, t: Maybe, b: Maybe): [Abs, Abs] {
  const tShift = t
    ? base.ascent + Math.max(constant('upperLimitBaselineRiseMin', size), constant('upperLimitGapMin', size) + t.descent)
    : 0;
  const bShift = b
    ? base.descent + Math.max(constant('lowerLimitBaselineDropMin', size), constant('lowerLimitGapMin', size) + b.ascent)
    : 0;
  return [tShift, bShift];
}

/** The distance from the base's baseline to the scripts' baselines, like `compute_script_shifts`. */
function computeScriptShifts(
  size: Abs,
  cramped: boolean,
  base: MathFragment,
  [tl, tr, bl, br]: [Maybe, Maybe, Maybe, Maybe],
): [Abs, Abs] {
  const supShiftUp = constant(cramped ? 'superscriptShiftUpCramped' : 'superscriptShiftUp', size);
  const supBottomMin = constant('superscriptBottomMin', size);
  const supBottomMaxWithSub = constant('superscriptBottomMaxWithSubscript', size);
  const supDropMax = constant('superscriptBaselineDropMax', size);
  const gapMin = constant('subSuperscriptGapMin', size);
  const subShiftDown = constant('subscriptShiftDown', size);
  const subTopMax = constant('subscriptTopMax', size);
  const subDropMin = constant('subscriptBaselineDropMin', size);

  let shiftUp = 0;
  let shiftDown = 0;
  const textLike = base.isTextLike();

  if (tl || tr) {
    const ascent = base.baseAscent;
    shiftUp = Math.max(
      shiftUp,
      supShiftUp,
      textLike ? 0 : ascent - supDropMax,
      supBottomMin + measure(tl, 'descent'),
      supBottomMin + measure(tr, 'descent'),
    );
  }

  if (bl || br) {
    const descent = base.baseDescent;
    shiftDown = Math.max(
      shiftDown,
      subShiftDown,
      textLike ? 0 : descent + subDropMin,
      measure(bl, 'ascent') - subTopMax,
      measure(br, 'ascent') - subTopMax,
    );
  }

  for (const [sup, sub] of [
    [tl, bl],
    [tr, br],
  ] as const) {
    if (!sup || !sub) continue;
    const supBottom = shiftUp - sup.descent;
    const subTop = sub.ascent - shiftDown;
    const gap = supBottom - subTop;
    if (gap >= gapMin) continue;
    const increase = gapMin - gap;
    const supOnly = Math.min(Math.max(supBottomMaxWithSub - supBottom, 0), increase);
    const rest = (increase - supOnly) / 2;
    shiftUp += supOnly + rest;
    shiftDown += rest;
  }

  return [shiftUp, shiftDown];
}

const INVERSE: Record<Corner, Corner> = {
  topLeft: 'bottomRight',
  topRight: 'bottomLeft',
  bottomRight: 'topLeft',
  bottomLeft: 'topRight',
};

/**
 * The kern of a script against the base: positive moves it away, negative
 * closer. Follows the MATH table's MathKernInfo algorithm, like `math_kern`.
 */
function mathKern(base: MathFragment, script: MathFragment, shift: Abs, pos: Corner): Abs {
  // Two correction heights: for superscripts, from the superscript's
  // baseline to the top of the base, and from the base's baseline to the
  // bottom of the superscript; for subscripts, the other way around.
  const [top, bottom] =
    pos === 'topLeft' || pos === 'topRight'
      ? [base.ascent - shift, shift - script.descent]
      : [script.ascent - shift, shift - base.descent];
  const summed = (height: Abs) => base.kernAtHeight(pos, height) + script.kernAtHeight(INVERSE[pos], height);
  // The smaller kern (the larger value); the spec says minimum but means this.
  return Math.max(summed(top), summed(bottom));
}
