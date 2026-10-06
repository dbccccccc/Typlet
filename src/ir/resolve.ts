// Ported from Typst 0.15.1: crates/typst-library/src/math/ir/resolve.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// Typst realizes content before resolving it: it flattens sequences, styled
// elements and nested equations, applies show rules and collapses spaces
// (typst-realize). Typlet has no show rules, so `realize` here does the rest,
// ported from typst-realize 0.15.1, `lib.rs` and `spaces.rs`.

import { ACCENT_SHORT_FALL, accentIsBottom } from '../elements/accent.js';
import { Limits, limitsActive, limitsForClass } from '../elements/attach.js';
import { CANCEL_LENGTH } from '../elements/cancel.js';
import { fieldOr } from '../elements/elem.js';
import { KNOWN_FAMILIES, MATH_FAMILIES, highlightYellow } from '../elements/text.js';
import { NAMED_COLORS } from '../eval/color.js';
import type { FontFace } from '../layout/font.js';
import type { Color } from '../eval/color.js';
import { FRAC_PADDING } from '../elements/frac.js';
import { DELIM_SHORT_FALL } from '../elements/lr.js';
import { BRACE, DEFAULT_ALIGN, DEFAULT_COL_GAP_REL, DEFAULT_ROW_GAP_REL, PAREN } from '../elements/matrix.js';
import type { LeftRightAlternator } from '../elements/mod.js';
import {
  MathSize,
  equationBold,
  equationItalic,
  equationSize,
  equationVariant,
  styleCramped,
  styleDtls,
  styleForDenominator,
  styleForNumerator,
  styleForSubscript,
  styleForSuperscript,
} from '../elements/style.js';
import type {
  AccentElem,
  AttachElem,
  Augment,
  BinomElem,
  CancelElem,
  BoxElem,
  CasesElem,
  ClassElem,
  Content,
  Corners,
  EmphElem,
  HideElem,
  HighlightElem,
  LinkElem,
  Sides,
  Stroke,
  StrongElem,
  TextEdge,
  FracElem,
  HElem,
  LimitsElem,
  LineElem,
  LrElem,
  MatElem,
  MidElem,
  OpElem,
  PrimesElem,
  RootElem,
  ScriptsElem,
  StretchElem,
  SymbolElem,
  TextElem,
  UnderOverElem,
  VecElem,
} from '../eval/content.js';
import { join, sequence, symbolElem } from '../eval/content.js';
import { ElementBudget, type SourceDiagnostic, type Span, bailAt, limit, unsupported, warning } from '../eval/diag.js';
import {
  type Abs,
  type FixedAlignment,
  type Length,
  type Rel,
  type RelLength,
  REL_ONE,
  absPt,
  fixHAlignment,
  lengthAt,
  relAt,
  relIsOne,
} from '../eval/layout.js';
import { EMPTY_CHAIN, type Property, type StyleChain, type Styles, chain, get, property } from '../eval/styles.js';
import { splitNewlines } from '../syntax/lexer.js';
import { graphemes, isDefaultIgnorable } from '../syntax/unicode.js';
import { MathClass } from '../utils/math-class.js';
import { styleText } from '../utils/styling.js';
import {
  type ComponentItem,
  type MathItem,
  type RawMathItem,
  ALIGN,
  LINEBREAK,
  Position,
  SPACE,
  TAG,
  accentItem,
  asSlice,
  cancelItem,
  classOf,
  boxItem,
  externalItem,
  fencedBodyItem,
  fencedItem,
  fractionItem,
  glyphItem,
  groupItem,
  isItem,
  isRawIgnorant,
  limitsOf,
  lineItem,
  midStretched,
  multilineItem,
  numberItem,
  primesItem,
  radicalItem,
  replaceStretch,
  scriptsItem,
  setClass,
  setExplicitClass,
  setLimits,
  setLspace,
  setMidStretched,
  setRspace,
  setStretch,
  setYStretch,
  skewedFractionItem,
  stretchInfo,
  stretchInfoDefault,
  stretchInfoFromSize,
  tableItem,
  textItem,
  updateStretch,
  withMultilineCentering,
  withX,
  withY,
  wrap,
  NO_STRETCH,
} from './item.js';
import { type AlignedRow, expandMultilineFence, padTo } from './multiline.js';
import { processGroup, processTableCell } from './process.js';

/** Typst's default font size. */
export const DEFAULT_FONT_SIZE: Abs = absPt(11);

const BLACK = NAMED_COLORS.black!;

/**
 * The styles of an equation: those around it, such as a preamble's set
 * rules, then its math size, as its show rule sets it.
 */
export function equationStyles(block: boolean, outer: Styles = []): StyleChain {
  return chain(chain(EMPTY_CHAIN, outer), [
    // Block equations are centered.
    ...(block ? [property('align', 'alignment', 'center')] : []),
    property('equation', 'size', block ? MathSize.Display : MathSize.Text),
    property('text', 'weight', 450),
    property('text', 'font', MATH_FAMILIES),
  ]);
}

/**
 * The font size, like `styles.resolve(TextElem::size)`: text sizes fold,
 * each relative to the one around it, and are scaled down in scripts by the
 * math font's `scriptPercentScaleDown` and `scriptScriptPercentScaleDown`,
 * 70% and 50% for New Computer Modern, which are also Typst's defaults.
 */
export function fontSize(styles: StyleChain): Abs {
  // Compose the sizes from the innermost outward: each maps the size around
  // it to `em * outer + abs`, like `TextSize`'s fold.
  let em = 1;
  let abs = 0;
  for (let link: StyleChain | null = styles; link; link = link.tail) {
    for (let i = link.head.length - 1; i >= 0; i--) {
      const p = link.head[i]!;
      if (p.field !== 'size' || p.elem !== 'text') continue;
      const size = p.value as Length;
      abs += em * size.abs;
      em *= size.em;
    }
  }
  const size = em * DEFAULT_FONT_SIZE + abs;
  if (size > maxSize * DEFAULT_FONT_SIZE) limit(null, `Typlet stopped at a size of more than ${maxSize}em`);
  switch (equationSize(styles)) {
    case MathSize.Script:
      return (70 / 100) * size;
    case MathSize.ScriptScript:
      return (50 / 100) * size;
    default:
      return size;
  }
}

