// Ported from Typst 0.15.1: crates/typst-html/src/mathml.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { ElementBudget, type SourceDiagnostic, type Span, warning } from '../eval/diag.js';
import type { Em } from '../eval/layout.js';
import { rustDisplayFloat } from '../eval/repr.js';
import { MathSize } from '../elements/style.js';
import { FRAC_PADDING } from '../elements/frac.js';
import {
  type ComponentItem,
  type GlyphKind,
  type MathItem,
  type MathKind,
  type MathProperties,
  type Stretch,
  PRIME_CHAR,
  Position,
  asSlice,
  fencedBodyItem,
  isExplicit,
  isIgnorant,
  resolveRequested,
} from '../ir/item.js';
import type { AlignedRow } from '../ir/multiline.js';
import { MathClass } from '../utils/math-class.js';
import { type HtmlElement, type HtmlNode, convertChildren, elem, emToCss, lengthToCss, pushCss, relToCss, withAttr } from './html.js';
import { rawToHtml } from './raw.js';
import { type ExternalContext, SmartQuoter, fragment, lastChar, mathContentToHtml } from './external.js';
import type { Content } from '../eval/content.js';
import { EMPTY_CHAIN, type StyleChain, chain, property } from '../eval/styles.js';
import { resolveEquation, textFill } from '../ir/resolve.js';
import { toHex } from '../eval/color.js';
import {
  type Form,
  LARGEOP,
  MOVABLELIMITS,
  STRETCHY,
  SYMMETRIC,
  isFence,
  isSeparator,
  isStretchAxisInline,
  operatorInfo,
  willAutoTransform,
} from './operator.js';

// CSS classes.
const MULTILINE_EQUATION_CLASS = 'multiline-equation';
const ALIGNED_CLASS = 'aligned';
const LEFT_ALIGN_CLASS = 'left-align';
const RIGHT_ALIGN_CLASS = 'right-align';
const CASES_CLASS = 'cases';
const FLUSHED_CLASS = 'flushed';
const LEFT_FLUSH_CLASS = 'left-flush';
const RIGHT_FLUSH_CLASS = 'right-flush';

/** The row gap of multiline equations. */
const EQUATION_ROW_GAP: Em = 0.5;

/** The width of a space between spaced items: (4/18)em. */
const SPACE_WIDTH: Em = 4 / 18;

/**
 * The CSS that makes browsers lay out Typst's MathML as Typst intends, to be
 * included once on a page. Typst calls these its user-agent overrides. A
 * function, so that bundles that don't use it leave it out.
 */
export const equationCss = (): string => `/* Alignment */
mtable.${RIGHT_ALIGN_CLASS} mtd,
mtable mtd.${RIGHT_ALIGN_CLASS},
mtable.${LEFT_ALIGN_CLASS} mtd.${RIGHT_ALIGN_CLASS},
mtable.${ALIGNED_CLASS} mtd:nth-child(odd) {
  justify-items: end;
  text-align: right;
}
mtable.${CASES_CLASS} mtd,
mtable.${LEFT_ALIGN_CLASS} mtd,
mtable mtd.${LEFT_ALIGN_CLASS},
mtable.${ALIGNED_CLASS} mtd:nth-child(even),
math:is(:not([display])) > mtable.${MULTILINE_EQUATION_CLASS} mtd {
  justify-items: start;
  text-align: left;
}
mtable.${CASES_CLASS} mtd,
mtable.${ALIGNED_CLASS} mtd,
mtable mtd.${FLUSHED_CLASS},
mtable mtd.${LEFT_FLUSH_CLASS} {
  padding-left: 0;
}
mtable.${CASES_CLASS} mtd,
mtable.${ALIGNED_CLASS} mtd,
mtable mtd.${FLUSHED_CLASS},
mtable mtd.${RIGHT_FLUSH_CLASS} {
  padding-right: 0;
}

/* Tables */
mtable {
  math-style: inherit;
}
mtd {
  math-depth: auto-add;
  math-style: compact;
  math-shift: compact;
}

/* Equations */
mtable.${MULTILINE_EQUATION_CLASS} mtd {
  math-depth: inherit;
  math-style: inherit;
  math-shift: inherit;
  padding: 0;
}
math > mtable.${MULTILINE_EQUATION_CLASS} mtr:not(:last-child) mtd {
  padding-bottom: ${emToCss(EQUATION_ROW_GAP)};
}

/* Fractions */
mfrac {
  padding-inline: 0;
  margin-inline: ${emToCss(FRAC_PADDING)};
}

/* Accents */
mover[accent="true" i] > :first-child {
  font-feature-settings: "dtls";
}
mover.dotted[accent="true" i] > :first-child {
  font-feature-settings: "dtls" 0;
}

/* Other rules for scriptlevel, displaystyle and math-shift */
munder > :nth-child(2),
munderover > :nth-child(2) {
  math-shift: compact
}
munder[accentunder="true" i] > :not(:first-child),
mover[accent="true" i] > :not(:first-child) {
  math-depth: inherit;
  math-style: inherit;
  math-shift: inherit;
}`;

