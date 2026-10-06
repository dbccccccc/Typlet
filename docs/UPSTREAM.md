# Upstream mapping

Typlet ports Typst's math pipeline module by module (docs/DESIGN.md §3). This file maps each Typlet module to the upstream source it ports, so a Typst upgrade can start from the upstream diff of these files (docs/DESIGN.md §9).

- **Target:** Typst 0.15.1, tag `v0.15.1`, commit `9dfd3a08500b7896045f907433cf7b4b02434fad`, with the crates it pins: codex 0.3.0 (symbols) and typst-assets 0.15.1 (data).
- **Source to port from:** the crates.io releases, the same sources the oracle builds against. After `npm run oracle:build`, they are in the cargo registry, for example `~/.cargo/registry/src/index.crates.io-*/typst-syntax-0.15.1/`.
- **Header rule:** every ported file starts with the header in `scripts/lib/headers.mjs`, and every upstream path in a header must appear in the tables below. `npm run check:headers` enforces both.

When a file is ported, its row's "Synced at" names the version.

## Syntax: `src/syntax/`

| Typlet module | Upstream file | Synced at | Status |
|---|---|---|---|
| `lexer.ts` | `crates/typst-syntax/src/lexer.rs` | 0.15.1 | Ported |
| `parser.ts` | `crates/typst-syntax/src/parser.rs` | 0.15.1 | Ported, without incremental reparsing |
| `kind.ts` | `crates/typst-syntax/src/kind.rs` | 0.15.1 | Ported, without `mode_after` (IDE only) |
| `set.ts` | `crates/typst-syntax/src/set.rs` | 0.15.1 | Ported |
| `node.ts` | `crates/typst-syntax/src/node.rs` | 0.15.1 | Partly ported: nodes, errors, warnings; no spans |
| `ast.ts` | `crates/typst-syntax/src/ast.rs` | 0.15.1 | Partly ported: operators, literals and the accessors evaluation uses, as functions on nodes with offsets |
| `highlight.ts` | `crates/typst-syntax/src/highlight.rs` | 0.15.1 | Ported, with the sibling and leaf navigation of `LinkedNode` (`crates/typst-syntax/src/node.rs`); without `highlight_html` |

## Evaluation: `src/eval/`