/** The text's fill, like `TextElem::fill`. */
export const textFill = (styles: StyleChain): Color => get(styles, 'text', 'fill', BLACK);

/** How far down the text's baseline shifts, like `TextElem::baseline` resolved. */
export function textShift(styles: StyleChain): Abs {
  const shift = get<Length | null>(styles, 'text', 'baseline', null);
  return shift === null ? 0 : lengthAt(shift, fontSize(styles));
}

const UNSET = Symbol();

/** Whether user font features are set: a non-empty list or dictionary, as opposed to Typlet's own `dtls` and `flac`. */
const hasFeatures = (value: unknown): boolean =>
  (Array.isArray(value) && value.length > 0) || (value instanceof Map && value.size > 0);

/**
 * The face text is drawn in, like Typst's font selection: of New Computer
 * Modern Math's Regular (400), Book (450, as Typst counts it) and Bold (700),
 * the nearest to the weight with the deltas of `strong`, or the heavier of
 * two that are equally near. Typlet has the metrics of Book and Bold only, so
 * it refuses Regular, other fonts, and text styles its HTML can't draw yet:
 * strokes and OpenType features, which the font has (`ss01` to `ss06`, `cv01`
 * and `cv02`).
 */
export function fontFace(styles: StyleChain, span: Span): FontFace {
  // One walk instead of a `get` per field: this runs for every glyph.
  let families: readonly string[] | undefined;
  let weight: number | undefined;
  let delta = 0;
  let stroke: unknown = UNSET;
  let sets: unknown = UNSET;
  let features = false;
  for (let link: StyleChain | null = styles; link; link = link.tail) {
    for (let i = link.head.length - 1; i >= 0; i--) {
      const p = link.head[i]!;
      if (p.elem !== 'text') continue;
      if (p.field === 'delta') delta += p.value as number;
      else if (p.field === 'weight') weight ??= p.value as number;
      else if (p.field === 'font') families ??= p.value as readonly string[];
      else if (p.field === 'stroke') stroke = stroke === UNSET ? p.value : stroke;
      else if (p.field === 'stylistic-set') sets = sets === UNSET ? p.value : sets;
      // Features fold: every list adds its features.
      else if (p.field === 'features') features ||= hasFeatures(p.value);
    }
  }
  if (families !== undefined && families !== MATH_FAMILIES) {
    const known = families.find((family) => KNOWN_FAMILIES.has(family));
    if (known !== MATH_FAMILIES[0]) unsupported(span, `the font ${JSON.stringify(known ?? families[0])} in HTML output`);
  }
  if (stroke !== UNSET && stroke !== null) unsupported(span, 'text strokes in HTML output yet');
  if (features || (sets !== UNSET && sets !== null && (typeof sets === 'bigint' || hasFeatures(sets)))) {
    unsupported(span, 'OpenType features in HTML output yet');
  }
  const total = Math.min(900, Math.max(100, (weight ?? 400) + delta));
  if (total < 425) unsupported(span, `the font weight ${total} in HTML output yet`);
  return total >= 575 ? 'bold' : 'book';
}

/** What a frame's styles change about it: hidden content and links, like `FrameModifiers`. */
export interface FrameModifiers {
  readonly hidden: boolean;
  readonly link: string | null;
}

const NO_MODIFIERS: FrameModifiers = { hidden: false, link: null };

export function frameModifiers(styles: StyleChain): FrameModifiers {
  // One walk, and no allocation for the usual frame that has neither.
  let hidden: boolean | typeof UNSET = UNSET;
  let dest: string | null | typeof UNSET = UNSET;
  for (let link: StyleChain | null = styles; link; link = link.tail) {
    for (let i = link.head.length - 1; i >= 0; i--) {
      const p = link.head[i]!;
      if (hidden === UNSET && p.field === 'hidden' && p.elem === 'hide') hidden = p.value as boolean;
      else if (dest === UNSET && p.field === 'current' && p.elem === 'link') dest = p.value as string | null;
    }
  }
  if (hidden !== true && (dest === UNSET || dest === null)) return NO_MODIFIERS;
  return { hidden: hidden === true, link: dest === UNSET ? null : dest };
}

/** Resolves a relative length's em part at the font size, like `Rel<Length>::resolve`. */
const resolveRel = (rel: RelLength, styles: StyleChain): Rel<Abs> => relAt(rel, fontSize(styles));

// Text in math is laid out with tight vertical bounds and no overhang.
const TEXT_BASE_LOCAL_STYLES: Styles = [
  property('text', 'top-edge', 'bounds'),
  property('text', 'bottom-edge', 'bounds'),
  property('text', 'overhang', false),
];

/**
 * The output a formula is resolved for. Typst realizes some elements for
 * each: in `paged` output, `strong` makes its body heavier; in `html`
 * output, it becomes a `<strong>` element.
 */
export type Target = 'paged' | 'html';

/** Builds math items from content, like Typst's `MathResolver`. */
export class MathResolver {
  items: RawMathItem[] = [];
  /** Whether the content has an element the other target realizes differently. */
  targetDependent = false;
  readonly budget = new ElementBudget();

  constructor(
    readonly warnings: SourceDiagnostic[],
    readonly target: Target = 'paged',
  ) {}

  push(item: RawMathItem): void {
    this.items.push(item);
  }

  /** Resolves content into this resolver's items; returns where they start. */
  resolveIntoItems(content: Content, styles: StyleChain): number {
    const start = this.items.length;
    this.resolveIntoSelf(content, styles);
    return start;
  }

  /** Resolves content into a single item. */
  resolveIntoItem(content: Content, styles: StyleChain): MathItem {
    const start = this.resolveIntoItems(content, styles);
    const len = this.items.length - start;
    // Don't emit standalone linebreaks or alignment points.
    const last = this.items[this.items.length - 1];
    if (len === 1 && last && isItem(last)) {
      this.items.pop();
      return last;
    }
    const result = processGroup(this.items.splice(start), styles, false, true, false);
    return 'multiline' in result ? multilineItem(result.multiline, styles) : wrap(result.flat, styles);
  }