/** Where a node is in a row: its form follows from it. */
type NodePosition = 'start' | 'middle' | 'end' | { readonly only: Form | null };

function formOf(position: NodePosition): Form {
  if (position === 'start') return 'prefix';
  if (position === 'middle') return 'infix';
  if (position === 'end') return 'postfix';
  return position.only ?? 'infix';
}

/** The spacing and position of an embellished operator, passed to its core `mo`. */
interface Embellishment {
  readonly lspace: Em | null;
  readonly rspace: Em | null;
  readonly position: NodePosition;
  readonly limits: boolean;
}

type CssStyle = 'normal' | 'compact';

/** The math CSS context that an element establishes for its children. */
interface CssContext {
  readonly mathStyle: CssStyle;
  readonly mathShift: CssStyle;
  readonly mathDepth: number;
}

const cssEq = (a: CssContext, b: CssContext) =>
  a.mathStyle === b.mathStyle && a.mathShift === b.mathShift && a.mathDepth === b.mathDepth;
const depthAutoAdd = (c: CssContext): CssContext => ({
  ...c,
  mathDepth: c.mathStyle === 'compact' ? c.mathDepth + 1 : c.mathDepth,
});
const depthAdd = (c: CssContext, n: number): CssContext => ({ ...c, mathDepth: c.mathDepth + n });
const styleCompact = (c: CssContext): CssContext => ({ ...c, mathStyle: 'compact' });
const shiftCompact = (c: CssContext): CssContext => ({ ...c, mathShift: 'compact' });

function cssFrom(size: MathSize, cramped: boolean): CssContext {
  const mathShift: CssStyle = cramped ? 'compact' : 'normal';
  switch (size) {
    case MathSize.Display:
      return { mathStyle: 'normal', mathShift, mathDepth: 0 };
    case MathSize.Text:
      return { mathStyle: 'compact', mathShift, mathDepth: 0 };
    case MathSize.Script:
      return { mathStyle: 'compact', mathShift, mathDepth: 1 };
    case MathSize.ScriptScript:
      return { mathStyle: 'compact', mathShift, mathDepth: 2 };
  }
}

/** Whether a link to a URL may be emitted: the `trust` option. */
export type Trust = (url: string) => boolean;

/** Converts a math item to MathML nodes, like Typst's `convert_math_to_nodes`. */
export function convertMathToNodes(
  item: MathItem,
  block: boolean,
  warnings: SourceDiagnostic[],
  trust: Trust = () => true,
  quoter: SmartQuoter = new SmartQuoter(),
  styles: StyleChain = EMPTY_CHAIN,
  decorations = false,
): HtmlNode[] {
  const ctx = new MathContext(block, warnings, trust, quoter, styles, decorations);
  const nodes = ctx.handleIntoNodes(item);
  // Typst converts content that isn't math to HTML after all of the math:
  // its warnings come after the math's.
  warnings.push(...ctx.deferred);
  return nodes;
}

/** One node, or several in an `mrow`. */
function intoContent(nodes: HtmlNode[]): HtmlNode {
  return nodes.length === 1 ? nodes[0]! : elem('mrow', nodes);
}

class MathContext {
  content: HtmlNode[] = [];
  embellishment: Embellishment | null = null;
  css: CssContext;
  /** For content that isn't math, such as `#strong[x]`. */
  readonly external: ExternalContext;
  /** The warnings of converting content that isn't math, which Typst does after the math. */
  readonly deferred: SourceDiagnostic[] = [];
  /** The text color the elements around the current one set, with decorations; `null` for the page's. */
  color: string | null = null;
  /**
   * The styles content that isn't math is converted to HTML in. Typst's
   * MathML wraps each element it makes for an item, such as an `msup`, in the
   * item's styles, and leaves other content as it is; the HTML conversion
   * that follows sees the styles of the element around the content. At the
   * top, those are the equation's own: a `text(lang: "de")` in the equation
   * doesn't change the quotes in it.
   */
  ambient: StyleChain;