| Typlet module | Upstream file | Synced at | Status |
|---|---|---|---|
| `math.ts` | `crates/typst-eval/src/math.rs` | 0.15.1 | Ported |
| `call.ts` | `crates/typst-eval/src/call.rs` | 0.15.1 | Partly ported: calls in code and math, arguments, calls on non-functions. Methods come with Level 4 |
| `closure.ts` | `crates/typst-eval/src/call.rs` | 0.15.1 | Closures, their captured variables and their calls |
| `closure.ts` | `crates/typst-library/src/foundations/func.rs` | 0.15.1 | Calls of closures |
| `binding.ts` | `crates/typst-eval/src/binding.rs` | 0.15.1 | Ported: `let` and destructuring, without assignments |
| `binding.ts` | `crates/typst-syntax/src/ast.rs` | 0.15.1 | Patterns and `let` bindings |
| `flow.ts` | `crates/typst-eval/src/flow.rs` | 0.15.1 | `if`, `return`, `break` and `continue`; loops come with Level 4 |
| `rules.ts` | `crates/typst-eval/src/rules.rs` | 0.15.1 | Set rules; show rules are refused |
| `rules.ts` | `crates/typst-eval/src/vm.rs` | 0.15.1 | The hint for a shadowed function of the standard library |
| `markup.ts` | `crates/typst-eval/src/markup.rs` | 0.15.1 | Ported, with labels; references, headings and lists are refused |
| `markup.ts` | `crates/typst-syntax/src/ast.rs` | 0.15.1 | Shorthands, raw text and links in markup |
| `markup.ts` | `crates/typst-library/src/model/link.rs` | 0.15.1 | Links from URLs |
| `numbering.ts` | `crates/typst-library/src/model/numbering.rs` | 0.15.1 | Numbering patterns and functions |
| `numeral.ts` | codex 0.3.0, `src/numeral_systems.rs` | 0.3.0 | Ported, without Chinese numerals |
| `code.ts` | `crates/typst-eval/src/code.rs` | 0.15.1 | Ported for Levels 1 to 3 (docs/DESIGN.md §6.3): code blocks with set rules, content blocks; context expressions are refused |
| `code.ts` | `crates/typst-eval/src/ops.rs` | 0.15.1 | Ported, without assignments |
| `code.ts` | `crates/typst-library/src/foundations/fields.rs` | 0.15.1 | Fields of lengths, relative lengths and alignments |
| `vm.ts` | `crates/typst-eval/src/vm.rs` | 0.15.1 | Partly ported |
| `vm.ts` | `crates/typst-eval/src/flow.rs` | 0.15.1 | Control flow events |
| `ops.ts` | `crates/typst-library/src/foundations/ops.rs` | 0.15.1 | Ported for Typlet's value types |
| `value.ts` | `crates/typst-library/src/foundations/value.rs` | 0.15.1 | Ported for Typlet's value types, with the serialization of content |
| `repr.ts` | `crates/typst-library/src/foundations/repr.rs` | 0.15.1 | Ported, with Rust's float formatting |
| `repr.ts` | `crates/typst-utils/src/round.rs` | 0.15.1 | `round_with_precision` |
| `cast.ts` | `crates/typst-library/src/foundations/cast.rs` | 0.15.1 | `CastInfo` and the casts of Typlet's parameter types |
| `cast.ts` | `crates/typst-library/src/foundations/int.rs` | 0.15.1 | Integer casts |
| `args.ts` | `crates/typst-library/src/foundations/args.rs` | 0.15.1 | Ported, without the `arguments` methods |
| `func.ts` | `crates/typst-library/src/foundations/func.rs` | 0.15.1 | Native and element functions |
| `func.ts` | `crates/typst-library/src/engine.rs` | 0.15.1 | Warnings and budgets only |
| `scope.ts` | `crates/typst-library/src/foundations/scope.rs` | 0.15.1 | Scopes, bindings and the unknown-variable errors |
| `scope.ts` | `crates/typst-library/src/foundations/module.rs` | 0.15.1 | Module fields |
| `symbol.ts` | `crates/typst-library/src/foundations/symbol.rs` | 0.15.1 | Ported, without the `symbol` constructor |
| `symbol.ts` | `crates/typst-library/src/symbols.rs` | 0.15.1 | Ported |
| `content.ts` | `crates/typst-library/src/foundations/content/mod.rs` | 0.15.1 | Content as plain objects with Typst's field names |
| `styles.ts` | `crates/typst-library/src/foundations/styles.rs` | 0.15.1 | Style lists and chains, without show rules |
| `layout.ts` | Eight files in `crates/typst-library/src/layout/`, listed below the table | 0.15.1 | The quantities and their arithmetic |
| `color.ts` | `crates/typst-library/src/visualize/color.rs` | 0.15.1 | Grayscale and sRGB colors, named colors, `rgb` and `luma` |
| `library.ts` | `crates/typst-library/src/lib.rs` | 0.15.1 | The parts of the global scope Levels 1 to 3 need |
| `library.ts` | `crates/typst-library/src/math/mod.rs` | 0.15.1 | The math scope |
| `library.ts` | `crates/typst-library/src/layout/spacing.rs` | 0.15.1 | `h` |
| `diag.ts` | `crates/typst-library/src/diag.rs` | 0.15.1 | Diagnostics and traces |

The files `layout.ts` ports are `crates/typst-library/src/layout/abs.rs`, `crates/typst-library/src/layout/em.rs`, `crates/typst-library/src/layout/length.rs`, `crates/typst-library/src/layout/ratio.rs`, `crates/typst-library/src/layout/rel.rs`, `crates/typst-library/src/layout/angle.rs`, `crates/typst-library/src/layout/fr.rs` and `crates/typst-library/src/layout/align.rs`.

