// Ported from Typst 0.15.1: crates/typst-layout/src/inline/box.rs, crates/typst-layout/src/inline/deco.rs, crates/typst-layout/src/inline/finalize.rs, crates/typst-layout/src/inline/line.rs, crates/typst-layout/src/inline/shaping.rs, crates/typst-layout/src/pad.rs, crates/typst-layout/src/shapes.rs, crates/typst-library/src/text/font/mod.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// Inline content outside math: the bodies of boxes, equation numbers and
// smart quotes. Typst lays these out with its paragraph layout; Typlet sets
// them as one line, which is what that layout gives in a formula, where
// lines have all the width they need. Text is shaped as Typst shapes it in
// New Computer Modern Math: each character's glyph at its advance, with
// neither kerning nor ligatures.

import type { Color } from '../eval/color.js';
import type { BoxElem, Content, Corners, Sides, Stroke, TextEdge } from '../eval/content.js';
import { ElementBudget, type SourceDiagnostic, type Span, unsupported } from '../eval/diag.js';
import { type Abs, type Length, REL_ONE, type RelLength, ZERO_LENGTH, emAt, lengthAt } from '../eval/layout.js';
import { type StyleChain, chain, get, property } from '../eval/styles.js';
import { MathSize } from '../elements/style.js';
import { MATH_FAMILIES } from '../elements/text.js';
import { SmartQuoter, isRtlLanguage, smartQuotesIn } from '../mathml/external.js';
import { isDefaultIgnorable, isMark } from '../syntax/unicode.js';
import {
  type FrameModifiers,
  type HighlightDeco,
  type Pair,
  checkSize,
  collapseSpaces,
  fontFace,
  fontSize,
  frameModifiers,
  resolveEquation,
  shownStyles,
  textFill,
  textShift,
} from '../ir/resolve.js';
import { resolveStroke } from './cancel.js';
import { FONT_METRICS, type FontFace, advance, boundingBox, hasGlyph, shapeMath } from './font.js';
import { missingGlyph, modifyFrame, toEm } from './fragment.js';
import { type BoxBorder, type FixedStroke, Frame, type Glyph, type Point, type Shape, point } from './frame.js';
import { layoutInline } from './math.js';

/** One item of a line: shaped text, a frame on the baseline, or spacing. */
type LineItem =
  | { readonly kind: 'text'; readonly text: string; readonly styles: StyleChain; readonly span: Span }
  | { readonly kind: 'frame'; readonly frame: Frame }
  | { readonly kind: 'space'; readonly width: Abs };

/** What collecting a paragraph needs. */
interface Collector {
  readonly budget: ElementBudget;
  readonly items: LineItem[];
  readonly warnings: SourceDiagnostic[];
  readonly quoter: SmartQuoter;
  /** The width of the paragraph's region, which boxes and equations in it get; `null` for no limit. */
  readonly region: Abs | null;
  /** The text so far, for smart quotes. */
  full: string;
}

/**
 * Lays out inline content as one line, with its baseline, like a paragraph in
 * a formula: `width` wide where a box sets its width, or else as wide as its
 * content, but no wider than its region, as Typst's `finalize` sizes it.
 */
export function layoutParagraph(
  content: Content,
  styles: StyleChain,
  warnings: SourceDiagnostic[],
  width: Abs | null = null,
  region: Abs | null = null,
): Frame {
  // Typlet has no bidirectional layout, and a right-to-left paragraph starts at the right.
  if (isRtlLanguage(get(styles, 'text', 'lang', 'en'))) unsupported(content.span, 'right-to-left paragraphs in HTML output yet');
  const available = width ?? region;
  const collector: Collector = { budget: new ElementBudget(), items: [], warnings, quoter: new SmartQuoter(), region: available, full: '' };
  for (const [elem, elemStyles] of realizeParagraph(content, styles, collector.budget)) collect(elem, elemStyles, collector);
  const items = trimSpaces(collector.items);
  const line = buildLine(items, get(styles, 'align', 'alignment', 'start'), width, region);
  // Typst breaks a line that doesn't fit its region where it can: at a
  // space, or between the pieces of an inline equation. Typlet lays out one
  // line.
  if (available !== null && line.naturalWidth > available + 1e-6 && items.some((item) => item.kind === 'space' || (item.kind === 'text' && item.text.includes(' ')))) {
    unsupported(content.span, 'text that wraps in a box in HTML output yet');
  }
  return line.frame;
}