  constructor(
    block: boolean,
    readonly warnings: SourceDiagnostic[],
    trust: Trust,
    quoter: SmartQuoter,
    styles: StyleChain,
    /**
     * Whether to keep what Typst's export drops (docs/DESIGN.md §2.3): text colors,
     * `overline`, `underline` and `cancel`, box borders, and hidden content
     * as an `mphantom`. Off to compare with Typst.
     */
    readonly decorations: boolean,
  ) {
    this.ambient = styles;
    this.css = { mathStyle: block ? 'normal' : 'compact', mathShift: 'normal', mathDepth: 0 };
    const deferred = this.deferred;
    this.external = {
      warnings: deferred,
      decorations,
      budget: new ElementBudget(),
      quoter,
      before: () => lastChar(this.content),
      trust: (url) => {
        if (trust(url)) return true;
        deferred.push(warning(null, `Typlet left out a link to ${url}, as the \`trust\` option doesn't allow it`));
        return false;
      },
      equation: (equation, styles) => {
        const block = equation.block ?? false;
        const size = property('equation', 'size', block ? MathSize.Display : MathSize.Text);
        const nested = chain(styles, [size]);
        const item = resolveEquation(equation.body, nested, deferred, 'html');
        const math = elem('math', convertMathToNodes(item, block, deferred, trust, quoter, nested, decorations));
        if (block) math.attrs.push(['display', 'block']);
        math.external = true;
        return math;
      },
    };
  }

  withCss<T>(css: CssContext, f: () => T): T {
    const prev = this.css;
    this.css = css;
    try {
      return f();
    } finally {
      this.css = prev;
    }
  }

  handleIntoNodes(item: MathItem, only: Form | null = null): HtmlNode[] {
    const prev = this.content;
    this.content = [];
    try {
      const items = asSlice(item);
      items.forEach((child, i) => {
        const position: NodePosition =
          items.length === 1 ? { only } : i === 0 ? 'start' : i === items.length - 1 ? 'end' : 'middle';
        handleRealized(child, this, position);
      });
      return this.content;
    } finally {
      this.content = prev;
    }
  }

  handleIntoNode(item: MathItem): HtmlNode {
    return intoContent(this.handleIntoNodes(item));
  }

  handleIntoNodeWithOnlyForm(item: MathItem, only: Form): HtmlNode {
    return intoContent(this.handleIntoNodes(item, only));
  }

  /** A node for an attachment or accent: postfix, without inert `mo` attributes. */
  handleIntoNodeLone(item: MathItem): HtmlNode {
    return stripInertMoAttrs(this.handleIntoNodeWithOnlyForm(item, 'postfix'));
  }
}

