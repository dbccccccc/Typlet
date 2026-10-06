// Typlet original: not ported from Typst.
//
// The HTML output (docs/DESIGN.md §2.1): frames laid out by Typlet, drawn with
// absolutely positioned glyphs and rules in ems.
//
// Each piece of a formula is an inline-block, as wide and tall as its frame
// and lowered by its descent, so that it sits on the text's baseline. Glyphs
// are absolutely positioned spans whose `::before` is a 1em strut: their
// baseline is exactly 1em below their top, whatever the browser does with
// the font's ascent. Glyphs that follow one another at their font advances
// merge into one run; the browser's kerning and ligatures are off, so it
// places them where Typst does. Rules are spans filled with the text color,
// boxes are spans with CSS borders, and links are transparent anchors over
// what they link. Black is the text's color, so formulas follow the page's.

import { type Color, toHex } from '../eval/color.js';
import { type Abs, absToPt } from '../eval/layout.js';
import { DEFAULT_FONT_SIZE } from '../ir/resolve.js';
import { UNITS_PER_EM, advance, drawingCodePoint } from '../layout/font.js';
import { type BoxBorder, type FixedStroke, type Frame, type Placed, IDENTITY, type Shape, type Size, type Transform, walkFrame } from '../layout/frame.js';
import type { NumberedBlock } from '../layout/math.js';
import type { InlineItem } from '../layout/run.js';

/** Lengths in ems of the formula's font size, with four decimals. */
function em(value: number): string {
  const rounded = Math.round(value * 10000) / 10000;
  return `${Object.is(rounded, -0) ? 0 : rounded}em`;
}

const BASE = absToPt(DEFAULT_FONT_SIZE);
const toEm = (abs: Abs): number => absToPt(abs) / BASE;

/** What drawing needs besides the frame: which links to keep. */
export interface DrawContext {
  /** Whether a link may be drawn: the `trust` option. */
  trust(url: string): boolean;
}

/** A color as CSS, or `null` for black, which is the text's color. */
function css(color: Color): string | null {
  const hex = toHex(color);
  return hex === '#000000' ? null : hex;
}

/** A run of glyphs on one baseline, in ems. */
interface Run {
  x: number;
  y: number;
  /** The font size, relative to the formula's. */
  scale: number;
  bold: boolean;
  fill: string | null;
  text: string;
  /** Where the next glyph goes if it continues the run. */
  end: number;
}

