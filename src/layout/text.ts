// Ported from Typst 0.15.1: crates/typst-layout/src/math/text.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// Text, numbers and glyphs in math. Typst lays out text with its paragraph
// layout; Typlet sets text as one line of glyphs from the math font, which
// is what that layout gives for text in math. Paragraphs shape text in its
// own script, such as Latin, where New Computer Modern has no `ssty`: text
// keeps its glyphs in scripts.

import type { StyleChain } from '../eval/styles.js';
import { styleDtls, styleFlac, equationBold, equationItalic, equationVariant } from '../elements/style.js';
import { chain } from '../eval/styles.js';
import { emAt } from '../eval/layout.js';
import type { ComponentItem, GlyphKind, MathProperties } from '../ir/item.js';
import { fontSize, textFill, textShift } from '../ir/resolve.js';
import { MathClass } from '../utils/math-class.js';
import { selectStyle, toStyle } from '../utils/styling.js';
import { FrameFragment, GlyphFragment } from './fragment.js';
import { decorate, shapeText, textEdge } from './inline.js';
import { Frame, point } from './frame.js';
import type { MathContext } from './math.js';
import { runIntoFrame } from './run.js';

/** Lays out text as one line, like a paragraph in math, from `layout_text`. */
export function layoutText(text: string, ctx: MathContext, styles: StyleChain, props: MathProperties): void {
  const size = fontSize(styles);
  const { face, glyphs } = shapeText(text, styles, props.span);
  // Text in math has its glyphs' bounds as its top and bottom edges.
  const top = textEdge('bounds', true, size, glyphs, face);
  const bottom = textEdge('bounds', false, size, glyphs, face);
  let width = 0;
  for (const g of glyphs) width += emAt(g.xAdvance, size);
  const frame = Frame.soft({ x: width, y: top + bottom });
  frame.setBaseline(top);
  if (glyphs.length > 0) {
    frame.push(point(0, top + textShift(styles)), { kind: 'text', text: { font: face, size, fill: textFill(styles), text, glyphs } });
  }
  decorate(frame, styles, glyphs, face, size, width, top);
  ctx.push(new FrameFragment(props, styles, frame).withTextLike(true));
}

/** Lays out a number, digit by digit, like `layout_number`. */
export function layoutNumber(text: string, ctx: MathContext, styles: StyleChain, props: MathProperties): void {
  const fragments = [...text].map((c) => GlyphFragment.synthetic(styles, c, props.span));
  ctx.push(new FrameFragment(props, styles, runIntoFrame(fragments)).withTextLike(true));
}

/** The non-dotless letter of a dotless one, for the `dtls` feature, like `try_dotless`. */
function tryDotless(c: string): string | null {
  switch (c) {
    case 'ı':
    case '𝚤':
      return 'i';
    case 'ȷ':
    case '𝚥':
      return 'j';
    default:
      return null;
  }
}

/** Lays out a glyph, stretched if it should be, like `layout_glyph`. */
export function layoutGlyph(
  _item: ComponentItem,
  kind: GlyphKind,
  ctx: MathContext,
  styles: StyleChain,
  props: MathProperties,
): void {
  let glyphStyles = kind.flac ? chain(styles, [styleFlac()]) : styles;
  let text = kind.text;
  // New Computer Modern has the `dtls` feature: dotless letters become
  // their dotted letters, which the feature turns back.
  if ([...text].some((c) => tryDotless(c) !== null)) {
    glyphStyles = chain(glyphStyles, [styleDtls()]);
    const variant = equationVariant(glyphStyles);
    const bold = equationBold(glyphStyles);
    const italic = equationItalic(glyphStyles);
    text = [...text]
      .map((c) => {
        const d = tryDotless(c) ?? c;
        return toStyle(d.codePointAt(0)!, selectStyle(d.codePointAt(0)!, variant, bold, italic));
      })
      .join('');
  }

  const glyph = GlyphFragment.create(text, kind.stretch, glyphStyles, props, kind.class, (message) =>
    ctx.warn(props.span, message),
  );
  // Large operators are always centered on the axis (TeXbook, p. 155).
  if (glyph.class === MathClass.Large) glyph.centerOnAxis();
  glyph.class = props.class ?? MathClass.Normal;
  ctx.push(glyph);
}