function handleRealized(item: MathItem, ctx: MathContext, position: NodePosition): void {
  // Handle non-component items first.
  if (item.type === 'spacing') {
    ctx.content.push(elem('mspace', [], [['width', lengthToCss(item.amount)]]));
    return;
  }
  if (item.type === 'space') {
    // The space width is hard-coded as (4/18)em.
    ctx.content.push(elem('mspace', [], [['width', emToCss(SPACE_WIDTH)]]));
    return;
  }
  // A tag is a node that writes nothing, which still makes its siblings share an `mrow`.
  if (item.type === 'tag') {
    ctx.content.push(fragment([]));
    return;
  }

  const comp = item;
  const props = comp.props;
  const embellished = isEmbellishedOperator(item);

  const target = cssFrom(props.size, props.cramped);
  // The tracked depth is clamped at 2 to avoid emitting `scriptlevel="2"` everywhere.
  const scriptlevel = target.mathDepth !== Math.min(ctx.css.mathDepth, 2) ? String(target.mathDepth) : null;
  const displaystyle = target.mathStyle !== ctx.css.mathStyle ? String(target.mathStyle === 'normal') : null;
  const css: [string, string][] = [];
  if (target.mathShift !== ctx.css.mathShift) css.push(['math-shift', target.mathShift]);

  // Push an explicit lspace if it won't be added to the attributes of an `mo`.
  if (!embellished && props.lspace !== null && !props.alignFormInfix && props.lspace !== 0) {
    ctx.content.push(withAttr(elem('mspace', [], [['width', `${fmtEm(props.lspace)}em`]]), 'scriptlevel', scriptlevel));
  }

  // For embellished operators which aren't an `mo` element, pass the outer
  // spacing and position to the core operator.
  if (
    embellished &&
    comp.kind.tag !== 'glyph' &&
    comp.kind.tag !== 'text' &&
    ctx.embellishment === null &&
    !props.alignFormInfix
  ) {
    ctx.embellishment = { lspace: props.lspace, rspace: props.rspace, position, limits: hasLimits(item) };
  }

  // The element's own context, established by the attributes emitted on it below.
  const elementCss = cssEq(target, ctx.css) ? ctx.css : target;
  const ambient = ctx.ambient;
  const color = ctx.color;
  // With decorations, a text color that differs from the one around the item.
  const ownColor = ctx.decorations ? colorOf(comp.styles) : color;
  if (wrapsChildren(comp, ctx.decorations)) ctx.ambient = comp.styles;
  ctx.color = ownColor;
  let node: HtmlNode | null;
  try {
    node = ctx.withCss(elementCss, () => handleKind(comp, ctx, props, position));
  } finally {
    ctx.ambient = ambient;
    ctx.color = color;
  }

  if (node !== null) {
    if (typeof node !== 'string' && takesAttributes(node, comp)) {
      withAttr(node, 'scriptlevel', scriptlevel);
      withAttr(node, 'displaystyle', displaystyle);
      if (!node.external) node.css = [...css];
      else for (const [name, value] of css) pushCss(node, name, value);
      if (ownColor !== color && ownColor !== null) pushCss(node, 'color', ownColor);
    }
    ctx.content.push(node);
  }

  // Push an explicit rspace if it won't be added to the attributes of an `mo`.
  if (!embellished && props.rspace !== null && props.rspace !== 0) {
    ctx.content.push(withAttr(elem('mspace', [], [['width', `${fmtEm(props.rspace)}em`]]), 'scriptlevel', scriptlevel));
  }
}

function handleKind(comp: ComponentItem, ctx: MathContext, props: MathProperties, position: NodePosition): HtmlNode | null {
  const kind = comp.kind;
  switch (kind.tag) {
    case 'glyph':
      return handleGlyph(kind, ctx, props, position);
    case 'radical':
      return handleRadical(kind, ctx);
    case 'accent':
      return handleAccent(kind, ctx);
    case 'scripts':
      return handleScripts(kind, ctx);
    case 'primes':
      return makeMo(PRIME_CHAR.repeat(kind.count), ctx, props, position, 'postfix', false, false, false, null);
    case 'table':
      return handleTable(kind, ctx);
    case 'fraction':
      return handleFraction(kind, ctx);
    case 'text':
      return handleText(kind.text, ctx, props, position);
    case 'number':
      return elem('mn', convertChildren([kind.text]));
    case 'fenced':
      return handleFenced(kind, ctx);
    case 'group':
      return ctx.handleIntoNode(comp);
    case 'multiline':
      return handleMultiline(kind.rows, ctx);
    // Polyfills would be required for these in MathML Core.
    case 'skewed-fraction':
      return ignoredMathItem(ctx, kind.numerator, props.span, 'skewed fraction');
    case 'line':
      if (ctx.decorations) return handleLine(kind, ctx);
      return ignoredMathItem(ctx, kind.base, props.span, kind.position === Position.Above ? 'overline' : 'underline');
    case 'cancel':
      if (ctx.decorations) return handleCancel(kind, ctx);
      return ignoredMathItem(ctx, kind.base, props.span, 'cancel');
    case 'external':
      // An element Typst's HTML show rules make wraps its content in its own
      // styles; other content sees the styles of the element around it.
      return externalNode(kind.content, SHOWN_ELEMENTS.has(kind.content.func) ? comp.styles : ctx.ambient, ctx);
    case 'box':
      return externalNode(kind.elem, ctx.ambient, ctx);
  }
}

/** An em value as Typst formats it for `lspace` and `rspace`: Rust's float `Display`. */
function fmtEm(em: number): string {
  return rustDisplayFloat(em);
}

function handleMultiline(rows: AlignedRow[], ctx: MathContext): HtmlNode {
  const cells = rows.map((row) => elem('mtr', row.map((cell) => elem('mtd', ctx.handleIntoNodes(cell)))));
  let cls = MULTILINE_EQUATION_CLASS;
  if ((rows[0]?.length ?? 0) > 1) cls += ` ${ALIGNED_CLASS}`;
  return elem('mtable', cells, [['class', cls]]);
}

