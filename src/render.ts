// Typlet original: not ported from Typst.
//
// The rendering API's core, with options named after KaTeX's where the
// meaning carries over. The entry points define `renderToString` and
// `render` on it (docs/DESIGN.md §2).

import type { SourceDiagnostic } from './eval/diag.js';
import { SourceError, setElementLimit, warning } from './eval/diag.js';
import type { Content } from './eval/content.js';
import type { DrawContext } from './html/html.js';
import { DEFAULT_LIMITS, type Limits } from './eval/func.js';
import { type Preamble, evalFormula, evalPreamble } from './eval/index.js';
import type { StyleChain } from './eval/styles.js';
import type { MathItem } from './ir/item.js';
import { MathResolver, equationStyles, resolveEquation, setMaxSize } from './ir/resolve.js';
import { itemToMathml } from './mathml/index.js';
import { parse, parseMath } from './syntax/index.js';

/** How a formula is rendered (docs/DESIGN.md §2). */
export type Output = 'htmlAndMathml' | 'html' | 'mathml';

/** What to do with a warning, such as the use of a deprecated symbol. */
export type Strictness = 'ignore' | 'warn' | 'error';

/** What the `trust` option decides on: a link's URL, as KaTeX's `trust` does. */
export interface TrustContext {
  readonly url: string;
  /** The URL's scheme in lowercase, such as `https` or `mailto`, or `_relative` for a URL without one. */
  readonly protocol: string;
}

/**
 * A URL's scheme as browsers read it, or `_relative` without one, or `null`
 * if it is malformed. Browsers skip leading spaces and control characters,
 * and drop tabs and newlines, before they read the scheme.
 */