  private resolveIntoSelf(content: Content, styles: StyleChain): void {
    // A single element realizes to itself, except a space, which collapses,
    // elements whose show rules realize them, and elements with tags.
    if (!REALIZED.has(content.func) && !isTagged(content)) {
      if (content.func !== 'space') resolveRealized(content, this, styles);
      return;
    }
    for (const [elem, elemStyles] of realize(content, styles, this)) resolveRealized(elem, this, elemStyles);
  }
}

/** The elements realization looks into. */
const REALIZED: ReadonlySet<string> = new Set(['sequence', 'styled', 'equation', 'strong', 'emph', 'highlight', 'link', 'hide', 'parbreak']);

// --- Realization -----------------------------------------------------------

export type Pair = [Content, StyleChain];

/**
 * A tag in the realized elements: where an element that Typst can locate or
 * tag starts or ends. Typst's realization puts tags around such elements, and
 * around labelled ones, in both outputs. They draw nothing, but a script of
 * `#hide[x]` is then a group of three items, in the styles around it.
 */
const TAG_CONTENT: Content = { func: 'sequence', children: [], span: null };

/** The content in math that Typst can locate or tag: `Locatable` or `Tagged` elements. */
const TAGGED: ReadonlySet<string> = new Set(['strong', 'emph', 'highlight', 'link', 'hide', 'raw']);

const isTagged = (content: Content): boolean => TAGGED.has(content.func) || content.label !== undefined;

/** Flattens content into elements with their styles, as Typst's math realization does. */
function realize(content: Content, styles: StyleChain, ctx: MathResolver): Pair[] {
  const sink: Pair[] = [];
  visit(sink, content, styles, ctx);
  collapseSpaces(sink);
  return sink;
}

function visit(sink: Pair[], content: Content, styles: StyleChain, ctx: MathResolver): void {
  ctx.budget.visit(content.span);
  switch (content.func) {
    case 'equation':
      // Transparently recurse into equations nested in math.
      visit(sink, content.body, styles, ctx);
      return;
    case 'sequence':
      for (const child of content.children) visit(sink, child, styles, ctx);
      return;
    case 'styled':
      visit(sink, content.child, chain(styles, content.styles), ctx);
      return;
    case 'parbreak':
      // A paragraph break has no place in math: it disappears in paged
      // output, and is dropped from HTML output with a warning.
      ctx.targetDependent = true;
      if (ctx.target === 'html') sink.push([content, styles]);
      return;
    case 'strong':
    case 'emph':
    case 'highlight':
    case 'link':
    case 'hide':
      ctx.targetDependent = true;
      sink.push([TAG_CONTENT, styles]);
      // In HTML output, these become HTML elements, or are dropped. In paged
      // output, their show rules style their bodies.
      if (ctx.target === 'html') sink.push([content, styles]);
      else visit(sink, content.body, chain(styles, shownStyles(content, styles)), ctx);
      sink.push([TAG_CONTENT, styles]);
      return;
    default:
      if (isTagged(content)) {
        sink.push([TAG_CONTENT, styles], [content, styles], [TAG_CONTENT, styles]);
      } else {
        sink.push([content, styles]);
      }
  }
}

/** The styles an element's paged show rule applies to its body, from typst-layout's `rules.rs`. */
export function shownStyles(content: StrongElem | EmphElem | HighlightElem | LinkElem | HideElem, styles: StyleChain): Styles {
  switch (content.func) {
    case 'strong':
      return [property('text', 'delta', fieldOr(content.delta, styles, 'strong', 'delta', 300))];
    case 'emph':
      return [property('text', 'emph', true)];
    case 'highlight':
      return [property('text', 'deco', highlightDeco(content, styles))];
    case 'link':
      return [property('link', 'current', content.dest)];
    case 'hide':
      return [property('hide', 'hidden', true)];
  }
}

/** A highlight decoration, with the highlight's fields resolved, like `HIGHLIGHT_RULE`. */
export interface HighlightDeco {
  readonly fill: Color | null;
  readonly stroke: Sides<Stroke | null>;
  readonly topEdge: TextEdge;
  readonly bottomEdge: TextEdge;
  readonly extent: Abs;
  readonly radius: Corners<RelLength>;
}

function highlightDeco(elem: HighlightElem, styles: StyleChain): HighlightDeco {
  const size = fontSize(styles);
  return {
    fill: fieldOr(elem.fill, styles, 'highlight', 'fill', highlightYellow()),
    stroke: fieldOr(elem.stroke, styles, 'highlight', 'stroke', {}),
    topEdge: fieldOr(elem['top-edge'], styles, 'highlight', 'top-edge', 'ascender'),
    bottomEdge: fieldOr(elem['bottom-edge'], styles, 'highlight', 'bottom-edge', 'descender'),
    extent: lengthAt(fieldOr(elem.extent, styles, 'highlight', 'extent', { abs: 0, em: 0 }), size),
    radius: fieldOr(elem.radius, styles, 'highlight', 'radius', {}),
  };
}

type SpaceState = 'invisible' | 'destructive' | 'supportive' | 'space';

function collapseState(content: Content, styles: StyleChain): SpaceState {
  if (content === TAG_CONTENT) return 'invisible';
  if (content.func === 'h') {
    const weak = fieldOr(content.weak, styles, 'h', 'weak', false);
    return 'fr' in content.amount || weak ? 'destructive' : 'invisible';
  }
  if (content.func === 'linebreak') return 'destructive';
  if (content.func === 'space') return 'space';
  return 'supportive';
}

/** Removes spaces at the edges and next to destructive elements, and merges runs of spaces. */
export function collapseSpaces(buf: Pair[]): void {
  let cursor = 0;
  let prevSpace = 0;
  let state: SpaceState = 'destructive';
  for (let i = 0; i < buf.length; i++) {
    const pair = buf[i]!;
    switch (collapseState(pair[0], pair[1])) {
      case 'invisible':
        break;
      case 'destructive':
        if (state === 'space') {
          buf.copyWithin(prevSpace, prevSpace + 1, cursor);
          cursor--;
        }
        state = 'destructive';
        break;
      case 'supportive':
        state = 'supportive';
        break;
      case 'space':
        if (state !== 'supportive') continue;
        prevSpace = cursor;
        state = 'space';
        break;
    }
    buf[cursor++] = pair;
  }
  if (state === 'space') {
    buf.copyWithin(prevSpace, prevSpace + 1, cursor);
    cursor--;
  }
  buf.length = cursor;
}