function handleFraction(kind: Extract<MathKind, { tag: 'fraction' }>, ctx: MathContext): HtmlNode {
  // UA stylesheet.
  const num = ctx.withCss(styleCompact(depthAutoAdd(ctx.css)), () => ctx.handleIntoNode(kind.numerator));
  const denom = ctx.withCss(shiftCompact(styleCompact(depthAutoAdd(ctx.css))), () =>
    ctx.handleIntoNode(kind.denominator),
  );
  return withAttr(elem('mfrac', [num, denom]), 'linethickness', kind.line ? null : '0');
}

function handleRadical(kind: Extract<MathKind, { tag: 'radical' }>, ctx: MathContext): HtmlNode {
  // UA stylesheet.
  const radicand = ctx.withCss(shiftCompact(ctx.css), () => ctx.handleIntoNodes(kind.radicand));
  if (kind.index) {
    const index = ctx.withCss(shiftCompact(styleCompact(depthAdd(ctx.css, 2))), () => ctx.handleIntoNode(kind.index!));
    return elem('mroot', [intoContent(radicand), index]);
  }
  return elem('msqrt', radicand);
}

function handleGlyph(item: GlyphKind, ctx: MathContext, props: MathProperties, position: NodePosition): HtmlNode {
  const text = item.text;
  const cls = props.class ?? MathClass.Normal;

  // Primes and factorials have class Normal but are semantically postfix
  // operators, so emit `mo`, unless the class was set to something else.
  if (cls === MathClass.Normal && (isPrime(text) || text === '!')) {
    return makeMo(text, ctx, props, position, 'postfix', false, false, false, null);
  }

  let form: Form | null = null;
  let fence = false;
  let separator = false;
  let largeop = false;
  switch (cls) {
    case MathClass.Normal:
    case MathClass.Alphabetic:
    case MathClass.Special:
    case MathClass.GlyphPart:
    case MathClass.Space:
      return withAttr(elem('mi', convertChildren([text])), 'mathvariant', willAutoTransform(text) ? 'normal' : null);
    case MathClass.Diacritic:
      form = 'postfix';
      break;
    case MathClass.Binary:
    case MathClass.Relation:
      form = 'infix';
      break;
    case MathClass.Vary:
    case MathClass.Unary:
      form = 'prefix';
      break;
    case MathClass.Punctuation:
      separator = true;
      break;
    case MathClass.Fence:
      fence = true;
      break;
    case MathClass.Large:
      largeop = item.class === MathClass.Large;
      form = 'prefix';
      break;
    case MathClass.Opening:
      fence = true;
      form = 'prefix';
      break;
    case MathClass.Closing:
      fence = true;
      form = 'postfix';
      break;
  }
  return makeMo(text, ctx, props, position, form, fence, separator, largeop, item.stretch);
}

function handleAccent(kind: Extract<MathKind, { tag: 'accent' }>, ctx: MathContext): HtmlNode {
  const below = kind.position === Position.Below;
  // UA stylesheet.
  const base = ctx.withCss(below ? ctx.css : shiftCompact(ctx.css), () => ctx.handleIntoNode(kind.base));
  // Browsers other than Firefox don't apply the `dtls` feature to accent
  // bases by default; Typst's CSS enables or disables it everywhere.
  const dotted = !kind.exactFrameWidth && kind.position === Position.Above && !kind.dotless ? 'dotted' : null;
  const accent = ctx.handleIntoNodeLone(kind.accent);
  const node = elem(below ? 'munder' : 'mover', [base, accent], [[below ? 'accentunder' : 'accent', 'true']]);
  return withAttr(node, 'class', dotted);
}

/** A text color as CSS, or `null` for black, which draws in the page's color as the HTML does. */
function colorOf(styles: StyleChain): string | null {
  const hex = toHex(textFill(styles));
  return hex === '#000000' ? null : hex;
}

/**
 * `overline` and `underline` as a line stretched over or under the base,
 * which Typst's export drops (docs/DESIGN.md §2.3).
 */