/**
 * Flattens a paragraph's content into elements with their styles, applying
 * the paged show rules of `strong` and the like, and collapses its spaces as
 * Typst's realization does: none at the start or end, none next to a line
 * break or weak spacing, and one where several meet.
 */
function realizeParagraph(content: Content, styles: StyleChain, budget: ElementBudget): Pair[] {
  const pairs: Pair[] = [];
  const flatten = (c: Content, s: StyleChain): void => {
    switch (c.func) {
      case 'sequence':
        budget.visit(c.span);
        for (const child of c.children) flatten(child, s);
        return;
      case 'styled':
        budget.visit(c.span);
        flatten(c.child, chain(s, c.styles));
        return;
      case 'strong':
      case 'emph':
      case 'highlight':
      case 'link':
      case 'hide':
        budget.visit(c.span);
        flatten(c.body, chain(s, shownStyles(c, s)));
        return;
      default:
        pairs.push([c, s]);
    }
  };
  flatten(content, styles);
  collapseSpaces(pairs);
  return pairs;
}

/** How much a character hangs into the end margin, as a share of its advance, like `overhang`. */
function overhang(c: string): number {
  switch (c) {
    case '–':
    case '—':
      return 0.2;
    case '-':
    case '­':
      return 0.55;
    case '.':
    case ',':
      return 0.8;
    case ':':
    case ';':
      return 0.3;
    case '،':
    case '۔':
      return 0.4;
    default:
      return 0;
  }
}

/** Flattens content into line items, applying show rules as paged realization does. */
function collect(content: Content, styles: StyleChain, c: Collector): void {
  c.budget.visit(content.span);
  const text = (s: string, span: Span) => {
    // Text in the same styles is one run, as shaping gives it.
    const last = c.items.at(-1);
    if (last?.kind === 'text' && last.styles === styles) c.items[c.items.length - 1] = { ...last, text: last.text + s };
    else c.items.push({ kind: 'text', text: s, styles, span });
    c.full += s;
  };
  switch (content.func) {
    case 'sequence':
      for (const child of content.children) collect(child, styles, c);
      return;
    case 'styled':
      collect(content.child, chain(styles, content.styles), c);
      return;
    case 'text':
    case 'symbol':
      return text(content.text, content.span);
    case 'space':
      return text(' ', content.span);
    case 'smartquote': {
      const before = [...c.full].reverse().find((ch) => !isDefaultIgnorable(ch.codePointAt(0)!));
      return text(c.quoter.quote(before, content.double ?? true, smartQuotesIn(styles)), content.span);
    }
    case 'strong':
      return collect(content.body, chain(styles, [property('text', 'delta', content.delta ?? get(styles, 'strong', 'delta', 300))]), c);
    case 'emph':
      return collect(content.body, chain(styles, [property('text', 'emph', true)]), c);
    case 'hide':
      return collect(content.body, chain(styles, [property('hide', 'hidden', true)]), c);
    case 'link':
      return collect(content.body, chain(styles, [property('link', 'current', content.dest)]), c);
    case 'equation': {
      if (content.block) unsupported(content.span, 'display equations in boxes yet');
      const eqStyles = chain(styles, [
        property('equation', 'size', MathSize.Text),
        property('text', 'weight', 450),
        property('text', 'font', MATH_FAMILIES),
      ]);
      const item = resolveEquation(content.body, eqStyles, c.warnings);
      for (const piece of layoutInline(item, c.warnings, eqStyles, c.region)) {
        c.items.push(piece.kind === 'frame' ? piece : { kind: 'space', width: piece.width });
      }
      c.full += '￼';
      return;
    }
    case 'box': {
      const frame = layoutBox(content, styles, c.warnings, c.region);
      applyShift(frame, styles);
      c.items.push({ kind: 'frame', frame });
      c.full += '￼';
      return;
    }
    case 'h': {
      const amount = content.amount;
      if ('fr' in amount || amount.rel.rel !== 0) unsupported(content.span, 'relative spacing in boxes yet');
      const size = fontSize(styles);
      const width = lengthAt(amount.rel.abs, size);
      checkSize(width, size, content.span);
      c.items.push({ kind: 'space', width });
      return;
    }
    default:
      unsupported(content.span, `${content.func} in boxes in HTML output yet`);
  }
}