// --- Resolution --------------------------------------------------------------

function resolveRealized(elem: Content, ctx: MathResolver, styles: StyleChain): void {
  if (elem === TAG_CONTENT) return ctx.push(TAG);
  switch (elem.func) {
    case 'symbol':
      return resolveSymbol(elem, ctx, styles);
    case 'box':
      return ctx.push(boxItem(elem, styles));
    case 'space':
      return ctx.push(SPACE);
    case 'text':
      return resolveText(elem, ctx, styles);
    case 'attach':
      return ctx.push(resolveInnerAttach(elem, [null, null, null, null, null, null], false, ctx, styles));
    case 'lr':
      return resolveLr(elem, ctx, styles);
    case 'op':
      return resolveOp(elem, ctx, styles);
    case 'h':
      return resolveH(elem, ctx, styles);
    case 'overline':
    case 'underline':
      return resolveLine(elem, ctx, styles);
    case 'align-point':
      return ctx.push(ALIGN);
    case 'primes':
      return resolvePrimes(elem, ctx, styles);
    case 'class':
      return resolveClass(elem, ctx, styles);
    case 'linebreak':
      return ctx.push(LINEBREAK);
    case 'frac':
      return resolveFrac(elem, ctx, styles);
    case 'accent':
      return resolveAccent(elem, ctx, styles);
    case 'limits':
      return resolveLimits(elem, ctx, styles);
    case 'stretch':
      return resolveStretch(elem, ctx, styles);
    case 'root':
      return resolveRoot(elem, ctx, styles);
    case 'mat':
      return resolveMat(elem, ctx, styles);
    case 'mid':
      return resolveMid(elem, ctx, styles);
    case 'cases':
      return resolveCases(elem, ctx, styles);
    case 'scripts':
      return resolveScripts(elem, ctx, styles);
    case 'cancel':
      return resolveCancel(elem, ctx, styles);
    case 'vec':
      return resolveVec(elem, ctx, styles);
    case 'binom':
      return resolveBinom(elem, ctx, styles);
    case 'underbrace':
    case 'overbrace':
    case 'underbracket':
    case 'overbracket':
    case 'underparen':
    case 'overparen':
    case 'undershell':
    case 'overshell':
      return resolveUnderOverSpreader(elem, ctx, styles);
    default:
      return ctx.push(externalItem(elem, styles));
  }
}

function resolveH(elem: HElem, ctx: MathResolver, styles: StyleChain): void {
  if ('rel' in elem.amount && elem.amount.rel.rel === 0) {
    const size = fontSize(styles);
    checkSize(lengthAt(elem.amount.rel.abs, size), size, elem.span);
    ctx.push({
      type: 'spacing',
      amount: elem.amount.rel.abs,
      fontSize: size,
      weak: fieldOr(elem.weak, styles, 'h', 'weak', false),
    });
  }
}

// The largest size a formula may give spacing, boxes and text, in ems of the
// font size (docs/DESIGN.md §6.6). The renderer sets it for each formula.
let maxSize = 1000;

/** Sets the size budget for the following formulas: the `maxSize` option. */
export function setMaxSize(ems: number): void {
  maxSize = ems;
}

/** Fails for a size beyond the budget, at a font size. */
export function checkSize(size: Abs, fontSize: Abs, span: Span): void {
  if (Math.abs(size) > maxSize * fontSize) limit(span, `Typlet stopped at a size of more than ${maxSize}em`);
}

function resolveText(elem: TextElem, ctx: MathResolver, styles: StyleChain): void {
  const variant = equationVariant(styles);
  const bold = equationBold(styles);
  // Disable auto-italic.
  const italic = equationItalic(styles) ?? false;
  const localStyles = chain(styles, TEXT_BASE_LOCAL_STYLES);

  const createItem = (text: string): MathItem => {
    const decimals = [...text].filter((c) => c === '.').length;
    const num = /^[0-9.]*$/.test(text) && decimals !== text.length && decimals <= 1;
    const styled = styleText(text, variant, bold, italic);
    return num ? numberItem(styled, styles, elem.span) : textItem(styled, localStyles, elem.span);
  };

  // Strip a single trailing newline.
  const lines = splitNewlines(elem.text);
  if (lines[lines.length - 1] === '') lines.pop();

  if (lines.length === 1) {
    ctx.push(createItem(lines[0]!));
  } else {
    const rows: AlignedRow[] = lines.map((line) => [createItem(line)]);
    ctx.push(withMultilineCentering(multilineItem(rows, styles)));
  }
}

/** Whether a cluster's characters are all default-ignorable, like Typst's `is_default_ignorable`. */
function isIgnorableCluster(cluster: string): boolean {
  for (const c of cluster) if (!isDefaultIgnorable(c.codePointAt(0)!)) return false;
  return true;
}

function resolveSymbol(elem: SymbolElem, ctx: MathResolver, styles: StyleChain): void {
  const variant = equationVariant(styles);
  const bold = equationBold(styles);
  const italic = equationItalic(styles);
  for (const cluster of graphemes(elem.text)) {
    if (isIgnorableCluster(cluster)) continue;
    const item = glyphItem(styleText(cluster, variant, bold, italic), styles, elem.span);
    if (classOf(item) === MathClass.Large && item.props.size === MathSize.Display) {
      replaceStretch(item, withY(NO_STRETCH, stretchInfoDefault()));
    }
    ctx.push(item);
  }
}