function handleLine(kind: Extract<MathKind, { tag: 'line' }>, ctx: MathContext): HtmlNode {
  const above = kind.position === Position.Above;
  // UA stylesheet, as for accents.
  const base = ctx.withCss(above ? shiftCompact(ctx.css) : ctx.css, () => ctx.handleIntoNode(kind.base));
  const line = elem('mo', [above ? '‾' : '_'], [['stretchy', 'true']]);
  return elem(above ? 'mover' : 'munder', [base, line], [[above ? 'accent' : 'accentunder', 'true']]);
}

/** `cancel` as an `menclose` with its strikes, which Typst's export drops (docs/DESIGN.md §2.3). */
function handleCancel(kind: Extract<MathKind, { tag: 'cancel' }>, ctx: MathContext): HtmlNode {
  const notation = kind.cross ? 'updiagonalstrike downdiagonalstrike' : kind.invertFirstLine ? 'downdiagonalstrike' : 'updiagonalstrike';
  return elem('menclose', [ctx.handleIntoNode(kind.base)], [['notation', notation]]);
}

function handleScripts(kind: Extract<MathKind, { tag: 'scripts' }>, ctx: MathContext): HtmlNode {
  let base = ctx.handleIntoNode(kind.base);

  // UA stylesheet, plus Typst's making bottom attachments cramped.
  const supCss = styleCompact(depthAdd(ctx.css, 1));
  const subCss = shiftCompact(supCss);
  const handle = (item: MathItem | null, css: CssContext) =>
    item === null ? null : ctx.withCss(css, () => ctx.handleIntoNodeLone(item));

  const t = handle(kind.top, supCss);
  const tr = handle(kind.topRight, supCss);
  const tl = handle(kind.topLeft, supCss);
  const b = handle(kind.bottom, subCss);
  const br = handle(kind.bottomRight, subCss);
  const bl = handle(kind.bottomLeft, subCss);

  if (tl === null && bl === null) {
    if (tr === null && br !== null) base = elem('msub', [base, br]);
    else if (tr !== null && br === null) base = elem('msup', [base, tr]);
    else if (tr !== null && br !== null) base = elem('msubsup', [base, br, tr]);
  } else {
    const unwrap = (node: HtmlNode | null) => node ?? elem('mrow');
    base = elem('mmultiscripts', [base, unwrap(br), unwrap(tr), elem('mprescripts'), unwrap(bl), unwrap(tl)]);
  }

  if (t !== null && b === null) base = elem('mover', [base, t]);
  else if (t === null && b !== null) base = elem('munder', [base, b]);
  else if (t !== null && b !== null) base = elem('munderover', [base, b, t]);
  return base;
}

function handleTable(kind: Extract<MathKind, { tag: 'table' }>, ctx: MathContext): HtmlNode {
  const first = kind.cells[0];
  const ncols = first?.length ?? 0;
  const hasSubCols = first?.some((cell) => cell.length > 1) ?? false;

  // Typst stylesheet.
  const css = shiftCompact(styleCompact(depthAutoAdd(ctx.css)));
  const rows = kind.cells.map((row) =>
    elem(
      'mtr',
      row.flatMap((cell) =>
        cell.map((subCol, i) =>
          withAttr(
            elem(
              'mtd',
              ctx.withCss(css, () => ctx.handleIntoNodes(subCol)),
            ),
            'class',
            tableMtdClass(i, cell.length, ncols, kind.alternator),
          ),
        ),
      ),
    ),
  );

  let cls: string | null;
  if (kind.alternator === 'none' && ncols === 1) cls = CASES_CLASS;
  else if (kind.alternator === 'right' && ncols === 1 && hasSubCols) cls = ALIGNED_CLASS;
  else if (kind.align === 'start') cls = LEFT_ALIGN_CLASS;
  else if (kind.align === 'end') cls = RIGHT_ALIGN_CLASS;
  else cls = null;
  return withAttr(elem('mtable', rows), 'class', cls);
}

function handleText(text: string, ctx: MathContext, props: MathProperties, position: NodePosition): HtmlNode {
  if ((props.class ?? MathClass.Normal) === MathClass.Large) {
    return makeMo(text, ctx, props, position, 'prefix', false, false, false, null);
  }
  return elem('mtext', convertChildren([text]));
}

function handleFenced(kind: Extract<MathKind, { tag: 'fenced' }>, ctx: MathContext): HtmlNode {
  const children: HtmlNode[] = [];
  if (kind.open) children.push(ctx.handleIntoNodeWithOnlyForm(kind.open, 'prefix'));
  children.push(ctx.handleIntoNode(fencedBodyItem(kind.body)));
  if (kind.close) children.push(ctx.handleIntoNodeWithOnlyForm(kind.close, 'postfix'));
  // Always an `mrow`: browsers insert inferred `mrow`s inconsistently.
  return elem('mrow', children);
}

