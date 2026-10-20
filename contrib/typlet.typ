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

/// A formula: a `<typlet-math>` element in HTML export, an equation on pages.
///
/// - source: the math between the dollar signs, as a string or a raw block.
/// - block: whether the formula is a display equation.
/// - preamble: code before the formula, such as `#let` definitions and `set`
///   rules, as a string or a raw block. Typlet evaluates it before the formula.
#let typlet-math(source, block: false, preamble: none) = {
  let src = _text(source, "the source")
  let pre = if preamble == none { none } else { _text(preamble, "the preamble") }
  context if target() == "html" {
    let attrs = (:)
    if block { attrs.insert("display", "") }
    if pre != none { attrs.insert("preamble", pre) }
    let elem = html.elem("typlet-math", attrs: attrs, src)
    // A custom element is not inline-level to Typst, which would end the
    // paragraph around it; a span carries it.
    if block { elem } else { html.elem("span", elem) }
  } else {
    let code = if block { "$ " + src + " $" } else { "$" + src + "$" }
    eval(if pre == none { code } else { pre + "\n" + code }, mode: "markup")
  }
}

/// Typlet's stylesheet and scripts, in HTML export; nothing on pages. Put it
/// once in the document, before the first formula.
///
/// - base: where the `typlet` package's files are: jsDelivr, or a copy of
///   `fonts/` and `dist/` served with the page.
/// - preamble: code before every formula of the document, such as `#let`
///   definitions and `set` rules, as a string or a raw block. Numbered
///   equations count up through the page.
#let typlet-assets(base: "https://cdn.jsdelivr.net/npm/typlet@0.1.1", preamble: none) = context if target() == "html" {
  html.elem("link", attrs: (rel: "stylesheet", href: base + "/fonts/typlet.css"))
  html.elem("script", attrs: (src: base + "/dist/typlet.min.js"))
  html.elem("script", attrs: (src: base + "/dist/contrib/element.min.js"))
  let options = "typletElement.elementOptions.equationCounter = { value: 0 };"
  if preamble != none {
    options += " typletElement.elementOptions.preamble = " + json.encode(_text(preamble, "the preamble")) + ";"
  }
  html.elem("script", options)
}
