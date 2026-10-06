// Typlet original: not ported from Typst.
//
// Renders the formulas in a page's text, like KaTeX's auto-render. By
// default, formulas follow Typst's syntax: `$x$` is inline, `$ x $`, with
// spaces inside both dollar signs, is display, and `\$` is a dollar sign.
// Where a formula ends is found with Typst's own parser, so dollar signs in
// strings and content blocks, as in `$#box[$x$]$`, don't end it early.

import { type RenderOptions, SyntaxKind, type SyntaxNode, TypletError, parse, render } from 'typlet';

/** A pair of delimiters around formulas, as in KaTeX's auto-render. */
export interface Delimiter {
  readonly left: string;
  readonly right: string;
  /** Whether the formulas between them are display formulas. */
  readonly display: boolean;
}

/** Options for {@link renderMathInElement}: Typlet's render options, and these. */
export interface AutoRenderOptions extends RenderOptions {
  /**
   * How formulas are delimited:
   * - `typst`, the default: `$x$` is inline and `$ x $` is display, as in
   *   Typst, and `\$` is a dollar sign;
   * - `markdown`: `$$x$$` is display and `$x$` is inline, as in Markdown with
   *   math, and `\$` is a dollar sign;
   * - a list of delimiters, tried in order, as in KaTeX's auto-render.
   */
  delimiters?: 'typst' | 'markdown' | readonly Delimiter[];
  /** Elements whose text is left alone. Defaults to `script`, `noscript`, `style`, `textarea`, `pre`, `code`, `option`, `math` and `svg`. */
  ignoredTags?: readonly string[];
  /** Classes of elements whose text is left alone. Formulas Typlet rendered are always left alone. */
  ignoredClasses?: readonly string[];
  /**
   * Called for a formula that fails to render, which stays as text. Defaults
   * to `console.error`. With `throwOnError: false`, the error is rendered in
   * place instead.
   */
  errorCallback?: (message: string, error: TypletError) => void;
  /** Changes a formula's source before it is rendered. */
  preProcess?: (source: string) => string;
}

/** Text, or a formula with its delimiters, from {@link splitAtDelimiters}. */
export type Segment =
  | { readonly type: 'text'; readonly data: string }
  | { readonly type: 'math'; readonly data: string; readonly rawData: string; readonly display: boolean };

const MARKDOWN: readonly Delimiter[] = [
  { left: '$$', right: '$$', display: true },
  { left: '$', right: '$', display: false },
];

const DEFAULT_IGNORED_TAGS = ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option', 'math', 'svg'];

// Typlet's own output, and formulas waiting for a fallback.
const TYPLET_CLASSES = ['typlet', 'typlet-display', 'typlet-error', 'typlet-pending'];

/**
 * The end of the equation that starts at a dollar sign, and whether it is a
 * display equation, as Typst parses it, or `null` if it never ends. The
 * parser sees a window of the text at a time: an equation that runs past
 * the window looks unterminated, and the window grows.
 */
function typstEquation(text: string, start: number): { end: number; display: boolean } | null {
  for (let window = 256; ; window *= 4) {
    const equation: SyntaxNode | undefined = parse(text.slice(start, start + window), { mode: 'markup' }).children[0];
    const children = equation?.children ?? [];
    if (equation?.kind === SyntaxKind.Equation && children.length >= 2 && children.at(-1)!.kind === SyntaxKind.Dollar) {
      // Typst's rule: spaces right inside both dollar signs make a block.
      const display = children[1]!.kind === SyntaxKind.Space && children.at(-2)!.kind === SyntaxKind.Space;
      return { end: start + equation.len, display };
    }
    if (start + window >= text.length) return null;
  }
}

/** Splits text at formulas with Typst's syntax. */
function splitTypst(text: string): Segment[] {
  const segments: Segment[] = [];
  let pending = '';
  let from = 0;
  for (let i = 0; i < text.length; ) {
    if (text.startsWith('\\$', i)) {
      pending += `${text.slice(from, i)}$`;
      i += 2;
      from = i;
      continue;
    }
    if (text[i] !== '$') {
      i++;
      continue;
    }
    const equation = typstEquation(text, i);
    if (!equation) {
      i++;
      continue;
    }
    pending += text.slice(from, i);
    if (pending) segments.push({ type: 'text', data: pending });
    pending = '';
    const rawData = text.slice(i, equation.end);
    segments.push({ type: 'math', data: rawData.slice(1, -1), rawData, display: equation.display });
    i = from = equation.end;
  }
  pending += text.slice(from);
  if (pending) segments.push({ type: 'text', data: pending });
  return segments;
}

/**
 * Where a formula that starts at `start` ends with `right`, like KaTeX's
 * `findEndOfMath`: escaped characters and Typst's strings, which may hold
 * the delimiter, are skipped. -1 if it never ends.
 */
function findEnd(text: string, right: string, start: number): number {
  for (let i = start; i < text.length; i++) {
    if (text.startsWith(right, i)) return i;
    if (text[i] === '\\') i++;
    else if (text[i] === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
    }
  }
  return -1;
}

