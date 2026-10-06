// Typlet original: not ported from Typst.
//
// The styles of Typlet's HTML output, which typlet.css carries (see
// tools/fonts/build.mjs). Every rule is scoped under `.typlet`.

export const HTML_CSS = `.typlet {
  font: normal 1em "Typlet NewCM Math";
  line-height: 1.2;
  position: relative;
  text-indent: 0;
  text-rendering: auto;
  font-kerning: none;
  font-variant-ligatures: none;
  font-feature-settings: "kern" 0, "liga" 0, "clig" 0, "calt" 0;
  text-transform: none;
  letter-spacing: normal;
  word-spacing: normal;
}
.typlet-display {
  display: block;
  margin: 1em 0;
  text-align: center;
}
.typlet .typlet-mathml {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
/* The MathML beside the HTML is for screen readers: it needs no web font. */
.typlet .typlet-mathml,
.typlet .typlet-mathml math {
  font-family: math;
}
.typlet .typlet-html {
  white-space: normal;
}
.typlet .f {
  position: relative;
  display: inline-block;
}
.typlet .g {
  position: absolute;
  line-height: 0;
  white-space: pre;
}
.typlet .g::before {
  content: "";
  display: inline-block;
  height: 1em;
}
.typlet .g.b {
  font-weight: bold;
}
.typlet .r {
  position: absolute;
  background: currentColor;
  transform-origin: 0 50%;
}
.typlet .x {
  position: absolute;
  box-sizing: border-box;
}
.typlet .l {
  position: absolute;
}
.typlet-display.n > .typlet {
  display: flex;
  align-items: center;
}
.typlet-display.n .typlet-html {
  display: flex;
  flex: 1 1 auto;
  align-items: flex-start;
}
.typlet .t {
  display: flex;
  flex: 1 0 auto;
  align-items: flex-start;
}`;