export function protocolOf(url: string): string | null {
  let start = 0;
  while (start < url.length && url.charCodeAt(start) <= 0x20) start++;
  const text = url.slice(start).replace(/[\t\n\r]/g, '');
  const end = text.search(/[:/?#\\]/);
  if (end < 0 || text[end] !== ':') return '_relative';
  const scheme = text.slice(0, end);
  return /^[a-z][a-z0-9+.-]*$/i.test(scheme) ? scheme.toLowerCase() : null;
}

export interface RenderOptions {
  /** Render as a display (block) formula, centered on its own line. Default `false`. */
  displayMode?: boolean;
  /**
   * The output: `htmlAndMathml` (the default) for HTML laid out by Typlet plus
   * MathML for screen readers, `html` for the HTML alone, or `mathml` for
   * MathML laid out by the browser.
   */
  output?: Output;
  /** Throw a `TypletError` for an invalid formula. When `false`, render the source in `errorColor` instead. Default `true`. */
  throwOnError?: boolean;
  /** The color of formulas that failed to render when `throwOnError` is `false`. Default `#cc0000`. */
  errorColor?: string;
  /** What to do with warnings: ignore them, log them with `console.warn` (the default), or fail. */
  strict?: Strictness | ((warning: TypletWarning) => Strictness);
  /**
   * Whether to draw links, which can harm pages with untrusted formulas:
   * `true`, `false` (the default), or a function that decides for each URL
   * and its protocol, such as `({ protocol }) => protocol === 'https'`.
   * Without trust, a link's body shows without the link. A URL whose scheme
   * is malformed is never trusted.
   */
  trust?: boolean | ((context: TrustContext) => boolean);
  /** The most function calls and loop iterations per formula. Default 30,000. */
  maxCalls?: number;
  /** The most items in an array or dictionary. Default 10,000. */
  maxCollectionSize?: number;
  /** The most characters in a string. Default 100,000. */
  maxStringLength?: number;
  /** The longest output, in characters. Default 1,000,000. */
  maxOutputSize?: number;
  /** The most elements a formula's content makes, which stops content that doubles. Default 10,000. */
  maxElements?: number;
  /** The largest size of spacing, boxes and text, in ems of the font size. Default 1,000. */
  maxSize?: number;
  /**
   * Typst code that comes before every formula, such as `#let` definitions
   * and `set` rules, as at the start of a document. Typlet evaluates it once
   * for each set of options, and reports its warnings with the first formula.
   */
  preamble?: string;
  /**
   * What to show for a formula Typlet refuses as unsupported, such as one
   * with a `show` rule: markup, or a promise of it, for example from Typst
   * compiled to WebAssembly, loaded only when needed. `render` shows the
   * source until a promise resolves; `renderToString` can use only markup
   * returned right away.
   */
  fallback?: (source: string, error: TypletError) => string | Promise<string>;
  /**
   * The counter of numbered display equations, for numbering a page's
   * equations in order: each one that a preamble's set rule numbers adds 1
   * to `value` and shows it. Without it, they all show 1.
   */
  equationCounter?: { value: number };
}

/** A diagnostic of a formula, with a range in the source in UTF-16 code units. */
export interface TypletDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly hints: readonly string[];
  /** The range in the source, or `null` if the problem has no particular location. */
  readonly span: { readonly start: number; readonly end: number } | null;
  /** Which source `span` is in: the formula, or the `preamble` option. */
  readonly in: 'formula' | 'preamble';
}

export type TypletWarning = TypletDiagnostic & { readonly severity: 'warning' };

/** Why a formula failed. */
export type ErrorKind =
  /** The source has a syntax error. */
  | 'syntax'
  /** Evaluation failed, as it would in Typst. */
  | 'eval'
  /** The formula uses something Typst supports but Typlet does not. */
  | 'unsupported'
  /** A resource budget ran out, such as the number of function calls. */
  | 'limit';

/** The error for a formula that failed to render. Its message is Typst's. */
export class TypletError extends Error {
  override readonly name = 'TypletError';

  constructor(
    readonly kind: ErrorKind,
    /** All errors, the first of which gives `message`, `hints` and `span`. */
    readonly diagnostics: readonly TypletDiagnostic[],
    /** The formula's source. */
    readonly source: string,
  ) {
    super(diagnostics[0]?.message ?? 'unknown error');
  }

  /** Typst's hints for the first error. */
  get hints(): readonly string[] {
    return this.diagnostics[0]?.hints ?? [];
  }

  /** Where the first error is in the source, in UTF-16 code units. */
  get span(): TypletDiagnostic['span'] {
    return this.diagnostics[0]?.span ?? null;
  }
}

function diagnostic(d: SourceDiagnostic): TypletDiagnostic {
  const span = d.span && { start: d.span.start, end: d.span.end };
  return { severity: d.severity, message: d.message, hints: d.hints, span, in: d.span?.file ?? 'formula' };
}

/** The text of content, such as an equation's number. */
function plainText(content: Content): string {
  switch (content.func) {
    case 'sequence':
      return content.children.map(plainText).join('');
    case 'styled':
      return plainText(content.child);
    case 'text':
    case 'symbol':
      return content.text;
    case 'space':
      return ' ';
    default:
      return 'body' in content && content.body && typeof content.body === 'object' ? plainText(content.body as Content) : '';
  }
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Draws an equation's math IR as HTML. The main entry point provides it;
 * `typlet/mathml` leaves it out, and with it the layout engine.
 */
export interface HtmlBackend {
  /**
   * The HTML of the formula's pieces, laid out in the equation's styles, with
   * a display equation's number. Throws a `SourceError` for what it can't draw.
   */
  draw(
    item: MathItem,
    block: boolean,
    warnings: SourceDiagnostic[],
    styles: StyleChain,
    number: Content | null,
    ctx: DrawContext,
  ): string;
}

function syntaxError(source: string, root: ReturnType<typeof parseMath>, at: TypletDiagnostic['in'] = 'formula'): TypletError {
  const diagnostics = root
    .diagnostics()
    .filter((d) => d.severity === 'error')
    .map((d) => ({ severity: 'error' as const, message: d.message, hints: d.hints, span: { start: d.start, end: d.end }, in: at }));
  return new TypletError('syntax', diagnostics, source);
}

/** Evaluated preambles, by source and budgets, most recently added last. */
const PREAMBLES = new Map<string, Preamble | SourceError | TypletError>();
const MAX_PREAMBLES = 16;

/**
 * The evaluated preamble, and its warnings if it was just evaluated. Throws a
 * `TypletError` for a preamble that fails.
 */
function preambleFor(code: string, limits: Limits, source: string): [Preamble, readonly SourceDiagnostic[]] {
  const key = JSON.stringify([code, limits]);
  let entry = PREAMBLES.get(key);
  const fresh = entry === undefined;
  if (entry === undefined) {
    const root = parse(code);
    if (root.erroneous()) {
      entry = syntaxError(source, root, 'preamble');
    } else {
      try {
        entry = evalPreamble(root, limits);
      } catch (e) {
        if (!(e instanceof SourceError)) throw e;
        entry = e;
      }
    }
    if (PREAMBLES.size >= MAX_PREAMBLES) PREAMBLES.delete(PREAMBLES.keys().next().value!);
    PREAMBLES.set(key, entry);
  }
  if (entry instanceof TypletError) throw new TypletError(entry.kind, entry.diagnostics, source);
  if (entry instanceof SourceError) throw sourceError(entry, source);
  return [entry, fresh ? entry.warnings : []];
}

function sourceError(e: SourceError, source: string): TypletError {
  const kind = e.diagnostics.find((d) => d.kind)?.kind ?? 'eval';
  return new TypletError(kind, e.diagnostics.map(diagnostic), source);
}

/** Renders a formula in an output, or throws a `TypletError`. */
function render(source: string, options: RenderOptions, output: Output, backend: HtmlBackend | null): string {
  const root = parseMath(source);
  if (root.erroneous()) throw syntaxError(source, root);

  const display = options.displayMode ?? false;
  setElementLimit(options.maxElements ?? 10_000);
  setMaxSize(options.maxSize ?? 1000);
  const limits = {
    ...DEFAULT_LIMITS,
    ...(options.maxCalls !== undefined ? { calls: options.maxCalls } : {}),
    ...(options.maxCollectionSize !== undefined ? { collectionSize: options.maxCollectionSize } : {}),
    ...(options.maxStringLength !== undefined ? { stringLength: options.maxStringLength } : {}),
  };

  // Warnings of the MathML export only concern the visible output in
  // `mathml` mode; the HTML's warnings, in the HTML modes.
  const warnings: SourceDiagnostic[] = [];
  let preamble: Preamble | null = null;
  if (options.preamble?.trim()) {
    const [evaluated, preambleWarnings] = preambleFor(options.preamble, limits, source);
    preamble = evaluated;
    warnings.push(...preambleWarnings);
  }
  // Links show only where the `trust` option allows them.
  const trustOption = options.trust ?? false;
  const trust = (url: string): boolean => {
    const protocol = protocolOf(url);
    if (protocol === null) return false;
    return typeof trustOption === 'function' ? trustOption({ url, protocol }) : trustOption;
  };
  let mathml: string | null = null;
  let html: string | null = null;
  let numberText: string | null = null;
  try {
    const evaluated = evalFormula(root, display, limits, preamble, options.equationCounter ?? null);
    const { equation, styles: outer, number } = evaluated;
    warnings.push(...evaluated.warnings);
    if (number) numberText = plainText(number);
    const styles = equationStyles(display, outer);
    // Typst realizes some content differently for HTML and for layout, such
    // as `strong`; a formula with such content is resolved for each.
    const resolveWarnings: SourceDiagnostic[] = [];
    const resolver = new MathResolver(resolveWarnings, 'html');
    const item = resolver.resolveIntoItem(equation.body, styles);
    // The MathML comes first: layout updates the IR as it goes.
    if (output !== 'html') {
      const mathmlWarnings: SourceDiagnostic[] = [];
      mathml = itemToMathml(item, display, mathmlWarnings, source, trust, styles, true);
      if (output === 'mathml') warnings.push(...resolveWarnings, ...mathmlWarnings);
    }
    if (output !== 'mathml' && backend) {
      let layoutItem = item;
      if (resolver.targetDependent) {
        resolveWarnings.length = 0;
        layoutItem = resolveEquation(equation.body, styles, resolveWarnings, 'paged');
      }
      warnings.push(...resolveWarnings);
      let dropped = false;
      const ctx: DrawContext = {
        trust(url) {
          if (trust(url)) return true;
          if (!dropped) warnings.push(warning(null, `Typlet left out a link to ${url}, as the \`trust\` option doesn't allow it`));
          dropped = true;
          return false;
        },
      };
      try {
        html = backend.draw(layoutItem, display, warnings, styles, number, ctx);
      } catch (e) {
        // A formula the HTML can't draw shows as MathML instead.
        if (!(e instanceof SourceError) || output !== 'htmlAndMathml' || !e.diagnostics.some((d) => d.kind === 'unsupported')) {
          throw e;
        }
        const reason = e.diagnostics[0]!;
        warnings.push({ ...reason, severity: 'warning', message: `${reason.message}; drawn as MathML` });
      }
    }
  } catch (e) {
    if (!(e instanceof SourceError)) throw e;
    throw sourceError(e, source);
  }

  // A number follows the MathML, for screen readers, and stands beside the
  // equation in the visible output.
  const tag = numberText === null ? '' : escape(numberText);
  let out: string;
  if (output === 'mathml' || html === null) {
    const number = numberText === null ? '' : `<span class="t"></span>${mathml}<span class="t" style="justify-content:flex-end">${tag}</span>`;
    out = `<span class="typlet">${number || mathml}</span>`;
  } else if (output === 'html') {
    const label = numberText === null ? source : `${source} ${numberText}`;
    out = `<span class="typlet"><span class="typlet-html" role="img" aria-label="${escape(label)}">${html}</span></span>`;
  } else {
    out = `<span class="typlet"><span class="typlet-mathml">${mathml}${tag}</span><span class="typlet-html" aria-hidden="true">${html}</span></span>`;
  }
  if (display) out = `<span class="typlet-display${numberText === null ? '' : ' n'}">${out}</span>`;

  const maxOutput = options.maxOutputSize ?? 1_000_000;
  if (out.length > maxOutput) {
    throw new TypletError('limit', [{ severity: 'error', message: `the output is longer than ${maxOutput} characters`, hints: [], span: null, in: 'formula' }], source);
  }

  for (const w of warnings) {
    const warning = { ...diagnostic(w), severity: 'warning' as const };
    const strict = typeof options.strict === 'function' ? options.strict(warning) : (options.strict ?? 'warn');
    if (strict === 'error') throw new TypletError('eval', [{ ...warning, severity: 'error' }], source);
    if (strict === 'warn' && typeof console !== 'undefined') console.warn(`Typlet warning: ${warning.message}`);
  }
  return out;
}

/**
 * Renders a formula, in `defaultOutput` unless the options choose an output,
 * drawing HTML with `backend`. Without one, as in `typlet/mathml`, only
 * MathML renders. A formula Typlet refuses goes to the `fallback` option,
 * whose markup, or promise of markup, is the result.
 */
export function renderWithFallback(
  source: string,
  options: RenderOptions,
  defaultOutput: Output,
  backend: HtmlBackend | null,
): string | Promise<string> {
  try {
    const output = options.output ?? defaultOutput;
    if (output !== 'mathml' && !backend) {
      const message = "`typlet/mathml` renders only `output: 'mathml'`";
      throw new TypletError('unsupported', [{ severity: 'error', message, hints: [], span: null, in: 'formula' }], source);
    }
    return render(source, options, output, backend);
  } catch (e) {
    if (e instanceof TypletError && e.kind === 'unsupported' && options.fallback) return options.fallback(source, e);
    return failed(e, source, options);
  }
}

/** A failed formula: the error, or the source in the error color. */
function failed(e: unknown, source: string, options: RenderOptions): string {
  if (!(e instanceof TypletError) || (options.throwOnError ?? true)) throw e;
  const color = options.errorColor ?? '#cc0000';
  return `<span class="typlet-error" title="${escape(e.toString())}" style="color:${escape(color)}">${escape(source)}</span>`;
}

/** Renders a formula to a string, using the fallback only if it returns markup right away. */
export function renderWith(
  source: string,
  options: RenderOptions,
  defaultOutput: Output,
  backend: HtmlBackend | null,
): string {
  const result = renderWithFallback(source, options, defaultOutput, backend);
  if (typeof result === 'string') return result;
  // The promise can't be waited for: render as without a fallback.
  result.catch(() => {});
  return renderWith(source, { ...options, fallback: undefined }, defaultOutput, backend);
}

/**
 * Renders a formula into an element. While the fallback's promise is pending,
 * the element shows the source; then the markup it gives.
 */
export function renderInto(
  source: string,
  element: { innerHTML: string },
  options: RenderOptions,
  defaultOutput: Output,
  backend: HtmlBackend | null,
): void {
  const result = renderWithFallback(source, options, defaultOutput, backend);
  if (typeof result === 'string') {
    element.innerHTML = result;
    return;
  }
  const pending = `<span class="typlet-pending">${escape(source)}</span>`;
  element.innerHTML = pending;
  result.then(
    (html) => {
      // Unless something else was rendered into the element meanwhile.
      if (element.innerHTML === pending) element.innerHTML = html;
    },
    (e) => {
      if (element.innerHTML === pending) element.innerHTML = failed(e, source, { ...options, throwOnError: false });
    },
  );
}
