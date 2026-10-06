// @vitest-environment happy-dom
//
// Formulas from chat, comments and shared links are untrusted (docs/DESIGN.md §6.6
// and SECURITY.md). Whatever the input, the output must hold only the
// elements and attributes Typlet makes, styles made of numbers and colors,
// and links only where the `trust` option allows them.

import { describe, expect, it } from 'vitest';
import { type RenderOptions, TypletError, renderToString } from '../src/index.js';
import { protocolOf } from '../src/render.js';

/** Every element Typlet's outputs use, over the whole corpus, `br` for line breaks in content, `p` for paragraphs in boxes, and the decorations' `menclose` and `mphantom`. */
const TAGS = new Set(
  'a annotation br code em mark math menclose mfrac mi mmultiscripts mn mo mover mphantom mprescripts mroot mrow mspace msqrt msub msubsup msup mtable mtd mtext mtr munder munderover p semantics span strong'.split(' '),
);

/** Every attribute Typlet's outputs use, over the whole corpus. */
const ATTRIBUTES = new Set(
  'accent accentunder aria-hidden aria-label class data-lang display displaystyle encoding fence form href largeop linethickness lspace mathvariant minsize notation role rspace scriptlevel separator stretchy style symmetric title width'.split(' '),
);

/** Styles hold properties, numbers, units and colors: no URLs, escapes, quotes or at-rules. */
const SAFE_STYLE = /^[-a-z0-9#.:;,()% ]*$/i;

const HOSTILE = [
  '#"<script>alert(1)</script>"',
  '"</annotation></semantics></math><img src=x onerror=alert(1)>"',
  '#raw("<img src=x onerror=alert(1)>")',
  '#raw(lang: "\\"><script>alert(1)</script>", "x")',
  '#raw(lang: "typ", "#let x = \\"<b>\\"")',
  '#[<b>x</b> & "q" it\'s]',
  '#strong[#emph[<x onmouseover=y>]] #highlight[<i>]',
  '#box[<b>a</b> #hide[x] "q" <img src=x onerror=alert(1)>\n\n</p><script>]',
  '#link("javascript:alert(1)")[click]',
  '#link(" JavaScript:alert(1)")[click]',
  '#link("java\\tscript:alert(1)")[click]',
  '#link("https://example.com/\\" onmouseover=\\"alert(1)")[x]',
  '#link("data:text/html,<script>alert(1)</script>")[x]',
  '#link("https://example.com/<>")',
  '#text(fill: rgb("#ff0000"))[x] #text(fill: rgb(0, 0, 255, 50%), $y$)',
  '#box(stroke: (paint: blue, dash: "dotted"), inset: 2pt, fill: red)[x]',
  'f(x: "<a>") + #foo + "\\u{202E}evil"',
  'x &amp; y < z > w " \'',
  '#let s = "<svg onload=alert(1)>"',
  '#hide["<img src=x onerror=alert(1)>" $x$] + cancel("<b>") + overline(#text(fill: red)["</mo><script>"])',
  '#box(stroke: (bottom: 1pt + red), radius: 2pt, inset: (x: 1pt))[<i>]',
];

const OUTPUTS = ['htmlAndMathml', 'html', 'mathml'] as const;

/** Renders and parses a formula; fails the test on anything but a `TypletError`. */
function renderParsed(source: string, options: RenderOptions): DocumentFragment | null {
  let html: string;
  try {
    html = renderToString(source, { strict: 'ignore', ...options });
  } catch (e) {
    if (e instanceof TypletError) return null;
    throw e;
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

/** The problems in an output: elements, attributes, styles and links Typlet must not make. */
function problems(fragment: DocumentFragment, allowLinks: (href: string) => boolean): string[] {
  const found: string[] = [];
  for (const element of fragment.querySelectorAll('*')) {
    if (!TAGS.has(element.localName)) found.push(`element <${element.localName}>`);
    for (const { name, value } of element.attributes) {
      if (!ATTRIBUTES.has(name)) found.push(`attribute ${name} on <${element.localName}>`);
      if (name === 'style' && !SAFE_STYLE.test(value)) found.push(`style ${JSON.stringify(value)}`);
      if (name === 'href' && !allowLinks(value)) found.push(`link to ${value}`);
    }
  }
  return found;
}

describe('untrusted input', () => {
  for (const output of OUTPUTS) {
    for (const displayMode of [false, true]) {
      it(`makes only safe ${output} output${displayMode ? ' in display mode' : ''}`, () => {
        for (const source of HOSTILE) {
          for (const throwOnError of [true, false]) {
            const fragment = renderParsed(source, { output, displayMode, throwOnError });
            if (!fragment) continue;
            expect(problems(fragment, () => false), source).toEqual([]);
            // The source survives as it is, in the annotation or the label.
            const annotation = fragment.querySelector('annotation');
            if (annotation) expect(annotation.textContent).toBe(source);
            const error = fragment.querySelector('.typlet-error');
            if (error) expect(error.textContent).toBe(source);
          }
        }
      });
    }
  }

  it('draws only the links trust allows', () => {
    const https = ({ protocol }: { protocol: string }) => protocol === 'https';
    for (const source of HOSTILE) {
      for (const output of OUTPUTS) {
        const fragment = renderParsed(source, { output, trust: https });
        if (fragment) expect(problems(fragment, (href) => href.startsWith('https://')), source).toEqual([]);
      }
    }
    const fragment = renderParsed('#link("https://example.com/\\" onmouseover=\\"alert(1)")[x]', { output: 'mathml', trust: https })!;
    expect(fragment.querySelector('a')!.getAttribute('href')).toBe('https://example.com/" onmouseover="alert(1)');
  });

  it('never trusts a URL with a malformed scheme', () => {
    for (const url of ['java script:alert(1)', ':alert(1)', '1javascript:alert(1)']) {
      const fragment = renderParsed(`#link("${url}")[x]`, { output: 'mathml', trust: true })!;
      expect(fragment.querySelector('a'), url).toBeNull();
    }
  });

  it('escapes equation numbers and error colors', () => {
    const preamble = '#set math.equation(numbering: n => "<i onclick=x>" + [#n])';
    for (const output of OUTPUTS) {
      const fragment = renderParsed('x', { output, displayMode: true, preamble })!;
      expect(problems(fragment, () => false)).toEqual([]);
      expect(fragment.textContent).toContain('<i onclick=x>1');
    }
    const fragment = renderParsed('foo', { throwOnError: false, errorColor: 'red" onmouseover="alert(1)' })!;
    expect(fragment.querySelector('[onmouseover]')).toBeNull();
    expect(fragment.querySelector('.typlet-error')!.getAttribute('style')).toBe('color:red" onmouseover="alert(1)');
  });

  it('survives random input', () => {
    // Characters that matter to HTML, CSS, URLs and Typst's syntax.
    const alphabet = ['<', '>', '&', '"', "'", '\\', '/', '#', '$', '[', ']', '(', ')', '{', '}', ':', ';', ',', '.', '=', ' ', 'x', 'a', '1', '"<', 'script', 'link', 'raw', 'text', 'box', '\n', '_', '^', '*', '`', 'javascript:', '@', '%', '-'];
    let seed = 1;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let i = 0; i < 400; i++) {
      const source = Array.from({ length: 1 + random(24) }, () => alphabet[random(alphabet.length)]).join('');
      for (const output of OUTPUTS) {
        const fragment = renderParsed(source, { output, throwOnError: false, trust: ({ protocol }) => protocol === 'https' });
        if (fragment) expect(problems(fragment, (href) => href.startsWith('https://')), source).toEqual([]);
      }
    }
  });
});

describe('protocolOf', () => {
  it.each([
    ['https://typst.app', 'https'],
    ['MAILTO:someone@example.com', 'mailto'],
    ['JavaScript:alert(1)', 'javascript'],
    [' \u0001javascript:alert(1)', 'javascript'],
    ['java\tscript:alert(1)', 'javascript'],
    ['/path:with-colon', '_relative'],
    ['#fragment', '_relative'],
    ['?q=a:b', '_relative'],
    ['', '_relative'],
    ['java script:alert(1)', null],
    [':alert(1)', null],
    ['1abc:x', null],
  ])('reads %j as %j', (url, protocol) => {
    expect(protocolOf(url)).toBe(protocol);
  });
});