/** Leaves out spaces at the start and end of the line and merges runs of them, as realization does. */
function trimSpaces(items: LineItem[]): LineItem[] {
  return items
    .map((item) => (item.kind === 'text' ? { ...item, text: item.text.replace(/ {2,}/g, ' ') } : item))
    .map((item, i, all) => {
      if (item.kind !== 'text') return item;
      let text = item.text;
      if (i === 0) text = text.replace(/^ /, '');
      if (i === all.length - 1) text = text.replace(/ $/, '');
      return { ...item, text };
    })
    .filter((item) => item.kind !== 'text' || item.text !== '');
}

// Text that starts and ends with letters, which bidirectional layout leaves
// in order in a right-to-left language. Other text there has punctuation or
// brackets that move to the other side or mirror.
const LETTERS_AT_EDGES = /^\p{L}(?:.*\p{L})?\p{M}*$/su;

/**
 * Shapes text in the face its styles select, like `shape`: each cluster, a
 * character and the combining marks after it, becomes its glyphs at their
 * advances. Then tracking and spacing apply.
 */
export function shapeText(text: string, styles: StyleChain, span: Span): { face: FontFace; glyphs: Glyph[] } {
  const face = fontFace(styles, span);
  if (isRtlLanguage(get(styles, 'text', 'lang', 'en')) && !LETTERS_AT_EDGES.test(text)) {
    unsupported(span, 'right-to-left text in HTML output yet');
  }
  const glyphs: Glyph[] = [];
  for (let i = 0; i < text.length; ) {
    let end = i + (text.codePointAt(i)! > 0xffff ? 2 : 1);
    while (end < text.length) {
      const next = text.codePointAt(end)!;
      if (!isMark(next)) break;
      end += next > 0xffff ? 2 : 1;
    }
    const cluster = text.slice(i, end);
    const ids = shapeMath(cluster, 0, false, face);
    if (ids === null || ids.some((id) => !hasGlyph(id, face))) unsupported(span, missingGlyph(cluster, face));
    for (const id of ids) glyphs.push({ id, xAdvance: toEm(advance(id, face)), xOffset: 0, yAdvance: 0, yOffset: 0, range: [i, end] });
    i = end;
  }
  trackAndSpace(text, glyphs, styles);
  return { face, glyphs };
}

/**
 * Widens spaces by the text's spacing and adds its tracking after each
 * cluster but the last of each run, like `track_and_space`. New Computer
 * Modern Math's no-break space is as wide as its space, so it needs no
 * adjustment.
 */