## Elements: `src/elements/`

| Typlet module | Upstream file | Synced at | Status |
|---|---|---|---|
| `accent.ts` | `crates/typst-library/src/math/accent.rs` | 0.15.1 | Ported; below-accents come from a table of combining classes instead of ICU |
| `attach.ts` | `crates/typst-library/src/math/attach.rs` | 0.15.1 | Ported |
| `cancel.ts` | `crates/typst-library/src/math/cancel.rs` | 0.15.1 | Ported |
| `frac.ts` | `crates/typst-library/src/math/frac.rs` | 0.15.1 | Ported |
| `lr.ts` | `crates/typst-library/src/math/lr.rs` | 0.15.1 | Ported |
| `matrix.ts` | `crates/typst-library/src/math/matrix.rs` | 0.15.1 | Ported |
| `mod.ts` | `crates/typst-library/src/math/mod.rs` | 0.15.1 | Constants, `class` and alignment points |
| `mod.ts` | `crates/typst-library/src/math/equation.rs` | 0.15.1 | `math.equation`, with numbering |
| `op.ts` | `crates/typst-library/src/math/op.rs` | 0.15.1 | Ported |
| `root.ts` | `crates/typst-library/src/math/root.rs` | 0.15.1 | Ported |
| `style.ts` | `crates/typst-library/src/math/style.rs` | 0.15.1 | Ported |
| `underover.ts` | `crates/typst-library/src/math/underover.rs` | 0.15.1 | Ported |
| `text.ts` | `crates/typst-library/src/text/mod.rs` | 0.15.1 | `text` with all its parameters; layout draws fill, size, weight, tracking, spacing and baseline, and refuses strokes, OpenType features and other fonts |
| `text.ts` | `crates/typst-library/src/text/font/variant.rs` | 0.15.1 | Font weights |
| `text.ts` | `crates/typst-library/src/model/strong.rs` | 0.15.1 | `strong` |
| `text.ts` | `crates/typst-library/src/model/emph.rs` | 0.15.1 | `emph` |
| `text.ts` | `crates/typst-library/src/text/deco.rs` | 0.15.1 | `highlight` |
| `box.ts` | `crates/typst-library/src/layout/container.rs` | 0.15.1 | `box` |
| `box.ts` | `crates/typst-library/src/layout/hide.rs` | 0.15.1 | `hide` |
| `box.ts` | `crates/typst-library/src/model/link.rs` | 0.15.1 | `link`, to URLs |
| `elem.ts` | — | — | Typlet original: element constructors and set rules from field specs, as typst-macros' `#[elem]` generates them |

## Math IR: `src/ir/`

| Typlet module | Upstream file | Synced at | Status |
|---|---|---|---|
| `item.ts` | `crates/typst-library/src/math/ir/item.rs` | 0.15.1 | Ported, without MathML pass-through items |
| `multiline.ts` | `crates/typst-library/src/math/ir/multiline.rs` | 0.15.1 | Ported |
| `process.ts` | `crates/typst-library/src/math/ir/process.rs` | 0.15.1 | Ported |
| `resolve.ts` | `crates/typst-library/src/math/ir/resolve.rs` | 0.15.1 | Ported, with math realization from typst-realize 0.15.1 (`lib.rs`, `spaces.rs`): flattening, space collapsing, the introspection tags around `strong`, `emph`, `highlight`, `link`, `hide`, raw text and labelled content, and the show rules of `strong`, `emph`, `highlight`, `link` and `hide`, for paged and HTML output |

## MathML: `src/mathml/`