function resolveAccent(elem: AccentElem, ctx: MathResolver, styles: StyleChain): void {
  const position = accentIsBottom(elem.accent) ? Position.Below : Position.Above;
  const dotless = fieldOr(elem.dotless, styles, 'accent', 'dotless', true);

  const newStyles: Property[] = [];
  if (position === Position.Above) {
    newStyles.unshift(styleCramped());
    // Try to replace the base glyph with its dotless variant.
    if (dotless) newStyles.unshift(styleDtls());
  }
  const base = ctx.resolveIntoItem(elem.base, chain(styles, newStyles));

  const accent = ctx.resolveIntoItem(symbolElem(elem.accent, elem.span), styles);
  setClass(accent, MathClass.Diacritic);
  const width = resolveRel(fieldOr(elem.size, styles, 'accent', 'size', REL_ONE), styles);
  setStretch(accent, withX(NO_STRETCH, stretchInfo(width, ACCENT_SHORT_FALL)));

  ctx.push(accentItem(base, accent, position, dotless, false, styles));
}

// The attachments of nested `attach` elements merge: an inner attach takes
// the outer one's attachment where it has none of its own, so `(x_1)_2`
// doesn't stack two subscripts. Each list node holds one position's content.
interface AttachmentNode {
  data: Content | null;
  readonly outer: AttachmentNode | null;
}

/** Takes the content of a list node, pulling the next outer content in its place. */
function mergeInward(list: AttachmentNode | null): Content | null {
  if (!list) return null;
  const data = list.data;
  list.data = mergeInward(list.outer);
  return data;
}

function innerNode(content: Content | null, outer: AttachmentNode | null): AttachmentNode {
  return { data: content ?? mergeInward(outer), outer };
}

/** Gives content back to the outer lists, undoing a merge. */
function unmerge(list: AttachmentNode | null, content: Content): void {
  let data: Content | null = content;
  for (let node = list; data !== null && node; node = node.outer) {
    const old: Content | null = node.data;
    node.data = data;
    data = old;
  }
}

type Attachments = [AttachmentNode | null, AttachmentNode | null, AttachmentNode | null, AttachmentNode | null, AttachmentNode | null, AttachmentNode | null];

function resolveInnerAttach(
  elem: AttachElem,
  outer: Attachments,
  outerTInsideTr: boolean,
  ctx: MathResolver,
  styles: StyleChain,
): MathItem {
  const supStyles = chain(styles, [styleForSuperscript(styles)]);
  const subStyles = chain(styles, styleForSubscript(styles));
  const own = (field: 't' | 'b' | 'tl' | 'bl' | 'tr' | 'br', chainStyles: StyleChain) =>
    fieldOr(elem[field], chainStyles, 'attach', field, null);

  // Get the merged attachments without resolving them to items yet.
  const [oT, oB, oTl, oTr, oBl, oBr] = outer;
  const tl = innerNode(own('tl', supStyles), oTl);
  // Remember the status of t and tr for correct prime handling below.
  const elemT = own('t', supStyles);
  const elemTr = own('tr', supStyles);
  const noInnerTr = elemTr === null;
  const tInsideTr = noInnerTr && (elemT !== null || outerTInsideTr);
  const t = innerNode(elemT, oT);
  const tr = innerNode(elemTr, oTr);
  const b = innerNode(own('b', subStyles), oB);
  const bl = innerNode(own('bl', subStyles), oBl);
  const br = innerNode(own('br', subStyles), oBr);
  const attachments: Attachments = [t, b, tl, tr, bl, br];

  // Extract from a nested equation.
  let baseElem = elem.base;
  while (baseElem.func === 'equation') baseElem = baseElem.body;

  // Resolve the base and recursively merge outer attachments inwards.
  const base =
    baseElem.func === 'attach'
      ? resolveInnerAttach(baseElem, attachments, tInsideTr, ctx, styles)
      : ctx.resolveIntoItem(baseElem, styles);

  // Take the inner attachments back out of the lists.
  type Slot = Content | null;
  let [tc, bc, tlc, trc, blc, brc] = attachments.map((node) => node?.data ?? null) as [Slot, Slot, Slot, Slot, Slot, Slot];

  // If we're not actually attaching anything, just return the base.
  if ([tc, bc, tlc, trc, blc, brc].every((a) => a === null)) return base;

  // Apply limits, potentially joining top-right primes with the top attachment.
  const limits = limitsActive(limitsOf(base), styles);
  if (tc !== null && trc !== null && !limits) {
    const primed = trc.func === 'primes';
    if (primed && noInnerTr && tInsideTr) {
      // A primed tr brought inward goes back to the outer attachment, so
      // that the order isn't inverted to `tr + t`.
      unmerge(outer[3], trc);
      trc = tc;
      tc = null;
    } else if (primed) {
      // This makes `x'^2` look better than `x^'^2`.
      trc = join(trc, tc);
      tc = null;
    }
  } else if (tc !== null && trc === null && !limits) {
    trc = tc;
    tc = null;
  }
  if (!(limits || brc !== null)) {
    brc = bc;
    bc = null;
  }

  // Finally, resolve the attachments themselves.
  const resolve = (content: Content | null, chainStyles: StyleChain) =>
    content === null ? null : ctx.resolveIntoItem(content, chainStyles);
  const top = resolve(tc, supStyles);
  const bottom = resolve(bc, subStyles);
  const topLeft = resolve(tlc, supStyles);
  const bottomLeft = resolve(blc, subStyles);
  const topRight = resolve(trc, supStyles);
  const bottomRight = resolve(brc, subStyles);
  return scriptsItem(base, top, bottom, topLeft, bottomLeft, topRight, bottomRight, styles);
}

const PRIME_CHARS = ['′', '″', '‴', '⁗'];

function resolvePrimes(elem: PrimesElem, ctx: MathResolver, styles: StyleChain): void {
  if (elem.count >= 1 && elem.count <= 4) {
    ctx.push(ctx.resolveIntoItem(symbolElem(PRIME_CHARS[elem.count - 1]!, elem.span), styles));
  } else {
    // A custom number of primes.
    ctx.push(primesItem(elem.count, styles));
  }
}

function resolveScripts(elem: ScriptsElem, ctx: MathResolver, styles: StyleChain): void {
  const item = ctx.resolveIntoItem(elem.body, styles);
  setLimits(item, Limits.Never);
  ctx.push(item);
}