/** Splits text at formulas between delimiters, tried in order, as KaTeX's `splitAtDelimiters` does. */
function splitDelimited(text: string, delimiters: readonly Delimiter[]): Segment[] {
  const segments: Segment[] = [];
  let pending = '';
  let from = 0;
  for (let i = 0; i < text.length; ) {
    if (text.startsWith('\\$', i)) {
      pending += `${text.slice(from, i)}$`;
      i += 2;
      from = i;
      continue;
    }
    const delimiter = delimiters.find((d) => text.startsWith(d.left, i));
    const end = delimiter ? findEnd(text, delimiter.right, i + delimiter.left.length) : -1;
    if (!delimiter || end < 0) {
      i++;
      continue;
    }
    pending += text.slice(from, i);
    if (pending) segments.push({ type: 'text', data: pending });
    pending = '';
    const stop = end + delimiter.right.length;
    segments.push({
      type: 'math',
      data: text.slice(i + delimiter.left.length, end),
      rawData: text.slice(i, stop),
      display: delimiter.display,
    });
    i = from = stop;
  }
  pending += text.slice(from);
  if (pending) segments.push({ type: 'text', data: pending });
  return segments;
}

/** Splits text into text and formulas, by the delimiters of {@link AutoRenderOptions}. */
export function splitAtDelimiters(text: string, delimiters: AutoRenderOptions['delimiters'] = 'typst'): Segment[] {
  if (delimiters === 'typst') return splitTypst(text);
  return splitDelimited(text, delimiters === 'markdown' ? MARKDOWN : delimiters);
}

interface Settings {
  readonly options: AutoRenderOptions;
  readonly delimiters: NonNullable<AutoRenderOptions['delimiters']>;
  readonly ignoredTags: ReadonlySet<string>;
  readonly ignoredClasses: readonly string[];
  readonly errorCallback: (message: string, error: TypletError) => void;
}

/** The text with its formulas rendered, or `null` if it has none. */
function renderMathInText(text: string, settings: Settings, doc: Document): DocumentFragment | null {
  const segments = splitAtDelimiters(text, settings.delimiters);
  if (segments.length === 1 && segments[0]!.type === 'text' && segments[0]!.data === text) return null;
  const fragment = doc.createDocumentFragment();
  for (const segment of segments) {
    if (segment.type === 'text') {
      fragment.append(doc.createTextNode(segment.data));
      continue;
    }
    const { options } = settings;
    const span = doc.createElement('span');
    const source = options.preProcess ? options.preProcess(segment.data) : segment.data;
    try {
      render(source, span, { ...options, displayMode: segment.display });
    } catch (error) {
      if (!(error instanceof TypletError)) throw error;
      settings.errorCallback(`Typlet auto-render: failed to render ${segment.rawData}`, error);
      fragment.append(doc.createTextNode(segment.rawData));
      continue;
    }
    fragment.append(span);
  }
  return fragment;
}

function renderElem(element: Element, settings: Settings): void {
  const doc = element.ownerDocument;
  for (let i = 0; i < element.childNodes.length; i++) {
    const child = element.childNodes[i]!;
    if (child.nodeType === 3) {
      // Adjacent text nodes, as scripts may leave them, are one text.
      let text = child.textContent ?? '';
      let siblings = 0;
      for (let next = child.nextSibling; next?.nodeType === 3; next = next.nextSibling) {
        text += next.textContent ?? '';
        siblings++;
      }
      const fragment = renderMathInText(text, settings, doc);
      if (fragment) {
        for (let j = 0; j < siblings; j++) child.nextSibling!.remove();
        i += fragment.childNodes.length - 1;
        element.replaceChild(fragment, child);
      } else {
        i += siblings;
      }
    } else if (child.nodeType === 1) {
      const el = child as Element;
      const ignored =
        settings.ignoredTags.has(el.localName.toLowerCase()) ||
        settings.ignoredClasses.some((name) => el.classList.contains(name)) ||
        TYPLET_CLASSES.some((name) => el.classList.contains(name));
      if (!ignored) renderElem(el, settings);
    }
  }
}

/**
 * Renders the formulas in an element's text, and in its descendants'. Display
 * equations that a preamble numbers are numbered in order, through one
 * counter for the call, unless `equationCounter` is given.
 */
export function renderMathInElement(element: Element, options: AutoRenderOptions = {}): void {
  if (!element) throw new Error('No element provided to render');
  renderElem(element, {
    options: { ...options, equationCounter: options.equationCounter ?? { value: 0 } },
    delimiters: options.delimiters ?? 'typst',
    ignoredTags: new Set(options.ignoredTags ?? DEFAULT_IGNORED_TAGS),
    ignoredClasses: options.ignoredClasses ?? [],
    errorCallback: options.errorCallback ?? ((message, error) => console.error(message, error)),
  });
}

export default renderMathInElement;