function trackAndSpace(text: string, glyphs: Glyph[], styles: StyleChain): void {
  const tracking = get<Length>(styles, 'text', 'tracking', ZERO_LENGTH);
  const spacing = get<RelLength>(styles, 'text', 'spacing', REL_ONE);
  if (tracking.abs === 0 && tracking.em === 0 && spacing.rel === 1 && spacing.abs.abs === 0 && spacing.abs.em === 0) return;
  const size = fontSize(styles);
  // Like `Em::from_abs`, which is zero where the size is.
  const toEms = (abs: Abs): number => (Number.isFinite(abs / size) ? abs / size : 0);
  const track = toEms(lengthAt(tracking, size));
  const extra = toEms(lengthAt(spacing.abs, size));
  // A script set by hand keeps the text in one run.
  const runs = get<string | null>(styles, 'text', 'script', null) === null ? scriptRunStarts(text) : new Set<number>();
  for (let i = 0; i < glyphs.length; i++) {
    const glyph = glyphs[i]!;
    const c = text.codePointAt(glyph.range[0]);
    if (c === 0x20 || c === 0xa0 || c === 0x3000) glyph.xAdvance = spacing.rel * glyph.xAdvance + extra;
    const next = glyphs[i + 1];
    if (next !== undefined && next.range[0] !== glyph.range[0] && !runs.has(next.range[0])) glyph.xAdvance += track;
  }
}

/** Characters of no specific script, which join the run around them. */
const GENERIC_SCRIPT = /^[\p{Script=Common}\p{Script=Inherited}\p{Script=Unknown}]$/u;
/**
 * The scripts New Computer Modern Math has letters of, as regular expressions
 * made on first use. Characters of other scripts have no glyph.
 */
let scripts: (readonly [string, RegExp])[] | undefined;

/** A character's script, or `null` for one that isn't specific. */
function scriptOf(c: string): string | null {
  // ASCII letters are Latin, and the other ASCII characters common.
  const cp = c.codePointAt(0)!;
  if (cp < 0x80) return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) ? 'Latin' : null;
  if (GENERIC_SCRIPT.test(c)) return null;
  scripts ??= ['Latin', 'Greek', 'Cyrillic', 'Hebrew', 'Arabic', 'Devanagari'].map((name) => [name, new RegExp(`^\\p{Script=${name}}$`, 'u')] as const);
  return scripts.find(([, test]) => test.test(c))?.[0] ?? 'other';
}

/**
 * Where text starts new shaping runs, as `shape_range` splits it: where a
 * specific script follows another. Characters of no specific script join the
 * run they are in.
 */
function scriptRunStarts(text: string): Set<number> {
  const starts = new Set<number>();
  let prev: string | null = null;
  for (let i = 0; i < text.length; ) {
    const c = String.fromCodePoint(text.codePointAt(i)!);
    const script = scriptOf(c);
    if (script !== null && prev !== null && script !== prev) {
      starts.add(i);
      prev = script;
    } else if (prev === null) {
      prev = script;
    }
    i += c.length;
  }
  return starts;
}

/** A top or bottom edge of text, both positive away from the baseline, like `Font::edges`. */
export function textEdge(edge: TextEdge, top: boolean, size: Abs, glyphs: readonly Glyph[], face: FontFace): Abs {
  if (typeof edge !== 'string') return (top ? 1 : -1) * lengthAt(edge, size);
  switch (edge) {
    case 'ascender':
      return emAt(FONT_METRICS.ascender, size);
    case 'cap-height':
      return emAt(FONT_METRICS.capHeight, size);
    case 'x-height':
      return emAt(FONT_METRICS.xHeight, size);
    case 'descender':
      return -emAt(FONT_METRICS.descender, size);
    case 'baseline':
      return 0;
    default: {
      // The glyphs' bounds.
      let extent = 0;
      for (const glyph of glyphs) {
        const box = boundingBox(glyph.id, face);
        if (box) extent = Math.max(extent, emAt(toEm(top ? box.yMax : -box.yMin), size));
      }
      return extent;
    }
  }
}

