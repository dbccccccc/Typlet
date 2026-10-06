// Ported from Typst 0.15.1: crates/typst-html/src/convert.rs, crates/typst-html/src/rules.rs, crates/typst-html/src/fragment.rs, crates/typst-realize/src/lib.rs, crates/typst-library/src/text/smartquote.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// Content in a formula that isn't math, such as `#strong[x]` or a box, as
// Typst's HTML export converts it: HTML elements and text inside the MathML.

import { toHex } from '../eval/color.js';
import type { BoxElem, Content, EquationElem, Stroke } from '../eval/content.js';
import { type ElementBudget, type SourceDiagnostic, warning } from '../eval/diag.js';
import { type Length, type RelLength, absPt } from '../eval/layout.js';
import { type StyleChain, chain, get } from '../eval/styles.js';
import { type Pair, collapseSpaces } from '../ir/resolve.js';
import { type HtmlElement, type HtmlNode, convertChildren, elem, lengthToCss, protectSpaces, pushCss } from './html.js';
import { rawToHtml } from './raw.js';
import { isAlphabetic, isDefaultIgnorable, isNumeric } from '../syntax/unicode.js';

/** A stroke's default thickness. */
const ONE_POINT: Length = { abs: absPt(1), em: 0 };

/** The quotes smart quotes become: single open, single close, double open and double close. */
export type SmartQuotes = readonly [string, string, string, string];

const ENGLISH_QUOTES: SmartQuotes = ['‘', '’', '“', '”'];
const LOW_HIGH_QUOTES: SmartQuotes = ['‚', '‘', '„', '“'];
const GUILLEMETS: SmartQuotes = ['“', '”', '«', '»'];
const RTL_LANGUAGES = new Set(['ar', 'dv', 'fa', 'he', 'ks', 'pa', 'ps', 'sd', 'ug', 'ur', 'yi']);

/** Whether a language is written right to left, like `Lang::dir`. */
export const isRtlLanguage = (lang: string): boolean => RTL_LANGUAGES.has(lang);

/**
 * The quotes of a language and region, like `SmartQuotes::get`. Typlet has
 * no `smartquote` set rules, so there are no custom or alternative quotes.
 */
export function smartQuotes(lang: string, region: string | null): SmartQuotes {
  switch (lang) {
    case 'de':
      return region === 'CH' || region === 'LI' ? ['‹', '›', '«', '»'] : LOW_HIGH_QUOTES;
    case 'fr':
      return region === 'CH'
        ? ['‹\u202F', '\u202F›', '«\u202F', '\u202F»']
        : ['“', '”', '«\u202F', '\u202F»'];
    case 'cs':
    case 'et':
    case 'is':
    case 'lt':
    case 'lv':
    case 'sk':
    case 'sl':
      return LOW_HIGH_QUOTES;
    case 'gl':
    case 'it':
    case 'la':
    case 'uk':
      return GUILLEMETS;
    case 'bs':
    case 'fi':
    case 'sv':
    case 'he':
      return ['’', '’', '”', '”'];
    case 'es':
      if (region === 'ES' || region === null) return GUILLEMETS;
      break;
    case 'hu':
    case 'pl':
    case 'ro':
      return ['’', '’', '„', '”'];
    case 'no':
    case 'nb':
    case 'nn':
      return ['’', '’', '«', '»'];
    case 'ru':
      return ['„', '“', '«', '»'];
    case 'el':
      return ['‘', '’', '«', '»'];
    case 'hr':
      return ['‘', '’', '„', '”'];
    case 'bg':
      return ['’', '’', '„', '“'];
    case 'ar':
      return ['’', '‘', '«', '»'];
  }
  return isRtlLanguage(lang) ? ['’', '‘', '”', '“'] : ENGLISH_QUOTES;
}

/** The quotes of the text's language and region, like `SmartQuotes::get_in`. */
export const smartQuotesIn = (styles: StyleChain): SmartQuotes =>
  smartQuotes(get(styles, 'text', 'lang', 'en'), get<string | null>(styles, 'text', 'region', null));

/** Decides which quote a smart quote becomes, like Typst's `SmartQuoter`. */
export class SmartQuoter {
  private depth = 0;
  private kinds = 0;

  /** Forgets the open quotes, as after a block-level element. */
  reset(): void {
    this.depth = 0;
    this.kinds = 0;
  }

