// Typlet original: not ported from Typst.
//
// Copies formulas as their Typst source, like KaTeX's copy-tex: when a
// selection that holds formulas is copied, the plain text gets each
// formula's source between dollar signs, and the HTML stays as it is. A
// selection that starts or ends inside a formula grows to hold all of it.
// Importing this module installs the handler.

/** The delimiters a copied formula gets: before and after its source. */
export interface CopyDelimiters {
  readonly inline: readonly [string, string];
  readonly display: readonly [string, string];
}

/** Typst's delimiters: `$x$` for inline formulas and `$ x $` for display ones. */
export const defaultCopyDelimiters: CopyDelimiters = {
  inline: ['$', '$'],
  display: ['$ ', ' $'],
};

/** A formula's outermost element: its `.typlet-display`, or its `.typlet`. */
function formulaOf(element: Element | null): Element | null {
  const formula = element?.closest('.typlet') ?? null;
  const parent = formula?.parentElement;
  return parent?.classList.contains('typlet-display') ? parent : formula;
}

/**
 * A formula's Typst source: its MathML annotation, or, for HTML output, its
 * label without the equation number.
 */
function sourceOf(formula: Element): string | null {
  const annotation = formula.querySelector('annotation[encoding="application/x-typst"]');
  if (annotation) return annotation.textContent ?? '';
  const html = formula.querySelector('.typlet-html[aria-label]');
  // A numbered equation in the `html` output keeps its exact source in an attribute.
  const source = html?.getAttribute('data-typst-source');
  if (source != null) return source;
  const label = html?.getAttribute('aria-label');
  if (label == null) return null;
  // A numbered equation's label ends with its number, which stands at the end of the row.
  const number = formula.classList.contains('n') ? html?.querySelector('.t:last-child')?.textContent?.trim() : undefined;
  return number && label.endsWith(` ${number}`) ? label.slice(0, -number.length - 1) : label;
}

/**
 * Replaces the formulas in a fragment with their Typst source between
 * delimiters. Changes the fragment in place, and returns it. Useful for a
 * copy handler of your own.
 */
export function typletReplaceWithSource(
  fragment: DocumentFragment | Element,
  copyDelimiters: CopyDelimiters = defaultCopyDelimiters,
): DocumentFragment | Element {
  const doc = fragment.ownerDocument ?? (fragment as unknown as Document);
  for (const formula of [...fragment.querySelectorAll('.typlet')]) {
    // A display formula's inner `.typlet` went with its wrapper.
    const outer = formulaOf(formula);
    if (!outer || !fragment.contains(outer)) continue;
    const source = sourceOf(outer);
    if (source === null) continue;
    const [before, after] = outer.classList.contains('typlet-display') ? copyDelimiters.display : copyDelimiters.inline;
    outer.replaceWith(doc.createTextNode(`${before}${source}${after}`));
  }
  return fragment;
}

/** The formula a node is in, if any. */
function closestFormula(node: Node): Element | null {
  return formulaOf(node instanceof Element ? node : node.parentElement);
}

/** The elements after which plain text breaks a line. */
const BLOCKS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'pre', 'section', 'table', 'tr', 'ul',
]);

/**
 * The text of copied content as it reads on the page, which `textContent`
 * runs together: a line break after a block element or `<br>`, a blank line
 * between paragraphs, and a tab between table cells.
 */
function plainText(container: Element): string {
  let out = '';
  // The separator the next text gets: the longest wanted since the last text.
  let pending = '';
  const separate = (separator: string) => {
    if (separator.length > pending.length || (separator === '\n' && pending === '\t')) pending = separator;
  };
  const write = (text: string) => {
    if (text === '') return;
    if (out !== '' && pending === '\t') out += '\t';
    else if (out !== '' && pending !== '') {
      // Line breaks already around the join count towards the separator.
      const before = out.length - out.replace(/\n+$/, '').length;
      const after = text.length - text.replace(/^\n+/, '').length;
      out += '\n'.repeat(Math.max(0, pending.length - before - after));
    }
    pending = '';
    out += text;
  };
  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      write(node.textContent ?? '');
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = (node as Element).localName;
    if (tag === 'br') {
      write('\n');
      return;
    }
    const separator = tag === 'p' ? '\n\n' : BLOCKS.has(tag) ? '\n' : tag === 'td' || tag === 'th' ? '\t' : '';
    if (separator !== '') separate(separator);
    for (const child of node.childNodes) visit(child);
    if (separator !== '' && separator !== '\t') separate(separator);
  };
  visit(container);
  return out;
}

/** The copy handler: puts the selection's formulas on the clipboard as Typst source. */
export function handleCopy(event: ClipboardEvent): void {
  const selection = (event.target as Node | null)?.ownerDocument?.getSelection?.() ?? globalThis.getSelection?.();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !event.clipboardData) return;
  const range = selection.getRangeAt(0).cloneRange();
  const start = closestFormula(range.startContainer);
  if (start) range.setStartBefore(start);
  const end = closestFormula(range.endContainer);
  if (end) range.setEndAfter(end);
  const fragment = range.cloneContents();
  if (!fragment.querySelector('.typlet')) return;
  // Serialized by the DOM, so that text stays text: a literal `<em>` on the
  // page must not become an element on the clipboard.
  const container = fragment.ownerDocument.createElement('div');
  container.append(fragment);
  event.clipboardData.setData('text/html', container.innerHTML);
  typletReplaceWithSource(container);
  event.clipboardData.setData('text/plain', plainText(container));
  event.preventDefault();
}

if (typeof document !== 'undefined') document.addEventListener('copy', handleCopy);
