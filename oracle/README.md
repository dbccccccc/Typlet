# typlet-oracle

Runs the real Typst compiler (0.15.1, pinned in `Cargo.toml`) and writes reference outputs that Typlet's tests compare against (docs/DESIGN.md §5.1). It reads JSON Lines on stdin and writes JSON Lines on stdout.

```bash
cargo build --release
echo '{"id":"a","src":"x^2"}' | target/release/typlet-oracle run
```

The world is deterministic: Typst's bundled fonts only (Libertinus Serif, New Computer Modern, DejaVu Sans Mono), no files, no packages and no clock.

## Commands

| Command | Input records | Output |
|---|---|---|
| `run [--outputs LIST]` | Formulas and expressions | One fixture per record |
| `split` | `{"id", "doc"}`: a Typst document | One formula record per top-level equation |
| `parse` | `{"id", "src", "mode"?}` | `{"id", "cst"}`: the syntax tree in `math` (default), `code` or `markup` mode, without compiling |
| `frametree` | Formulas | The raw frame tree, for debugging |
| `symbols` | — | Every variant of every symbol in `sym`, in codex's order: `{"module", "name", "modifiers", "value", "deprecated"?, "bindingDeprecated"?}`. `module` is the path of a nested module such as `gender`, or empty. `deprecated` belongs to the variant, `bindingDeprecated` to the whole name |
| `names` | — | Every name in Typst's global and math scopes: `{"scope", "name", "type", "deprecated"?, "params"?}`. Functions list their parameters with the types and values they accept and their defaults |
| `font` | — | Typst's math font, `NewCMMath-Book`, as Typst reads it: a `font` record with its metrics and math constants in ems; a `glyph` record per glyph with its advance, bounding box and MATH data in font units; a `cmap` record with the characters and variation sequences it maps; and a `shape` record per feature set (`ssty`, `dtls`) with the texts that Typst's math shaping turns into anything but their mapped glyph |
| `version` | — | The Typst version |

`LIST` is a comma-separated subset of `cst,content,mathml,frame,svg,diagnostics`. The default is every output except `svg`.

## Input records

- **Formula:** `{"id", "src", "display"?, "preamble"?}`. `src` is math-mode source without the `$` delimiters. `display` defaults to `false`. `preamble` is Typst code placed before the equation, such as `#set math.mat(delim: "[")`.
- **Expression:** `{"id", "expr", "preamble"?}`. `expr` is a code expression, such as `1em/6`.

Other fields are ignored, so corpus records can carry extra data.

## Formula outputs

All offsets are UTF-16 code units into `src`. All lengths are in points, rounded to 0.001 pt.

- **`cst`:** the syntax tree from `typst::syntax::parse_math(src)`. Each node is `[kind, start, end]`, or `[kind, start, end, [children]]` for inner nodes, or `["Error", start, end, message, [hints]]`.
- **`content`:** the evaluated equation as Typst serializes it, from `#metadata($…$)`. Set rules in the preamble don't show here; they apply during layout.
- **`mathml`:** the top-level `<math>` elements of Typst's HTML export, unformatted. `mathmlDiagnostics` holds that compile's errors and warnings. The warning that HTML export is experimental appears on every export, so it is left out.
- **`frame`:** the laid-out formula, from a page sized to fit it, at Typst's default font size of 11 pt:
  - `box`: for inline formulas, `{"anchor": "baseline", "width", "ascent", "descent"}`. For display formulas, `{"anchor": "top", "width", "height"}`.
  - `fonts`: the PostScript names of the fonts used. Typst's default math font is `NewCMMath-Book`.
  - `glyphs`: `[font index, glyph id, x, y, size, text]`, positioned relative to the box's anchor with y pointing down. When the fill isn't black, it follows as a seventh element. When a group transform scales or rotates the glyph, its linear part follows as an eighth.
  - `shapes`: lines, rectangles and curves, each with optional `fill` and `stroke` (`[paint, thickness]`).
  - `page`: the page size, for reference.
- **`svg`:** typst-svg's rendering of the page.
- **`diagnostics`:** errors and warnings from the paged compile: `{"severity", "message", "hints"?, "at", "span"?}`. `at` is `"src"` or `"preamble"` when the span falls in that text, with `span` relative to it, and `null` otherwise.

A record whose compile fails has `null` for `content`, `frame`, `svg` or `mathml`, and the errors in its diagnostics.

## Expression outputs

- **`value`:** `{"type", "repr", "json", "exact"?}`. `type` is Typst's short type name, and `repr` is what Typst shows. `exact` gives full-precision numbers for numeric types, because `repr` rounds: `1em/6` shows as `0.17em`.
- **`diagnostics`:** as for formulas, with `at` set to `"expr"`.

## Why the anchors differ

Inline equations are merged into their line, so only Typst's introspection tags mark them, at the two ends of the baseline. Display equations have tags at the top-left and bottom-left corners of their block, but their frame does not reliably keep a baseline. `src/frame.rs` explains this further.