  quote(before: string | undefined, double: boolean, quotes: SmartQuotes): string {
    const opened = this.depth > 0 ? ((this.kinds >> (this.depth - 1)) & 1) === 1 : null;
    const c = before ?? ' ';
    // After a number, a prime, unless a quote of this kind is open.
    if (isNumeric(c.codePointAt(0)!) && opened !== double) return double ? '″' : '′';
    // After a letter or an object, a single quote is an apostrophe.
    if (!double && opened !== false && (isAlphabetic(c.codePointAt(0)!) || c === '￼')) return '’';
    // Close the quote of this kind that was opened last.
    if (opened === double && !/\s/u.test(c) && !/[\n\v\f\r\u0085\u2028\u2029]/.test(c) && !'({['.includes(c)) {
      this.depth--;
      this.kinds &= (1 << this.depth) - 1;
      return quotes[double ? 3 : 1];
    }
    if (this.depth < 32) {
      this.kinds |= (double ? 1 : 0) << this.depth;
      this.depth++;
    }
    return quotes[double ? 2 : 0];
  }
}

/** The last character of HTML nodes, looking into elements, like `last_char`. */
export function lastChar(nodes: readonly HtmlNode[]): string | undefined {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    const c =
      typeof node === 'string'
        ? [...node].reverse().find((ch) => !isDefaultIgnorable(ch.codePointAt(0)!))
        : lastChar(node.children);
    if (c !== undefined) return c;
  }
  return undefined;
}

/** What converting external content needs from the MathML around it. */
export interface ExternalContext {
  readonly warnings: SourceDiagnostic[];
  readonly budget: ElementBudget;
  readonly quoter: SmartQuoter;
  /** The last character before the content, for smart quotes. */
  before(): string | undefined;
  /** The MathML of an equation in the content: a `<math>` element. */
  equation(equation: EquationElem, styles: StyleChain): HtmlElement;
  /** Whether links may be emitted (the `trust` option). */
  trust(url: string): boolean;
  /**
   * Whether to keep what Typst's export drops (docs/DESIGN.md §2.3): box borders,
   * and hidden content as an `mphantom`. Off to compare with Typst.
   */
  readonly decorations: boolean;
}

/** Four values of a CSS shorthand, as one where they are equal. */
const shorthand = (values: readonly string[]): string => (values.every((v) => v === values[0]) ? values[0]! : values.join(' '));