function resolveLimits(elem: LimitsElem, ctx: MathResolver, styles: StyleChain): void {
  const item = ctx.resolveIntoItem(elem.body, styles);
  setLimits(item, fieldOr(elem.inline, styles, 'limits', 'inline', true) ? Limits.Always : Limits.Display);
  ctx.push(item);
}

function resolveStretch(elem: StretchElem, ctx: MathResolver, styles: StyleChain): void {
  const item = ctx.resolveIntoItem(elem.body, styles);
  const size = fieldOr(elem.size, styles, 'stretch', 'size', REL_ONE);
  updateStretch(item, stretchInfoFromSize(size, 0, fontSize(styles)));
  ctx.push(item);
}

function resolveCancel(elem: CancelElem, ctx: MathResolver, styles: StyleChain): void {
  const body = ctx.resolveIntoItem(elem.body, styles);
  const length = resolveRel(fieldOr(elem.length, styles, 'cancel', 'length', CANCEL_LENGTH), styles);
  // The stroke folds onto the default, a thickness of 0.05em.
  const stroke = { thickness: { abs: 0, em: 0.05 }, ...fieldOr(elem.stroke, styles, 'cancel', 'stroke', {}) };
  const invert = fieldOr(elem.inverted, styles, 'cancel', 'inverted', false);
  const cross = fieldOr(elem.cross, styles, 'cancel', 'cross', false);
  const angle = fieldOr(elem.angle, styles, 'cancel', 'angle', null);
  ctx.push(cancelItem(body, length, stroke, cross, !cross && invert, angle, styles, elem.span));
}

function resolveFrac(elem: FracElem, ctx: MathResolver, styles: StyleChain): void {
  switch (fieldOr(elem.style, styles, 'frac', 'style', 'vertical')) {
    case 'skewed':
      return resolveSkewedFrac(ctx, styles, elem.num, elem.denom, elem.span);
    case 'horizontal':
      return resolveHorizontalFrac(
        ctx,
        styles,
        elem.num,
        elem.denom,
        elem.span,
        elem.numDeparenthesized ?? false,
        elem.denomDeparenthesized ?? false,
      );
    case 'vertical':
      return resolveVerticalFracLike(ctx, styles, elem.num, [elem.denom], false, elem.span);
  }
}

function resolveBinom(elem: BinomElem, ctx: MathResolver, styles: StyleChain): void {
  resolveVerticalFracLike(ctx, styles, elem.upper, elem.lower, true, elem.span);
}

function resolveVerticalFracLike(
  ctx: MathResolver,
  styles: StyleChain,
  num: Content,
  denom: Content[],
  binom: boolean,
  span: Span,
): void {
  const numerator = ctx.resolveIntoItem(num, chain(styles, [styleForNumerator(styles)]));
  // Add a comma between each element.
  const parts = denom.flatMap((d) => [symbolElem(',', span), d]).slice(1);
  const denominator = ctx.resolveIntoItem(sequence(parts), chain(styles, styleForDenominator(styles)));
  const frac = fractionItem(numerator, denominator, !binom, FRAC_PADDING, styles, span);

  if (binom) {
    const stretch = withY(NO_STRETCH, stretchInfo({ rel: 1, abs: 0 }, DELIM_SHORT_FALL));
    const open = ctx.resolveIntoItem(symbolElem('(', span), styles);
    setStretch(open, stretch);
    const close = ctx.resolveIntoItem(symbolElem(')', span), styles);
    setStretch(close, stretch);
    ctx.push(fencedItem(open, close, frac, false, styles, span));
  } else {
    ctx.push(frac);
  }
}

/** Wraps content in parentheses as an `lr` element. */
function parenthesized(content: Content): Content {
  return { func: 'lr', body: sequence([symbolElem('('), content, symbolElem(')')]), span: null };
}

function resolveHorizontalFrac(
  ctx: MathResolver,
  styles: StyleChain,
  num: Content,
  denom: Content,
  span: Span,
  numDeparen: boolean,
  denomDeparen: boolean,
): void {
  ctx.push(ctx.resolveIntoItem(numDeparen ? parenthesized(num) : num, styles));
  const slash = ctx.resolveIntoItem(symbolElem('/', span), styles);
  setClass(slash, MathClass.Binary);
  setLspace(slash, 0);
  setRspace(slash, 0);
  ctx.push(slash);
  ctx.push(ctx.resolveIntoItem(denomDeparen ? parenthesized(denom) : denom, styles));
}

function resolveSkewedFrac(ctx: MathResolver, styles: StyleChain, num: Content, denom: Content, span: Span): void {
  const numerator = ctx.resolveIntoItem(num, chain(styles, [styleForNumerator(styles)]));
  const denominator = ctx.resolveIntoItem(denom, chain(styles, styleForDenominator(styles)));
  const slash = ctx.resolveIntoItem(symbolElem('⁄', span), styles);
  setStretch(slash, withY(NO_STRETCH, stretchInfo({ rel: 1, abs: 0 }, DELIM_SHORT_FALL)));
  ctx.push(skewedFractionItem(numerator, denominator, slash, styles, span));
}

/** The range of items after leading and before trailing ignorant ones. */
function splitPrefixSuffix(items: RawMathItem[], from: number): [number, number] {
  let start = from;
  while (start < items.length && isRawIgnorant(items[start]!)) start++;
  let end = items.length;
  while (end > start && isRawIgnorant(items[end - 1]!)) end--;
  return [start, end];
}

