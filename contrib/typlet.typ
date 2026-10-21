// Typlet original: not ported from Typst.
//
// Formulas for Typst's HTML export, rendered by Typlet in the browser:
//
//   #import "typlet.typ": typlet-math, typlet-assets
//   #typlet-assets()
//   Let #typlet-math(`x^2 + y^2 = z^2`) hold. Then
//   #typlet-math(`sum_(i=1)^n i = (n(n+1))/2`, block: true)
//
// In HTML export, `typlet-math` writes a `<typlet-math>` element, which
// `typlet/contrib/element` renders in the page with Typlet's layout. In paged
// output, the formula is an equation like any other. See the Integrations page
// of Typlet's documentation.

/// The text of a formula given as a string or as a raw block.
#let _text(it, what) = {
  if type(it) == str { it } else if type(it) == content and it.has("text") { it.text } else {
    panic(what + " must be a string or a raw block, not " + repr(it))
  }
}

/// The preamble `typlet-assets` gave the document, for the formulas on pages.
#let _preamble = state("typlet-preamble", none)

/// A formula: a `<typlet-math>` element in HTML export, an equation on pages.
///
/// - source: the math between the dollar signs, as a string or a raw block.
/// - block: whether the formula is a display equation.
/// - preamble: code before the formula, such as `#let` definitions and `set`
///   rules, as a string or a raw block, after the document's. Typlet
///   evaluates it before the formula.
#let typlet-math(source, block: false, preamble: none) = {
  // Spaces at the ends would make a display equation of an inline one on pages.
  let src = _text(source, "the source").trim()
  let pre = if preamble == none { none } else { _text(preamble, "the preamble") }
  context if target() == "html" {
    // The source goes in an attribute: as text, the export would write its
    // line breaks as `<br>`, which the element can't read back.
    let attrs = (source: src)
    if block { attrs.insert("display", "") }
    if pre != none { attrs.insert("preamble", pre) }
    let elem = html.elem("typlet-math", attrs: attrs)
    // A custom element is not inline-level to Typst, which would end the
    // paragraph around it; a span carries it.
    if block { elem } else { html.elem("span", elem) }
  } else {
    let pieces = (_preamble.get(), pre).filter(p => p != none)
    // The closing dollar sign on a line of its own, out of reach of a line
    // comment at the end of the source; with a space after the opening one, the
    // equation is a display one.
    pieces.push((if block { "$ " } else { "$" }) + src + "\n$")
    eval(pieces.join("\n"), mode: "markup")
  }
}

/// Typlet's stylesheet and scripts, in HTML export, and the document's
/// preamble, for the formulas on pages as well. Put it once in the document,
/// before the first formula.
///
/// - base: where the `typlet` package's files are: jsDelivr, or a copy of
///   `fonts/` and `dist/` served with the page.
/// - preamble: code before every formula of the document, such as `#let`
///   definitions and `set` rules, as a string or a raw block. Numbered
///   equations count up through the page.
#let typlet-assets(base: "https://cdn.jsdelivr.net/npm/typlet@0.1.1", preamble: none) = {
  let pre = if preamble == none { none } else { _text(preamble, "the preamble") }
  _preamble.update(pre)
  context if target() == "html" {
    html.elem("link", attrs: (rel: "stylesheet", href: base + "/fonts/typlet.css"))
    html.elem("script", attrs: (src: base + "/dist/typlet.min.js"))
    html.elem("script", attrs: (src: base + "/dist/contrib/element.min.js"))
    let options = "typletElement.elementOptions.equationCounter = { value: 0 };"
    if pre != none {
      options += " typletElement.elementOptions.preamble = " + json.encode(pre) + ";"
    }
    html.elem("script", options)
  }
}