/** A box's border, padding, fill and corners as CSS, for the decorations Typst's export drops. */
function boxCss(box: BoxElem): [string, string][] {
  const css: [string, string][] = [];
  const border = (stroke: Stroke | null | undefined): string | null =>
    stroke ? `${lengthToCss(stroke.thickness ?? ONE_POINT)} ${stroke.dash ? 'dashed' : 'solid'} ${stroke.paint ? toHex(stroke.paint) : 'currentColor'}` : null;
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  const borders = sides.map((side) => border(box.stroke?.[side]));
  if (borders.every((b) => b === borders[0])) {
    if (borders[0]) css.push(['border', borders[0]]);
  } else {
    sides.forEach((side, i) => {
      if (borders[i]) css.push([`border-${side}`, borders[i]!]);
    });
  }
  const length = (rel: RelLength | undefined): string => (rel ? lengthToCss(rel.abs) : '0');
  const padding = sides.map((side) => length(box.inset?.[side]));
  if (padding.some((p) => p !== '0')) css.push(['padding', shorthand(padding)]);
  const corners = (['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const).map((corner) => length(box.radius?.[corner]));
  if (corners.some((c) => c !== '0')) css.push(['border-radius', shorthand(corners)]);
  if (box.fill) css.push(['background-color', toHex(box.fill)]);
  return css;
}

/** Hidden content as MathML that keeps its space: text in `mtext`, and nested equations' MathML. */
function phantom(nodes: HtmlNode[]): HtmlElement {
  const children = nodes.flatMap((node): HtmlNode[] => {
    if (typeof node === 'string') return [elem('mtext', [node])];
    if (node.tag === 'math') return node.children;
    return [elem('mtext', [node])];
  });
  const node = elem('mphantom', children);
  node.external = true;
  return node;
}

/** A fragment: nodes without an element of their own, which serialization flattens. */
export function fragment(children: HtmlNode[]): HtmlElement {
  const node = elem('', children);
  node.external = true;
  return node;
}

/**
 * Converts content to HTML nodes, like `html_inline_fragment`: realized as a
 * fragment, then converted with Typst's HTML show rules.
 */
export function contentToHtml(content: Content, styles: StyleChain, ctx: ExternalContext): HtmlNode[] {
  const out: HtmlNode[] = [];
  for (const child of realizeFragment(content, styles, ctx)) {
    if ('paragraph' in child) out.push(paragraphToHtml(child.paragraph, ctx));
    else convert(child[0], child[1], ctx, out);
  }
  return convertChildren(out);
}

/**
 * Converts content that math realization passed on, such as `#strong[x]` in a
 * formula: no paragraphs form there, and spaces collapse over the whole.
 */
export function mathContentToHtml(content: Content, styles: StyleChain, ctx: ExternalContext): HtmlNode[] {
  const pairs = flatten(content, styles, ctx);
  collapseSpaces(pairs);
  const out: HtmlNode[] = [];
  for (const [elem, elemStyles] of pairs) convert(elem, elemStyles, ctx, out);
  return convertChildren(out);
}

/** Flattens content into elements with their styles. */
function flatten(content: Content, styles: StyleChain, ctx: ExternalContext): Pair[] {
  const pairs: Pair[] = [];
  const visit = (c: Content, s: StyleChain): void => {
    if (c.func === 'sequence') {
      ctx.budget.visit(c.span);
      for (const child of c.children) visit(child, s);
    } else if (c.func === 'styled') {
      ctx.budget.visit(c.span);
      visit(c.child, chain(s, c.styles));
    } else {
      pairs.push([c, s]);
    }
  };
  visit(content, styles);
  return pairs;
}

/** An element with its styles, or a paragraph of them. */
type Realized = Pair | { readonly paragraph: Pair[] };

/**
 * How an element takes part in paragraphs, as typst-realize's `PAR` grouping
 * rule decides: text, spacing, line breaks, boxes and the phrasing elements
 * HTML show rules make start or continue a paragraph, spaces continue one, and
 * anything else interrupts it, such as a block equation. `hide` has no HTML
 * show rule, so it interrupts paragraphs, unless the decorations draw it.
 */
function parEffect(content: Content, ctx: ExternalContext): 'trigger' | 'inner' | 'interrupt' {
  switch (content.func) {
    case 'text':
    case 'symbol':
    case 'h':
    case 'linebreak':
    case 'smartquote':
    case 'box':
    case 'strong':
    case 'emph':
    case 'highlight':
    case 'link':
    case 'raw':
      return 'trigger';
    // A block equation is shown in a block.
    case 'equation':
      return content.block ? 'interrupt' : 'trigger';
    case 'space':
      return 'inner';
    case 'hide':
      return ctx.decorations ? 'trigger' : 'interrupt';
    default:
      return 'interrupt';
  }
}

/**
 * Realizes content as Typst realizes a fragment of HTML: flattened into
 * elements with their styles, which are grouped into paragraphs unless they
 * are all inline. Spaces collapse as in Typst: none at the start or end of
 * the fragment or a paragraph, none next to a line break, and one where
 * several meet. Spaces outside paragraphs are dropped, and paragraph breaks
 * only end paragraphs.
 */
function realizeFragment(content: Content, styles: StyleChain, ctx: ExternalContext): Realized[] {
  const pairs = flatten(content, styles, ctx);
  const sink: Realized[] = [];
  let group: Pair[] | null = null;
  let sawParbreak = false;
  const finishGroup = (paragraph: Pair[]): void => {
    collapseSpaces(paragraph);
    sink.push({ paragraph });
  };
  for (const pair of pairs) {
    const effect = parEffect(pair[0], ctx);
    if (group !== null) {
      if (effect !== 'interrupt') {
        group.push(pair);
        continue;
      }
      finishGroup(group);
      group = null;
    }
    if (effect === 'trigger') group = [pair];
    else if (pair[0].func === 'parbreak') sawParbreak = true;
    else if (effect !== 'inner') sink.push(pair);
  }
  // A fragment that is all inline stays inline.
  if (group !== null && sink.length === 0 && !sawParbreak) {
    collapseSpaces(group);
    return group;
  }
  if (group !== null) finishGroup(group);
  return sink;
}

/**
 * A paragraph, as Typst's HTML export makes it: a `<p>` whose body is
 * converted as a block, with smart quotes of its own and protected spaces.
 * Quotes after it start afresh.
 */
function paragraphToHtml(pairs: Pair[], ctx: ExternalContext): HtmlElement {
  const body: HtmlNode[] = [];
  const inner: ExternalContext = { ...ctx, quoter: new SmartQuoter(), before: () => undefined };
  for (const [content, styles] of pairs) convert(content, styles, inner, body);
  const children = convertChildren(body);
  protectSpaces(children);
  ctx.quoter.reset();
  const node = elem('p', children);
  node.external = true;
  return node;
}

function convert(content: Content, styles: StyleChain, ctx: ExternalContext, out: HtmlNode[]): void {
  ctx.budget.visit(content.span);
  const html = (tag: string, body: Content, attrs: [string, string][] = []): HtmlElement => {
    const node = elem(tag, contentToHtml(body, styles, fragmentContext(ctx)), attrs);
    node.external = true;
    return node;
  };
  switch (content.func) {
    case 'sequence':
      for (const child of content.children) convert(child, styles, ctx, out);
      return;
    case 'styled':
      convert(content.child, chain(styles, content.styles), ctx, out);
      return;
    case 'text':
    case 'symbol':
      out.push(content.text);
      return;
    case 'space':
      out.push(' ');
      return;
    case 'linebreak':
      out.push(elem('br'));
      return;
    case 'smartquote':
      out.push(ctx.quoter.quote(lastChar(out) ?? ctx.before(), content.double ?? true, smartQuotesIn(styles)));
      return;
    case 'strong':
      out.push(html('strong', content.body));
      return;
    case 'emph':
      out.push(html('em', content.body));
      return;
    case 'highlight':
      out.push(html('mark', content.body));
      return;
    case 'link':
      // Without trust, the body shows without the link.
      if (ctx.trust(content.dest)) out.push(html('a', content.body, [['href', content.dest]]));
      else convert(content.body, styles, ctx, out);
      return;
    case 'raw':
      out.push(rawToHtml(content.text, content.lang ?? null));
      return;
    case 'equation':
      out.push(ctx.equation(content, styles));
      return;
    case 'box': {
      const children = content.body ? contentToHtml(content.body, styles, fragmentContext(ctx)) : [];
      const decorations = ctx.decorations ? boxCss(content) : [];
      // A lone element stays as it is, made inline; anything else goes in an
      // inline block, as does a lone element in a box that keeps its
      // decorations.
      if (children.length === 1 && typeof children[0] !== 'string' && decorations.length === 0) {
        out.push(makeInlineLevel(children[0]!));
        return;
      }
      const span = elem('span', children);
      pushCss(span, 'display', 'inline-block');
      for (const [name, value] of decorations) pushCss(span, name, value);
      span.external = true;
      out.push(span);
      return;
    }
    case 'hide':
      // Typst's export drops hidden content, and its space.
      if (ctx.decorations) {
        out.push(phantom(contentToHtml(content.body, styles, fragmentContext(ctx))));
        return;
      }
      ctx.warnings.push(warning(content.span, 'hide was ignored during HTML export'));
      return;
    case 'h':
      // Zero-width spacing is nothing; other spacing has no HTML.
      if ('rel' in content.amount && content.amount.rel.rel === 0 && content.amount.rel.abs.abs === 0 && content.amount.rel.abs.em === 0) return;
      ctx.warnings.push(warning(content.span, 'h was ignored during HTML export'));
      return;
    default:
      ctx.warnings.push(warning(content.span, `${content.func} was ignored during HTML export`));
  }
}

/**
 * Makes a box's lone element render inline, like `make_inline_level`: a block
 * equation keeps its `display` attribute and is displayed inline, and other
 * elements lose their CSS `display`.
 */
function makeInlineLevel(node: HtmlElement): HtmlElement {
  if (node.tag === 'math' && node.attrs.some(([name, value]) => name === 'display' && value === 'block')) {
    pushCss(node, 'display', 'inline math');
  } else {
    node.css = node.css.filter(([name]) => name !== 'display');
  }
  return node;
}

/**
 * The context for the body of a box or an inline element, which Typst
 * converts with a converter of its own: smart quotes at its start don't look
 * back, but the quotes that are open stay open.
 */
function fragmentContext(ctx: ExternalContext): ExternalContext {
  return { ...ctx, before: () => undefined };
}