/** A run of text as a frame from its top edge to its bottom edge, with decorations. */
function textFrame(item: Extract<LineItem, { kind: 'text' }>): Frame {
  const { face, glyphs } = shapeText(item.text, item.styles, item.span);
  const size = fontSize(item.styles);
  const top = textEdge(get<TextEdge>(item.styles, 'text', 'top-edge', 'cap-height'), true, size, glyphs, face);
  const bottom = textEdge(get<TextEdge>(item.styles, 'text', 'bottom-edge', 'baseline'), false, size, glyphs, face);
  let width = 0;
  for (const glyph of glyphs) width += emAt(glyph.xAdvance, size);
  const frame = Frame.soft({ x: width, y: top + bottom });
  frame.setBaseline(top);
  const text = { font: face, size, fill: textFill(item.styles), text: item.text, glyphs };
  // A shifted baseline moves the glyphs, not the frame or its highlights.
  if (glyphs.length > 0) frame.push(point(0, top + textShift(item.styles)), { kind: 'text', text });
  decorate(frame, item.styles, text.glyphs, face, size, width, top);
  modifyText(frame, frameModifiers(item.styles), item.styles);
  return frame;
}

/**
 * Moves an inline frame, its content and its baseline, down by the text's
 * baseline shift, like `apply_shift`. Its glyphs, shifted already, then sit
 * as far below the line's baseline as in the frame.
 */
export function applyShift(frame: Frame, styles: StyleChain): void {
  frame.translate(point(0, textShift(styles)));
}

/** Applies hidden content and links to a text frame; links reach half the leading above and below. */
function modifyText(frame: Frame, modifiers: FrameModifiers, styles: StyleChain): void {
  if (modifiers.link === null) return modifyFrame(frame, modifiers);
  // Typst's paragraphs extend links by half their leading, 0.65em.
  const expand = 0.5 * emAt(0.65, fontSize(styles));
  frame.push(point(0, -expand), { kind: 'link', dest: modifiers.link, size: { x: frame.width, y: frame.height + 2 * expand } });
  if (modifiers.hidden) frame.hide();
}

/** Draws text's highlights behind it, like `decorate`. */
export function decorate(frame: Frame, styles: StyleChain, glyphs: readonly Glyph[], face: FontFace, size: Abs, width: Abs, baseline: Abs): void {
  const decos: HighlightDeco[] = [];
  for (let link: StyleChain | null = styles; link; link = link.tail) {
    for (let i = link.head.length - 1; i >= 0; i--) {
      const p = link.head[i]!;
      if (p.elem === 'text' && p.field === 'deco') decos.push(p.value as HighlightDeco);
    }
  }
  // The outermost highlight is drawn first, then each inner one over it.
  for (const deco of decos.reverse()) {
    let top = 0;
    let bottom = 0;
    for (const glyph of glyphs) {
      top = Math.max(top, textEdge(deco.topEdge, true, size, [glyph], face));
      bottom = Math.max(bottom, textEdge(deco.bottomEdge, false, size, [glyph], face));
    }
    const rectSize = { x: width + 2 * deco.extent, y: top + bottom };
    const origin = point(-deco.extent, baseline - top);
    frame.prepend(styledRect(rectSize, deco.radius, deco.fill, deco.stroke, size).map((shape) => [origin, { kind: 'shape', shape }]));
  }
}

/**
 * Places items on one baseline, like a paragraph line, from `commit`. The
 * line is as wide as its items; punctuation at its end hangs into the
 * margin, which shifts centered and end-aligned lines.
 */
/**
 * Builds a paragraph's one line, like `commit`: aligned in `width`, the width
 * of a box that has one, or else as wide as its content but no wider than its
 * region, with hanging punctuation at its end.
 */
