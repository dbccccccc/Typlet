# Test corpus

Typst formulas that Typlet is tested on. `tools/corpus/build.mjs` builds these files (`npm run corpus`), and `tools/fixtures.mjs` runs the oracle over them to produce `test/fixtures/` (`npm run fixtures`).

| File | Records | Source |
|---|---|---|
| `paired.jsonl` | 81 formulas | The paired corpus (`tools/corpus/paired.mjs`), with LaTeX for KaTeX in `tex` |
| `typst-docs.jsonl` | 83 formulas | The equations in the 68 examples of Typst's math documentation (Apache-2.0, see THIRD_PARTY_NOTICES.md) |
| `typstpad.jsonl` | 183 formulas | TypstPad's symbol picker and templates, rendered by TypstPad as display equations |
| `symbols.jsonl` | 1,159 formulas | One per variant of every symbol in Typst's `sym` module, as codex 0.3.0 defines them |
| `code.jsonl` | 37 formulas | Embedded code Level 1: how values display in math, math-call arguments, callable symbols, errors |
| `expressions.jsonl` | 3,857 expressions | Level 1 values and every operator over pairs of typed operands, valid or not |

## Record format

- **Formula:** `{"id", "src", "display", "preamble"?}`, plus optional fields such as `tex`, `cat` and `meta`. `src` is math-mode source without `$`. `preamble` holds Typst statements that precede the equation, such as `#let` and `#set`.
- **Expression:** `{"id", "expr"}`, a code expression.

## Local corpora

`npm run corpus -- --labels FILE` samples a JSON Lines file of Typst formulas (records with a `label` field) into `local/labels.jsonl`, and `npm run fixtures -- --local` produces fixtures for it. The `local/` directories are not committed: label sets such as IBEM-im2typst's training data combine several datasets with different licenses.