function resolveLr(elem: LrElem, ctx: MathResolver, styles: StyleChain): void {
  // Extract from an equation.
  let body = elem.body;
  if (body.func === 'equation') body = body.body;

  // Extract an implicit `lr`.
  if (body.func === 'lr' && relIsOne(fieldOr(body.size, styles, 'lr', 'size', REL_ONE))) body = body.body;

  const start = ctx.resolveIntoItems(body, styles);

  // Ignore leading and trailing ignorant items.
  const [innerStart, innerEnd] = splitPrefixSuffix(ctx.items, start);
  const inner = ctx.items.slice(innerStart, innerEnd);

  const size = fieldOr(elem.size, styles, 'lr', 'size', REL_ONE);
  const font = fontSize(styles);
  const stretch = withY(NO_STRETCH, stretchInfoFromSize(size, DELIM_SHORT_FALL, font));

  const scaleIfDelimiter = (item: MathItem, apply: MathClass) => {
    const cls = classOf(item);
    if (cls === MathClass.Opening || cls === MathClass.Closing || cls === MathClass.Fence) {
      setStretch(item, stretch);
      setClass(item, apply);
    }
  };

  // Scale up items at both ends.
  if (inner.length === 1) {
    const one = inner[0]!;
    if (isItem(one)) {
      if (one.type === 'component' && one.kind.tag === 'fenced') {
        const fenced = one.kind;
        if (fenced.open) setStretch(fenced.open, stretch);
        if (fenced.close) setStretch(fenced.close, stretch);
        for (const item of asSlice(fencedBodyItem(fenced.body))) {
          if (midStretched(item) === true) setStretch(item, stretch);
        }
      } else {
        const info = { ...stretchInfo({ rel: 0, abs: lengthAt(size.abs, font) }, DELIM_SHORT_FALL) };
        setYStretch(one, relIsOne(size) ? info : { ...info, requestedTarget: size });
      }
    }
    return;
  }
  if (inner.length >= 2) {
    const first = inner[0]!;
    const last = inner[inner.length - 1]!;
    if (isItem(first)) scaleIfDelimiter(first, MathClass.Opening);
    if (isItem(last)) scaleIfDelimiter(last, MathClass.Closing);
  }

  // Handle glyphs that should be scaled up.
  for (const item of inner) {
    if (isItem(item) && midStretched(item) === false) {
      setMidStretched(item, true);
      setStretch(item, stretch);
    }
  }

  let innerItems = ctx.items.splice(innerStart, innerEnd - innerStart);

  // Remove weak spacing right after the opening or before the closing.
  const len = innerItems.length;
  const first = innerItems[0];
  const last = innerItems[len - 1];
  const openingExists = first !== undefined && isItem(first) && classOf(first) === MathClass.Opening;
  const closingExists = last !== undefined && isItem(last) && classOf(last) === MathClass.Closing;
  innerItems = innerItems.filter((item, index) => {
    const discard =
      ((index === 1 && openingExists) || (index + 2 === len && closingExists)) &&
      item.type === 'spacing' &&
      item.weak;
    return !discard;
  });

  const open = openingExists ? (innerItems.shift() as MathItem) : null;
  const close = closingExists ? (innerItems.pop() as MathItem) : null;

  const result = processGroup(innerItems, styles, close !== null, false, true);
  if ('multiline' in result) {
    ctx.items.splice(innerStart, 0, ...expandMultilineFence(result.multiline, open, close, styles, elem.span));
  } else {
    const groupBody = groupItem(result.flat, styles);
    ctx.items.splice(innerStart, 0, fencedItem(open, close, groupBody, true, styles, elem.span));
  }
}

function resolveMid(elem: MidElem, ctx: MathResolver, styles: StyleChain): void {
  const start = ctx.resolveIntoItems(elem.body, styles);
  for (const item of ctx.items.slice(start)) {
    if (isItem(item)) {
      setMidStretched(item, false);
      setClass(item, MathClass.Relation);
    }
  }
}

function resolveVec(elem: VecElem, ctx: MathResolver, styles: StyleChain): void {
  const rows = elem.children.map((child) => [child]);
  const gap = resolveRel(fieldOr(elem.gap, styles, 'vec', 'gap', DEFAULT_ROW_GAP_REL), styles);
  const cells = resolveCells(
    ctx,
    styles,
    rows,
    elem.span,
    fixHAlignment(fieldOr(elem.align, styles, 'vec', 'align', DEFAULT_ALIGN)),
    'right',
    null,
    { x: { rel: 0, abs: 0 }, y: gap },
    'elements',
  );
  const delim = fieldOr(elem.delim, styles, 'vec', 'delim', PAREN);
  resolveDelimiters(ctx, styles, cells, delim.open, delim.close, elem.span);
}

function resolveMat(elem: MatElem, ctx: MathResolver, styles: StyleChain): void {
  const span = elem.span;
  const rows = elem.rows;
  const nrows = rows.length;
  const ncols = rows[0]?.length ?? 0;

  const augment: Augment | null = fieldOr(elem.augment, styles, 'mat', 'augment', null);
  if (augment) {
    for (const offset of augment.hline) {
      if (offset > nrows || Math.abs(offset) > nrows) {
        bailAt(span, `cannot draw a horizontal line at offset ${offset} in a matrix with ${nrows} rows`);
      }
    }
    for (const offset of augment.vline) {
      if (offset > ncols || Math.abs(offset) > ncols) {
        bailAt(span, `cannot draw a vertical line at offset ${offset} in a matrix with ${ncols} columns`);
      }
    }
  }

  const cells = resolveCells(
    ctx,
    styles,
    rows,
    span,
    fixHAlignment(fieldOr(elem.align, styles, 'mat', 'align', DEFAULT_ALIGN)),
    'right',
    augment,
    {
      x: resolveRel(fieldOr(elem['column-gap'], styles, 'mat', 'column-gap', DEFAULT_COL_GAP_REL), styles),
      y: resolveRel(fieldOr(elem['row-gap'], styles, 'mat', 'row-gap', DEFAULT_ROW_GAP_REL), styles),
    },
    'cells',
  );
  const delim = fieldOr(elem.delim, styles, 'mat', 'delim', PAREN);
  resolveDelimiters(ctx, styles, cells, delim.open, delim.close, span);
}

function resolveCases(elem: CasesElem, ctx: MathResolver, styles: StyleChain): void {
  const rows = elem.children.map((child) => [child]);
  const gap = resolveRel(fieldOr(elem.gap, styles, 'cases', 'gap', DEFAULT_ROW_GAP_REL), styles);
  const cells = resolveCells(ctx, styles, rows, elem.span, 'start', 'none', null, { x: { rel: 0, abs: 0 }, y: gap }, 'branches');
  const delim = fieldOr(elem.delim, styles, 'cases', 'delim', BRACE);
  const reverse = fieldOr(elem.reverse, styles, 'cases', 'reverse', false);
  resolveDelimiters(ctx, styles, cells, reverse ? null : delim.open, reverse ? delim.close : null, elem.span);
}