| Typlet module | Upstream file | Synced at | Status |
|---|---|---|---|
| `mathml.ts` | `crates/typst-html/src/mathml.rs` | 0.15.1 | Ported. When rendering, Typlet adds what the export drops (docs/DESIGN.md §2.3): `overline`, `underline`, `cancel` and colors |
| `external.ts` | `crates/typst-html/src/convert.rs` | 0.15.1 | Content in a formula that isn't math: text, boxes and smart quotes. When rendering, Typlet adds box borders, insets, radii and fills, and `hide` as `mphantom` |
| `external.ts` | `crates/typst-html/src/rules.rs` | 0.15.1 | The HTML show rules of `strong`, `emph`, `highlight`, `link` and `raw` |
| `external.ts` | `crates/typst-html/src/fragment.rs` | 0.15.1 | Inline and block fragments: the bodies of boxes, inline elements and paragraphs |
| `external.ts` | `crates/typst-realize/src/lib.rs` | 0.15.1 | Paragraph grouping in fragments, and the spaces and paragraph breaks it drops |
| `external.ts` | `crates/typst-library/src/text/smartquote.rs` | 0.15.1 | `SmartQuoter` and each language's quotes; `smartquote` set rules are refused |
| `html.ts` | `crates/typst-html/src/encode.rs` | 0.15.1 | Escaping and serialization, without pretty printing |
| `html.ts` | `crates/typst-html/src/charsets.rs` | 0.15.1 | Ported |
| `html.ts` | `crates/typst-html/src/css/encode.rs` | 0.15.1 | Lengths and numbers in CSS |
| `html.ts` | `crates/typst-html/src/convert.rs` | 0.15.1 | Text conversion and whitespace protection |
| `raw.ts` | `crates/typst-library/src/text/raw.rs` | 0.15.1 | Highlighted Typst code with the default theme |
| `operator.ts` | typst-assets 0.15.1, `src/mathml.rs` | 0.15.1 | Ported |

## Layout: `src/layout/`

| Typlet module | Upstream file | Synced at | Status |
|---|---|---|---|
| `math.ts` | `crates/typst-layout/src/math/mod.rs` | 0.15.1 | Ported, with New Computer Modern Math as the only font and equation numbers; content that isn't math other than boxes and smart quotes is refused |
| `inline.ts` | `crates/typst-layout/src/inline/box.rs` | 0.15.1 | Boxes; clipping and sizes relative to the page are refused |
| `inline.ts` | `crates/typst-layout/src/inline/deco.rs` | 0.15.1 | Highlights |
| `inline.ts` | `crates/typst-layout/src/inline/line.rs` | 0.15.1 | `apply_shift` and `commit`: inline frames move by the baseline shift, and a box's line is aligned within its width |
| `inline.ts` | `crates/typst-layout/src/inline/finalize.rs` | 0.15.1 | A paragraph's width: a box's, or its content's but no more than its region's |
| `inline.ts` | `crates/typst-layout/src/inline/shaping.rs` | 0.15.1 | Clusters, `track_and_space`, and the script runs of `shape_range`; right-to-left text is refused unless it starts and ends with letters |
| `inline.ts` | `crates/typst-layout/src/pad.rs` | 0.15.1 | Insets |
| `inline.ts` | `crates/typst-layout/src/shapes.rs` | 0.15.1 | Rectangles; rounded and partial borders are one box, which the HTML draws with CSS |
| `inline.ts` | `crates/typst-library/src/text/font/mod.rs` | 0.15.1 | Text edges |
| `fragment.ts` | `crates/typst-layout/src/math/fragment/mod.rs` | 0.15.1 | Ported |
| `fragment.ts` | `crates/typst-layout/src/math/fragment/glyph.rs` | 0.15.1 | Ported |
| `fragment.ts` | `crates/typst-layout/src/math/shaping.rs` | 0.15.1 | The feature fallback; shaping itself is `font.ts`'s |
| `run.ts` | `crates/typst-layout/src/math/run.rs` | 0.15.1 | Ported |
| `text.ts` | `crates/typst-layout/src/math/text.rs` | 0.15.1 | Ported; text is one line of the math font's glyphs, which is what Typst's paragraph layout gives for it |
| `scripts.ts` | `crates/typst-layout/src/math/scripts.rs` | 0.15.1 | Ported |
| `fraction.ts` | `crates/typst-layout/src/math/fraction.rs` | 0.15.1 | Ported |
| `radical.ts` | `crates/typst-layout/src/math/radical.rs` | 0.15.1 | Ported, without text strokes |
| `fenced.ts` | `crates/typst-layout/src/math/fenced.rs` | 0.15.1 | Ported |
| `accent.ts` | `crates/typst-layout/src/math/accent.rs` | 0.15.1 | Ported |
| `line.ts` | `crates/typst-layout/src/math/line.rs` | 0.15.1 | Ported, without text strokes |
| `table.ts` | `crates/typst-layout/src/math/table.rs` | 0.15.1 | Ported; relative gaps are unbounded, as in math |
| `cancel.ts` | `crates/typst-layout/src/math/cancel.rs` | 0.15.1 | Ported |
| `frame.ts` | `crates/typst-library/src/layout/frame.rs` | 0.15.1 | Frames, groups, text and shapes |
| `frame.ts` | `crates/typst-library/src/layout/transform.rs` | 0.15.1 | Translations and rotations |
| `frame.ts` | `crates/typst-library/src/text/item.rs` | 0.15.1 | Text items and their width |
| `frame.ts` | `crates/typst-library/src/visualize/shape.rs` | 0.15.1 | Lines and rectangles |
| `font.ts` | — | — | Typlet original: the math font's metrics, as Typst's layout reads them with ttf-parser and rustybuzz; the Bold face's for Latin text; a base and its combining marks compose where the font has the composition, as in HarfBuzz |