function makeMo(
  text: string,
  ctx: MathContext,
  props: MathProperties,
  position: NodePosition,
  form: Form | null,
  fence: boolean,
  separator: boolean,
  largeop: boolean,
  stretch: Stretch | null,
): HtmlNode {
  // The core operator of an embellished operator uses the spacing and
  // position stored in the context.
  const embellishment = ctx.embellishment;
  ctx.embellishment = null;
  let lspace = embellishment ? embellishment.lspace : props.lspace;
  const rspace = embellishment ? embellishment.rspace : props.rspace;
  const pos = embellishment ? embellishment.position : position;
  const limits = embellishment ? embellishment.limits : false;

  if (props.alignFormInfix) {
    form = 'infix';
    // The lspace is gone at this stage; infix spacing is symmetric.
    lspace = rspace;
  }

  const initialForm = formOf(pos);
  const info = operatorInfo(text, form ?? initialForm, form !== null && form !== initialForm);

  // Browsers render a fraction slash with spacing around it, so its spacing
  // is always emitted.
  const forceSpace = text === '/' && (form ?? initialForm) === 'infix';

  const formAttr = form !== null && form !== initialForm ? form : null;
  const l = lspace ?? 0;
  const r = rspace ?? 0;
  const lspaceAttr = forceSpace || l !== info.lspace ? `${fmtEm(l)}em` : null;
  const rspaceAttr = forceSpace || r !== info.rspace ? `${fmtEm(r)}em` : null;
  const fenceAttr = fence !== isFence(text) ? String(fence) : null;
  const separatorAttr = separator !== isSeparator(text) ? String(separator) : null;
  const largeopAttr = largeop !== ((info.properties & LARGEOP) !== 0) ? String(largeop) : null;

  // In compact styles, browsers move top and bottom attachments to the
  // corners; this has to be disabled explicitly.
  const movablelimits =
    limits && ctx.css.mathStyle === 'compact' && (info.properties & MOVABLELIMITS) !== 0 ? 'false' : null;

  const chars = [...text];
  const axis = chars.length === 1 && isStretchAxisInline(chars[0]!.codePointAt(0)!) ? 'x' : 'y';
  const explicit = stretch !== null && isExplicit(stretch, axis);
  const stretchy = explicit !== ((info.properties & STRETCHY) !== 0) ? String(explicit) : null;

  // `maxsize` is infinity by default.
  let symmetric: string | null = null;
  let minsize: string | null = null;
  if (explicit) {
    symmetric = axis === 'y' && (info.properties & SYMMETRIC) === 0 ? 'true' : null;
    const requested = resolveRequested(stretch!, axis);
    minsize = requested ? relToCss(requested) : null;
  }

  const node = elem('mo', convertChildren([text]));
  withAttr(node, 'form', formAttr);
  withAttr(node, 'fence', fenceAttr);
  withAttr(node, 'separator', separatorAttr);
  withAttr(node, 'lspace', lspaceAttr);
  withAttr(node, 'rspace', rspaceAttr);
  withAttr(node, 'stretchy', stretchy);
  withAttr(node, 'symmetric', symmetric);
  withAttr(node, 'minsize', minsize);
  withAttr(node, 'largeop', largeopAttr);
  withAttr(node, 'movablelimits', movablelimits);
  return node;
}

function tableMtdClass(index: number, count: number, ncols: number, alternator: string): string | null {
  if (count <= 1 || ncols <= 1 || alternator !== 'right') return null;
  const align = index % 2 === 0 ? RIGHT_ALIGN_CLASS : LEFT_ALIGN_CLASS;
  const flush = index === 0 ? RIGHT_FLUSH_CLASS : index + 1 === count ? LEFT_FLUSH_CLASS : FLUSHED_CLASS;
  return `${align} ${flush}`;
}

/** Removes `form`, `lspace` and `rspace` from an `mo`, where they have no effect. */
function stripInertMoAttrs(node: HtmlNode): HtmlNode {
  if (typeof node !== 'string' && node.tag === 'mo') {
    node.attrs = node.attrs.filter(([a]) => a !== 'form' && a !== 'lspace' && a !== 'rspace');
  }
  return node;
}

