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
  const html = [...fragment.childNodes]
    .map((node) => (node.nodeType === 3 ? node.textContent : (node as Element).outerHTML ?? ''))
    .join('');
  event.clipboardData.setData('text/html', html);
  event.clipboardData.setData('text/plain', typletReplaceWithSource(fragment).textContent ?? '');
  event.preventDefault();
}

if (typeof document !== 'undefined') document.addEventListener('copy', handleCopy);
