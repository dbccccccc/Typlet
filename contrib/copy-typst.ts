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

/** Keeps document separators without changing literal text or formula whitespace. */
function clipboardText(container: Element): string {
  // A partial table selection can clone cells or rows without their wrappers.
  const parts = [...container.children];
  const cells = parts.length > 0 && parts.every((part) => part.localName === 'td' || part.localName === 'th');
  const rows = parts.length > 0 && parts.every((part) => part.localName === 'tr');
  if ((cells || rows) && [...container.childNodes].every((child) => child.nodeType !== 3 || !child.textContent?.trim())) {
    return parts.map((part) => clipboardText(part)).join(cells ? '\t' : '\n');
  }
  const blocks = new Set('address article aside blockquote dd div dl dt figure figcaption footer h1 h2 h3 h4 h5 h6 header hr li main nav ol pre section table tr ul'.split(' '));
  let out = '';
  let pending = '';
  const separate = (separator: string) => {
    if (separator.length > pending.length) pending = separator;
  };
  const write = (text: string) => {
    if (!text) return;
    if (pending && out) {
      const before = out.match(/\n*$/)![0].length;
      const after = text.match(/^\n*/)![0].length;
      out += '\n'.repeat(Math.max(0, pending.length - before - after));
    }
    pending = '';
    out += text;
  };
  const visit = (node: Node) => {
    if (node.nodeType === 3) { write(node.textContent ?? ''); return; }
    if (node.nodeType !== 1) return;
    const tag = (node as Element).localName;
    if (tag === 'br') { write('\n'); return; }
    if (tag === 'table' || tag === 'thead' || tag === 'tbody' || tag === 'tfoot' || tag === 'tr') {
      const rowText = (row: HTMLTableRowElement) => [...row.cells].map((cell) => clipboardText(cell)).join('\t');
      const table = node as HTMLTableElement;
      const text = tag === 'tr' ? rowText(node as HTMLTableRowElement) : [...table.rows].map(rowText).join('\n');
      const caption = tag === 'table' && table.caption ? clipboardText(table.caption) + '\n' : '';
      separate('\n');
      write(caption + text);
      separate('\n');
      return;
    }
    const separator = tag === 'p' ? '\n\n' : blocks.has(tag) ? '\n' : '';
    if (separator) separate(separator);
    for (const child of node.childNodes) visit(child);
    if (separator) separate(separator);
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
  const container = fragment.ownerDocument.createElement('div');
  container.append(fragment);
  event.clipboardData.setData('text/html', container.innerHTML);
  typletReplaceWithSource(container);
  event.clipboardData.setData('text/plain', clipboardText(container));
  event.preventDefault();
}

if (typeof document !== 'undefined') document.addEventListener('copy', handleCopy);