## HTML: `src/html/`

Typlet originals: `html.ts` draws frames as absolutely positioned glyphs and rules (docs/DESIGN.md §2.1), `css.ts` holds their styles, and `index.ts` connects the layout to the render API.

## Utilities

| Typlet module | Upstream file | Synced at | Status |
|---|---|---|---|
| `src/utils/math-class.ts` | `crates/typst-utils/src/lib.rs` | 0.15.1 | `default_math_class` only |
| `src/utils/styling.ts` | codex 0.3.0, `src/styling.rs` | 0.3.0 | The styles `MathStyle::select` chooses, without the Arabic ones |

## Generated data

| Typlet file | Source | Generator |
|---|---|---|
| `src/generated/math-class.ts` | unicode-math-class 0.1.0, `src/classes.rs` | `tools/codegen/math-class.mjs` |
| `src/generated/symbols.ts` | codex 0.3.0, `sym.txt`, through the oracle | `tools/codegen/library.mjs` |
| `src/generated/names.ts` | Typst's global scope, through the oracle | `tools/codegen/library.mjs` |
| `src/generated/mathml.ts` | typst-assets 0.15.1, `files/mathml/data.rs` | `tools/codegen/mathml.mjs` |
| `src/generated/metrics.ts`, `metrics-extended.ts` | typst-assets 0.15.1, `NewCMMath-Book.otf`, through the oracle | `tools/codegen/metrics.mjs` |
| `fonts/` | typst-assets 0.15.1, `NewCMMath-Book.otf` and `NewCMMath-Bold.otf` | `tools/fonts/build.mjs` |

## Typlet originals

- `src/syntax/scanner.ts` reimplements the API of the `unscanny` crate over UTF-16 strings, stepping over whole code points.
- `src/syntax/unicode.ts` matches Rust's `char` predicates and the unicode-ident, unicode-script and unicode-segmentation crates, using the JavaScript engine's Unicode data.
- `src/eval/index.ts` evaluates a formula; `src/mathml/index.ts` renders an equation as typst-html's equation rule does; `src/render.ts` is the public API.
- The integrations: `contrib/auto-render.ts`, `contrib/copy-typst.ts`, `contrib/element.ts`, the `typlet` command in `src/cli.ts`, and `packages/rehype-typlet/` and `packages/markdown-it-typlet/`. Their APIs follow KaTeX's contrib modules and rehype-katex; auto-render and markdown-it-typlet find where a formula ends with Typlet's port of Typst's parser.