function escapeText(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

function escapeAttr(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A dash pattern as a repeating gradient along a rule, in the stroke's color. */
function dashes(stroke: FixedStroke, color: string): string {
  const dash = stroke.dash!;
  // An odd pattern repeats, so that dashes and gaps alternate.
  const array = dash.array.length % 2 === 1 ? [...dash.array, ...dash.array] : dash.array;
  let pos = -toEm(dash.phase);
  const stops: string[] = [];
  array.forEach((length, i) => {
    const next = pos + toEm(length);
    stops.push(`${i % 2 === 0 ? color : 'transparent'} ${em(pos)} ${em(next)}`);
    pos = next;
  });
  return `repeating-linear-gradient(90deg,${stops.join(',')})`;
}

/** A rule: a line drawn as a filled rectangle, rotated if it isn't straight. */
function rule(shape: Shape, t: Transform): string {
  if (shape.geometry.kind !== 'line' || !shape.stroke) return '';
  const stroke = shape.stroke;
  const at = (x: Abs, y: Abs) => ({ x: t.sx * x + t.kx * y + t.tx, y: t.ky * x + t.sy * y + t.ty });
  const from = at(0, 0);
  const to = at(shape.geometry.to.x, shape.geometry.to.y);
  const thickness = toEm(stroke.thickness);
  // Square caps extend the line by half its thickness at each end.
  const extension = stroke.cap === 'square' ? thickness / 2 : 0;
  const dx = toEm(to.x - from.x);
  const dy = toEm(to.y - from.y);
  const length = Math.hypot(dx, dy) + 2 * extension;
  const angle = Math.atan2(dy, dx);
  const color = css(stroke.paint);
  const style = [
    `left:${em(toEm(from.x) - extension * Math.cos(angle))}`,
    `top:${em(toEm(from.y) - extension * Math.sin(angle) - thickness / 2)}`,
    `width:${em(length)}`,
    `height:${em(thickness)}`,
  ];
  if (Math.abs(angle) > 1e-9) style.push(`transform:rotate(${Math.round(angle * 1e6) / 1e6}rad)`);
  if (stroke.dash && stroke.dash.array.length > 0) style.push(`background:${dashes(stroke, color ?? 'currentColor')}`);
  else if (color) style.push(`background:${color}`);
  return `<span class="r" style="${style.join(';')}"></span>`;
}

/** A border side as CSS: width, style and color. */
function border(stroke: FixedStroke | null): [string, string, string] {
  if (!stroke) return ['0', 'none', 'currentColor'];
  return [em(toEm(stroke.thickness)), stroke.dash && stroke.dash.array.length > 0 ? 'dashed' : 'solid', css(stroke.paint) ?? 'currentColor'];
}

/**
 * A rectangle or box, filled and stroked. The stroke is centered on the edge,
 * as in Typst: the span reaches half the stroke's thickness beyond it.
 */
function rect(shape: Shape, t: Transform): string {
  if (shape.geometry.kind === 'line') return '';
  const size: Size = shape.geometry.size;
  const strokes =
    shape.geometry.kind === 'box'
      ? shape.geometry.border.strokes
      : { left: shape.stroke, top: shape.stroke, right: shape.stroke, bottom: shape.stroke };
  const half = (s: FixedStroke | null) => (s ? toEm(s.thickness) / 2 : 0);
  const x = toEm(t.tx) - half(strokes.left);
  const y = toEm(t.ty) - half(strokes.top);
  const style = [
    `left:${em(x)}`,
    `top:${em(y)}`,
    `width:${em(toEm(size.x) + half(strokes.left) + half(strokes.right))}`,
    `height:${em(toEm(size.y) + half(strokes.top) + half(strokes.bottom))}`,
  ];
  const sides = [strokes.top, strokes.right, strokes.bottom, strokes.left].map(border);
  if (sides.every((s) => s.join() === sides[0]!.join())) {
    // The same all around; the border's color is the text's by default.
    const [width, line, color] = sides[0]!;
    if (width !== '0') style.push(`border:${width} ${line}${color === 'currentColor' ? '' : ` ${color}`}`);
  } else {
    style.push(`border-width:${sides.map((s) => s[0]).join(' ')}`);
    style.push(`border-style:${sides.map((s) => s[1]).join(' ')}`);
    style.push(`border-color:${sides.map((s) => s[2]).join(' ')}`);
  }
  if (shape.geometry.kind === 'box') {
    const r: BoxBorder['radius'] = shape.geometry.border.radius;
    const radii = [r['top-left'], r['top-right'], r['bottom-right'], r['bottom-left']];
    if (radii.some((v) => v !== 0)) style.push(`border-radius:${radii.map((v) => em(toEm(v))).join(' ')}`);
  }
  if (shape.fill) style.push(`background:${css(shape.fill) ?? 'currentColor'}`);
  return `<span class="x" style="${style.join(';')}"></span>`;
}

const isTranslation = (t: Transform) => t.sx === 1 && t.ky === 0 && t.kx === 0 && t.sy === 1;

/** The HTML of a frame's glyphs, rules, boxes and links, relative to its top-left corner. */
export function frameContent(frame: Frame, ctx: DrawContext): string {
  let out = '';
  let links = '';
  let run: Run | null = null;
  const flush = () => {
    if (!run) return;
    const r = run;
    // Positions are in the run's own ems, which its font size scales.
    const style = [`left:${em(r.x / r.scale)}`, `top:${em(r.y / r.scale - 1)}`];
    if (r.scale !== 1) style.unshift(`font-size:${em(r.scale)}`);
    if (r.fill) style.push(`color:${r.fill}`);
    out += `<span class="${r.bold ? 'g b' : 'g'}" style="${style.join(';')}">${escapeText(r.text)}</span>`;
    run = null;
  };
  walkFrame(frame, IDENTITY, (placed: Placed) => {
    if (placed.kind === 'link') {
      // Links go over the content, so that they can be clicked.
      if (!isTranslation(placed.transform) || !ctx.trust(placed.dest)) return;
      const style = `left:${em(toEm(placed.transform.tx))};top:${em(toEm(placed.transform.ty))};width:${em(toEm(placed.size.x))};height:${em(toEm(placed.size.y))}`;
      links += `<a class="l" href="${escapeAttr(placed.dest)}" style="${style}"></a>`;
      return;
    }
    if (placed.kind === 'shape') {
      flush();
      if (placed.shape.geometry.kind === 'line') out += rule(placed.shape, placed.transform);
      else if (isTranslation(placed.transform)) out += rect(placed.shape, placed.transform);
      return;
    }
    const t = placed.transform;
    if (!isTranslation(t)) return;
    const cp = drawingCodePoint(placed.id, placed.font);
    if (cp === undefined) return;
    const char = String.fromCodePoint(cp);
    const x = toEm(placed.at.x);
    const y = toEm(placed.at.y);
    const scale = absToPt(placed.size) / BASE;
    const fill = css(placed.fill);
    const bold = placed.font === 'bold';
    const width = (advance(placed.id, placed.font) / UNITS_PER_EM) * scale;
    if (run && run.y === y && run.scale === scale && run.bold === bold && run.fill === fill && Math.abs(run.end - x) < 1e-7) {
      run.text += char;
      run.end = x + width;
      return;
    }
    flush();
    run = { x, y, scale, bold, fill, text: char, end: x + width };
  });
  flush();
  return out + links;
}

/** A frame as an inline-block on the baseline, with space after it. */
export function frameBox(frame: Frame, ctx: DrawContext, space = 0): string {
  let style = `width:${em(toEm(frame.width))};height:${em(toEm(frame.height))};vertical-align:${em(-toEm(frame.descent))}`;
  if (space !== 0) style += `;margin-right:${em(space)}`;
  return `<span class="f" style="${style}">${frameContent(frame, ctx)}</span>`;
}

/**
 * The HTML of an inline formula's pieces, which lines can break between.
 * Typst drops the space after a piece where a line breaks; here it is the
 * piece's right margin, so that it stays at the end of the line and never
 * indents the next one.
 */
export function inlineHtml(items: InlineItem[], ctx: DrawContext): string {
  const pieces: { frame: Frame; space: number }[] = [];
  for (const item of items) {
    const last = pieces.at(-1);
    if (item.kind === 'frame') pieces.push({ frame: item.frame, space: 0 });
    else if (last) last.space += toEm(item.width);
  }
  return pieces.map((piece) => frameBox(piece.frame, ctx, piece.space)).join('');
}

/**
 * A numbered display equation as a row: the equation between two boxes as
 * wide as the number and its gap, the number in the one on its side. In a
 * line of the page's width, the boxes grow alike, which keeps the equation
 * centered and puts the number at the edge; shrunk to fit, the row is laid
 * out as Typst lays out a page as wide as the equation.
 */
export function numberedHtml(block: NumberedBlock, ctx: DrawContext): string {
  const box = (frame: Frame, top: Abs) => {
    const style = `width:${em(toEm(frame.width))};height:${em(toEm(frame.height))};margin-top:${em(toEm(top))}`;
    return `<span class="f" style="${style}">${frameContent(frame, ctx)}</span>`;
  };
  // The equation and the number are aligned at their tops, offset as Typst places them.
  const equation = box(block.equation, Math.max(0, -block.numberTop));
  const number = box(block.number, Math.max(0, block.numberTop));
  // The sides are at least as wide as the number and its gap, which every
  // engine counts when it shrinks the row to fit.
  const width = `min-width:${em(toEm(block.numberWidth))}`;
  const side = (content: string, end: boolean) =>
    `<span class="t" style="${end ? `${width};justify-content:flex-end` : width}">${content}</span>`;
  return block.side === 'end' ? side('', false) + equation + side(number, true) : side(number, false) + equation + side('', false);
}