function buildLine(
  items: LineItem[],
  align: 'start' | 'center' | 'end',
  width: Abs | null,
  region: Abs | null,
): { frame: Frame; naturalWidth: Abs } {
  const frames: [Frame | null, Abs][] = items.map((item) =>
    item.kind === 'space' ? [null, item.width] : [item.kind === 'frame' ? item.frame : textFrame(item), 0],
  );
  let remaining = 0;
  const last = items.at(-1);
  if (last?.kind === 'text' && get(last.styles, 'text', 'overhang', true) && (items.length > 1 || [...last.text].length > 1)) {
    const lastFrame = frames.at(-1)![0]!;
    const glyph = lastFrame.items.find(([, item]) => item.kind === 'text')?.[1];
    if (glyph?.kind === 'text') {
      const g = glyph.text.glyphs.at(-1)!;
      remaining = overhang(glyph.text.text.slice(g.range[0], g.range[1])) * emAt(g.xAdvance, glyph.text.size);
    }
  }
  let ascent = 0;
  let descent = 0;
  let natural = 0;
  for (const [frame, space] of frames) {
    if (frame) {
      ascent = Math.max(ascent, frame.ascent);
      descent = Math.max(descent, frame.descent);
      natural += frame.width;
    } else {
      natural += space;
    }
  }
  const lineWidth = width ?? (region !== null ? Math.min(region, natural) : natural);
  remaining += lineWidth - natural;
  const line = Frame.soft({ x: lineWidth, y: ascent + descent });
  line.setBaseline(ascent);
  let x = align === 'center' ? remaining / 2 : align === 'end' ? remaining : 0;
  for (const [frame, space] of frames) {
    if (!frame) {
      x += space;
      continue;
    }
    line.pushFrame(point(x, ascent - frame.ascent), frame);
    x += frame.width;
  }
  return { frame: line, naturalWidth: natural };
}

// --- Boxes ------------------------------------------------------------------------

/** A relative length that must not be relative, since a formula has no width to be relative to. */
function absolute(rel: RelLength, size: Abs, span: Span): Abs {
  if (rel.rel !== 0) unsupported(span, 'sizes relative to the page in boxes');
  const abs = lengthAt(rel.abs, size);
  checkSize(abs, size, span);
  return abs;
}

/** Folds sides: each side's innermost value, from the element or a set rule. */
function foldSides<T>(own: Sides<T> | undefined, styles: StyleChain, field: string): Sides<T> {
  const values: Sides<T>[] = [];
  for (let link: StyleChain | null = styles; link; link = link.tail) {
    for (let i = link.head.length - 1; i >= 0; i--) {
      const p = link.head[i]!;
      if (p.elem === 'box' && p.field === field) values.push(p.value as Sides<T>);
    }
  }
  return Object.assign({}, ...values.reverse(), own ?? {}) as Sides<T>;
}

function foldCorners<T>(own: Corners<T> | undefined, styles: StyleChain): Corners<T> {
  return foldSides(own as Sides<T>, styles, 'radius') as Corners<T>;
}

/**
 * Lays out a box: its body, sized and padded, with its fill and stroke, like
 * `layout_box`, in a region of the given width, or `null` for no limit.
 */