function isPrime(text: string): boolean {
  return ['′', '″', '‴', '⁗'].includes(text);
}

const NOT_OPERATOR_CLASSES = new Set([
  MathClass.Normal,
  MathClass.Alphabetic,
  MathClass.Special,
  MathClass.GlyphPart,
  MathClass.Space,
]);

/** Whether an item is an embellished operator: an operator, possibly with scripts or accents. */
function isEmbellishedOperator(item: MathItem): boolean {
  if (item.type !== 'component') return false;
  const kind = item.kind;
  switch (kind.tag) {
    case 'glyph':
      return !NOT_OPERATOR_CLASSES.has(item.props.class ?? MathClass.Normal);
    case 'text':
      return (item.props.class ?? MathClass.Normal) === MathClass.Large;
    case 'scripts':
      return isEmbellishedOperator(kind.base);
    case 'accent':
      return isEmbellishedOperator(kind.base);
    case 'fraction':
      return isEmbellishedOperator(kind.numerator);
    case 'group': {
      const items = kind.items.filter((child) => !isIgnorant(child) && !isSpaceLike(child));
      return items.length === 1 && isEmbellishedOperator(items[0]!);
    }
    default:
      return false;
  }
}

function isSpaceLike(item: MathItem): boolean {
  if (item.type === 'spacing' || item.type === 'space') return true;
  if (item.type === 'tag') return false;
  const kind = item.kind;
  if (kind.tag === 'text') return (item.props.class ?? MathClass.Normal) !== MathClass.Large;
  if (kind.tag === 'group') return kind.items.filter((child) => !isIgnorant(child)).every(isSpaceLike);
  return false;
}

function hasLimits(item: MathItem): boolean {
  if (item.type !== 'component') return false;
  const kind = item.kind;
  switch (kind.tag) {
    case 'scripts':
      return kind.top !== null || kind.bottom !== null || hasLimits(kind.base);
    case 'accent':
      return hasLimits(kind.base);
    case 'fraction':
      return hasLimits(kind.numerator);
    case 'group':
      return kind.items.some(hasLimits);
    default:
      return false;
  }
}

function ignoredMathItem(ctx: MathContext, body: MathItem, span: Span, name: string): HtmlNode {
  ctx.warnings.push(warning(span, `${name} was ignored during MathML export`));
  return ctx.handleIntoNode(body);
}

/** HTML for content that isn't math, such as `#strong[x]` or code shown for a value like `#auto`. */
/**
 * Content Typst's HTML show rules turn into one HTML element, such as
 * `<strong>`. Typst's MathML gives that element the attributes of a token, as
 * `modify_inner_html_elem` does, and converts its content in the styles of
 * the equation around it.
 */
const SHOWN_ELEMENTS: ReadonlySet<string> = new Set(['strong', 'emph', 'highlight', 'link', 'raw']);

/**
 * Whether an item makes an element around its children, which then see its
 * styles: not content that isn't math, and not items that pass a lone
 * child's node on, such as a group of one. Typst's export drops `overline`,
 * `underline`, `cancel` and skewed fractions, and passes on the node of what
 * they hold: an `mrow` around several items wraps them in its styles, as a
 * group's does.
 */
function wrapsChildren(comp: ComponentItem, decorations: boolean): boolean {
  switch (comp.kind.tag) {
    case 'external':
    case 'box':
      return false;
    case 'line':
    case 'cancel':
      return decorations || asSlice(comp.kind.base).length !== 1;
    case 'skewed-fraction':
      return asSlice(comp.kind.numerator).length !== 1;
    case 'group':
      return comp.kind.items.length !== 1;
    default:
      return true;
  }
}

/** Whether MathML attributes apply to a node: math elements, and the elements of shown content. */
function takesAttributes(node: HtmlElement, comp: ComponentItem): boolean {
  if (!node.external) return true;
  if (comp.kind.tag !== 'external' || node.tag === '') return false;
  const func = comp.kind.content.func;
  return SHOWN_ELEMENTS.has(func) && (func !== 'link' || node.tag === 'a');
}

function externalNode(content: Content, styles: StyleChain, ctx: MathContext): HtmlNode {
  if (content.func === 'raw') return rawToHtml(content.text, content.lang ?? null);
  const nodes = mathContentToHtml(content, styles, ctx.external);
  return nodes.length === 1 && typeof nodes[0] !== 'string' ? nodes[0]! : fragment(nodes);
}