function resolveCells(
  ctx: MathResolver,
  styles: StyleChain,
  rows: Content[][],
  span: Span,
  align: FixedAlignment,
  alternator: LeftRightAlternator,
  augment: Augment | null,
  gap: { x: Rel<Abs>; y: Rel<Abs> },
  children: string,
): MathItem {
  const cellStyles = chain(styles, styleForDenominator(styles));

  const cells: AlignedRow[][] = [];
  for (const row of rows) {
    const resolvedRow: AlignedRow[] = [];
    for (const cell of row) {
      const start = ctx.resolveIntoItems(cell, cellStyles);
      const processed = processTableCell(ctx.items.splice(start), cellStyles);
      // Linebreaks in cells are stripped: alignment points for the whole
      // body can't be told apart from ones for one cell.
      if (processed.hadLinebreaks) {
        ctx.warnings.push(
          warning(cell.span, `linebreaks are ignored in ${children}`, 'use commas instead to separate each line'),
        );
      }
      resolvedRow.push(processed.subColumns);
    }
    cells.push(resolvedRow);
  }

  // Pad sub-columns so that every row has the same length.
  const ncols = cells[0]?.length ?? 0;
  for (let c = 0; c < ncols; c++) {
    const max = Math.max(0, ...cells.map((row) => row[c]!.length));
    for (const row of cells) padTo(row[c]!, max, cellStyles);
  }

  return tableItem(cells, gap, augment, align, alternator, styles, span);
}

function resolveDelimiters(
  ctx: MathResolver,
  styles: StyleChain,
  cells: MathItem,
  left: string | null,
  right: string | null,
  span: Span,
): void {
  const stretch = withY(NO_STRETCH, stretchInfo({ rel: 1.1, abs: 0 }, DELIM_SHORT_FALL));
  const delimiter = (c: string | null) => {
    if (c === null) return null;
    const item = ctx.resolveIntoItem(symbolElem(c, span), styles);
    setStretch(item, stretch);
    return item;
  };
  const open = delimiter(left);
  const close = delimiter(right);
  ctx.push(fencedItem(open, close, cells, false, styles, span));
}

function resolveClass(elem: ClassElem, ctx: MathResolver, styles: StyleChain): void {
  const item = ctx.resolveIntoItem(elem.body, styles);
  setExplicitClass(item, elem.class);
  setLimits(item, limitsForClass(elem.class));
  ctx.push(item);
}

function resolveOp(elem: OpElem, ctx: MathResolver, styles: StyleChain): void {
  const item = ctx.resolveIntoItem(elem.text, styles);
  setClass(item, MathClass.Large);
  setLimits(item, fieldOr(elem.limits, styles, 'op', 'limits', false) ? Limits.Display : Limits.Never);
  ctx.push(item);
}

function resolveRoot(elem: RootElem, ctx: MathResolver, styles: StyleChain): void {
  const crampedStyles = chain(styles, [styleCramped()]);
  const radicand = withMultilineCentering(ctx.resolveIntoItem(elem.radicand, crampedStyles));
  const indexContent = fieldOr(elem.index, styles, 'root', 'index', null);
  const index =
    indexContent === null
      ? null
      : ctx.resolveIntoItem(indexContent, chain(crampedStyles, [property('equation', 'size', MathSize.ScriptScript)]));
  const sqrt = ctx.resolveIntoItem(symbolElem('√', elem.span), styles);
  setStretch(sqrt, withY(NO_STRETCH, stretchInfo({ rel: 1, abs: 0 }, 0)));
  ctx.push(radicalItem(radicand, index, sqrt, styles, elem.span));
}

function resolveLine(elem: LineElem, ctx: MathResolver, styles: StyleChain): void {
  if (elem.func === 'underline') {
    const base = ctx.resolveIntoItem(elem.body, styles);
    ctx.push(lineItem(base, Position.Below, styles, elem.span));
  } else {
    const base = ctx.resolveIntoItem(elem.body, chain(styles, [styleCramped()]));
    ctx.push(lineItem(base, Position.Above, styles, elem.span));
  }
}

const SPREADERS: Record<UnderOverElem['func'], [string, Position]> = {
  underbrace: ['⏟', Position.Below],
  overbrace: ['⏞', Position.Above],
  underbracket: ['⎵', Position.Below],
  overbracket: ['⎴', Position.Above],
  underparen: ['⏝', Position.Below],
  overparen: ['⏜', Position.Above],
  undershell: ['⏡', Position.Below],
  overshell: ['⏠', Position.Above],
};

function resolveUnderOverSpreader(elem: UnderOverElem, ctx: MathResolver, styles: StyleChain): void {
  const [c, position] = SPREADERS[elem.func];
  const base = ctx.resolveIntoItem(elem.body, styles);

  const accent = ctx.resolveIntoItem(symbolElem(c, elem.span), styles);
  setClass(accent, MathClass.Diacritic);
  setStretch(accent, withX(NO_STRETCH, stretchInfo({ rel: 1, abs: 0 }, 0)));
  const withAccent = accentItem(base, accent, position, false, true, styles);

  const annotation = fieldOr(elem.annotation, styles, elem.func, 'annotation', null);
  if (annotation === null) {
    ctx.push(withAccent);
    return;
  }
  if (position === Position.Below) {
    const resolved = ctx.resolveIntoItem(annotation, chain(styles, styleForSubscript(styles)));
    ctx.push(scriptsItem(withAccent, null, resolved, null, null, null, null, styles));
  } else {
    const resolved = ctx.resolveIntoItem(annotation, chain(styles, [styleForSuperscript(styles)]));
    ctx.push(scriptsItem(withAccent, resolved, null, null, null, null, null, styles));
  }
}

/** Resolves an equation's body into an item for a target, like Typst's `resolve_equation`. */
export function resolveEquation(
  body: Content,
  styles: StyleChain,
  warnings: SourceDiagnostic[],
  target: Target = 'paged',
): MathItem {
  return new MathResolver(warnings, target).resolveIntoItem(body, styles);
}

export type { ComponentItem };