export function layoutBox(elem: BoxElem, styles: StyleChain, warnings: SourceDiagnostic[], region: Abs | null = null): Frame {
  const span = elem.span;
  const size = fontSize(styles);
  const field = <T>(own: T | undefined, name: string, fallback: T): T => (own !== undefined ? own : get(styles, 'box', name, fallback));

  const width = field(elem.width, 'width', 'auto');
  const height = field(elem.height, 'height', 'auto');
  const insets = foldSides(elem.inset, styles, 'inset');
  const inset = {
    left: insets.left ? absolute(insets.left, size, span) : 0,
    top: insets.top ? absolute(insets.top, size, span) : 0,
    right: insets.right ? absolute(insets.right, size, span) : 0,
    bottom: insets.bottom ? absolute(insets.bottom, size, span) : 0,
  };
  if (width !== 'auto' && 'fr' in width) unsupported(span, 'fractional widths of boxes');
  // The size the body gets: fixed where the box has a size, less the inset.
  // Without a width, the body gets the region, less the inset.
  const fixedX = width === 'auto' ? null : absolute(width.rel, size, span) - inset.left - inset.right;
  const fixedY = height === 'auto' ? null : absolute(height, size, span) - inset.top - inset.bottom;
  const bodyRegion = fixedX === null && region !== null ? region - inset.left - inset.right : null;

  const body = field(elem.body, 'body', null);
  const frame = body ? layoutParagraph(body, styles, warnings, fixedX, bodyRegion) : Frame.hard({ x: 0, y: 0 });
  if (fixedX !== null) frame.size.x = fixedX;
  if (fixedY !== null) frame.size.y = fixedY;

  // Grow the frame by the inset.
  if (inset.left || inset.top || inset.right || inset.bottom) {
    frame.size = { x: frame.size.x + inset.left + inset.right, y: frame.size.y + inset.top + inset.bottom };
    frame.translate(point(inset.left, inset.top));
  }

  if (field(elem.clip, 'clip', false)) unsupported(span, 'clipped boxes yet');

  const fill = field<Color | null>(elem.fill, 'fill', null);
  const stroke = foldSides(elem.stroke, styles, 'stroke');
  if (fill !== null || Object.values(stroke).some((s) => s !== null)) {
    const outsets = foldSides(elem.outset, styles, 'outset');
    const outset = {
      left: outsets.left ? absolute(outsets.left, size, span) : 0,
      top: outsets.top ? absolute(outsets.top, size, span) : 0,
      right: outsets.right ? absolute(outsets.right, size, span) : 0,
      bottom: outsets.bottom ? absolute(outsets.bottom, size, span) : 0,
    };
    const rectSize = { x: frame.width + outset.left + outset.right, y: frame.height + outset.top + outset.bottom };
    const origin: Point = point(-outset.left, -outset.top);
    const radius = foldCorners(elem.radius, styles);
    frame.prepend(styledRect(rectSize, radius, fill, stroke, size).map((shape) => [origin, { kind: 'shape', shape }]));
  }

  // The baseline: the body's, or at an alignment, then shifted.
  const baseline = { ...get(styles, 'box', 'baseline', {}), ...(elem.baseline ?? {}) };
  if (baseline.at && baseline.at !== 'auto') {
    frame.setBaseline(baseline.at === 'top' ? 0 : baseline.at === 'horizon' ? frame.height / 2 : frame.height);
  }
  if (baseline.shift) {
    const shift = baseline.shift.rel * frame.height + lengthAt(baseline.shift.abs, size);
    if (shift !== 0) frame.setBaseline(frame.baseline - shift);
  }
  return frame;
}

/**
 * The shapes of a rectangle, like `styled_rect`: one rectangle when the
 * stroke is the same all around and the corners are square, else a box that
 * the HTML draws with CSS.
 */
function styledRect(
  size: { x: Abs; y: Abs },
  radius: Corners<RelLength>,
  fill: Color | null,
  sides: Sides<Stroke | null>,
  fontSize: Abs,
): Shape[] {
  // A side's stroke, with Typst's defaults for unset parts: 1pt and black.
  const black = { space: 'luma', luma: 0, alpha: 1 } as Color;
  const fixed = (stroke: Stroke | null | undefined): FixedStroke | null =>
    stroke ? resolveStroke(stroke, fontSize, black) : null;
  const strokes = { left: fixed(sides.left), top: fixed(sides.top), right: fixed(sides.right), bottom: fixed(sides.bottom) };
  const corner = (rel: RelLength | undefined) => (rel ? rel.rel * Math.min(size.x, size.y) / 2 + lengthAt(rel.abs, fontSize) : 0);
  const radii = {
    'top-left': corner(radius['top-left']),
    'top-right': corner(radius['top-right']),
    'bottom-right': corner(radius['bottom-right']),
    'bottom-left': corner(radius['bottom-left']),
  };
  const same = (a: FixedStroke | null, b: FixedStroke | null) => JSON.stringify(a) === JSON.stringify(b);
  const uniform = same(strokes.left, strokes.top) && same(strokes.top, strokes.right) && same(strokes.right, strokes.bottom);
  if (uniform && Object.values(radii).every((r) => r === 0)) {
    return [{ geometry: { kind: 'rect', size }, fill, stroke: strokes.top }];
  }
  const border: BoxBorder = { strokes, radius: radii };
  return [{ geometry: { kind: 'box', size, border }, fill, stroke: null }];
}

