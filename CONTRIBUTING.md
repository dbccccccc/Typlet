# Contributing to Typlet

Thank you for helping. Bug reports, formulas Typlet draws differently from Typst, and pull requests are all welcome.

This project follows a [code of conduct](CODE_OF_CONDUCT.md). To report a security problem, see [SECURITY.md](SECURITY.md), and don't open a public issue.

## Reporting a bug

Open an issue with:
- the formula's source, and its preamble if it has one;
- what Typlet rendered, or the error it threw;
- what Typst renders for it, if you can check: Typlet aims to match Typst 0.15.1 exactly, so a difference from Typst is a bug;
- Typlet's version, and the browser or Node version.

A formula that Typlet refuses as `unsupported`, or draws as MathML with a warning, is a known limit, not a bug. [The README](README.md#limitations) lists them, and an issue is still welcome if one of them blocks you.

## Setting up

You need Node 22.12 or newer: the package runs on Node 22, but Vitest, which runs the tests, needs 22.12.

```bash
npm install
npm run check
```

`npm run check` runs everything that doesn't need other tools: the type check, the header check, the tests, the build, the size budgets, a check of the package as npm would publish it, the time budgets for abusive formulas, and the documentation.

Two parts of the repository need more:
- **The oracle** (`oracle/`) runs the real Typst compiler, and needs Rust. `npm run oracle:build` builds it; the first build takes several minutes.
- **The font pipeline** (`tools/fonts/`) needs Python with fontTools:

  ```bash
  python -m venv .venv
  .venv/Scripts/pip install -r tools/fonts/requirements.txt   # .venv/bin/pip outside Windows
  ```

The browser tests need Playwright's browsers: `npx playwright install chromium firefox webkit`.

Corpus and generated-data commands use the dependencies pinned by `oracle/Cargo.lock`. Build the oracle first; missing upstream sources are an error. These commands do not read adjacent projects. Local label files are read only when explicitly passed with `--labels FILE`.

Font generation uses only this repository's `.venv` and checks that its dependencies match `tools/fonts/requirements.txt`. Local preview servers listen on `127.0.0.1`.

The npm override for `micromark-extension-math` keeps its development-only KaTeX dependency above the vulnerable versions in GHSA-238p-pmpm-9mq7. Remove the override when the upstream dependency range includes the fix.

## The repository

| Path | Contents |
|---|---|
| `src/` | The renderer, in TypeScript, and the `typlet` command |
| `contrib/` | Auto-render, copy-typst and the `<typlet-math>` element |
| `packages/` | `rehype-typlet` and `markdown-it-typlet`, published as their own packages |
| `fonts/` | The web fonts and `typlet.css`, built by `tools/fonts/` |
| `oracle/` | A Rust tool that runs the real Typst compiler to produce reference outputs |
| `test/` | The tests, the corpus of formulas (`test/corpus/`) and the oracle's outputs for it (`test/fixtures/`) |
| `tools/` | Scripts that build the corpus, the fixtures, the generated data, the fonts and the documentation site; the fuzzers; and the demo page |
| `scripts/` | The build, and the checks that `npm run check` runs |
| `bench/` | Benchmarks against KaTeX |
| `docs/` | The design (`DESIGN.md`), the map of ported Typst files (`UPSTREAM.md`), the generated list of supported features, and the documentation site's pages (`docs/site/`) |

[docs/DESIGN.md](docs/DESIGN.md) explains the design: how Typlet mirrors Typst's math pipeline, how it is tested against Typst, and what it supports and why.

## Commands

```bash
npm run check          # everything above; run it before a pull request
npm test               # the tests alone
npm run build          # build dist/
npm run oracle:build   # build the oracle
npm run corpus         # rebuild test/corpus from its sources
npm run fixtures       # regenerate test/fixtures with the oracle
npm run fixtures:check # fail if test/fixtures is stale
npm run codegen        # regenerate src/generated/ from the oracle and Typst's crates
npm run fonts          # rebuild fonts/ from New Computer Modern Math (needs Python)
npm run test:browsers  # check the fonts' rendering and the contrib modules in Chromium,
                       # Firefox and WebKit (after npm run build)
npm run test:visual    # compare the HTML with Typst's SVG, and check wrapping, in
                       # the three browsers (after npm run build and the oracle)
npm run fuzz           # compare the parser with typst-syntax on 100,000 random inputs
npm run fuzz:eval      # compare evaluation, MathML and layout with Typst on 5,000
                       # random formulas (--seed N for others, --replay FILE to
                       # check a failure report's formulas again)
npm run demo           # a page that shows Typst's SVG, Typlet's HTML and its MathML
                       # side by side, on http://localhost:5174/
npm run docs:features  # regenerate docs/supported.md from the library
npm run docs:build     # build the documentation site into site/ (after npm run build)
npm run docs:serve     # serve it on http://localhost:5175/
npm run bench          # benchmark against KaTeX (after npm run build)
```

## How Typlet is tested

Typlet is checked against the Typst compiler, not by eye:
- **The corpus** (`test/corpus/`) holds formulas, and **the fixtures** (`test/fixtures/`) hold what the oracle produced for each: Typst's syntax tree, content tree, MathML, frames and diagnostics. The tests compare Typlet's with them.
- **A fix for a formula starts with the formula.** Add it to a corpus source in `tools/corpus/`, run `npm run corpus` and `npm run fixtures`, and the tests then show how Typlet differs from Typst. Without Rust, push the change to the corpus source: the Oracle workflow regenerates the corpus and the fixtures, and uploads what changed as a patch (the `regenerated` artifact) to apply with `git apply`.
- **Don't edit generated files by hand:** `test/corpus/*.jsonl`, `test/fixtures/`, `src/generated/` and `docs/supported.md` come from the commands above, and CI checks that they are current.
- **The fuzzers** compare random inputs with Typst. A failure they report belongs in the corpus once it is fixed. In CI, a failing run uploads the inputs that failed (the `fuzz-failures` artifact), and `npm run fuzz:eval -- --replay FILE` checks fuzz:eval's again.
- **The visual tests** compare Typlet's HTML with Typst's SVG in three browsers. On Linux, where browsers hint fonts, they turn hinting off in Chromium and Firefox and allow WebKit, which can't, more difference (`test/browsers/visual.mjs` explains why). In CI, a failing run uploads the pictures of each mismatch.

## Code

- **Ported files follow Typst's.** Most of `src/` is a TypeScript port of Typst's Rust source, file by file, so that a new Typst version can be ported as a diff. Keep a ported file's structure and names close to its source. Its header names the upstream file, and [docs/UPSTREAM.md](docs/UPSTREAM.md) lists them all; `npm run check:headers` checks both. A file that isn't ported starts with `// Typlet original: not ported from Typst.`
- **Errors are Typst's.** Messages and hints match Typst's, and the tests compare them.
- **No runtime dependencies,** and the bundles have size budgets in `scripts/size-budgets.json`. If a change needs a budget raised, say why in the pull request.
- **Comments say why,** in plain sentences. The code says what.
- TypeScript is strict. There is no formatter configuration: match the code around your change, with two spaces and single quotes.

## Pull requests

- Work on a branch of your own, and open the pull request against `main`.
- Run `npm run check`. If you changed the layout or the HTML, run `npm run test:visual` too, if you have the oracle.
- Add or update tests, or corpus formulas, for what you changed.
- If users will notice the change, add a line to the Unreleased section of [CHANGELOG.md](CHANGELOG.md).
- Write commit messages as [Conventional Commits](https://www.conventionalcommits.org/): a type, an optional scope and a summary, such as `fix(layout): …`, `docs: …` or `ci: …`.
- Describe what the change does and how you checked it.

## Licensing

Typlet is under the MIT License, and contributions are accepted under it. Code ported from Typst or codex stays under their Apache-2.0 notices: keep the headers of ported files, and add one to a new port. Don't copy code from other projects without checking its license and adding it to [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Formulas added to the corpus must be your own or freely licensed.

## Releasing

For maintainers. Releases are tags on `main`, and publishing one as a GitHub release publishes the packages:
1. Set the version in `package.json`, `package-lock.json`, `src/version.ts`, the packages in `packages/` (and their dependency on `typlet`, when the minor version changes) and the README's install snippet. Rename the Unreleased section of `CHANGELOG.md` to the version. The tests check that these agree.
2. Run `npm run check`, `npm run test:browsers` and `npm run test:visual`.
3. Commit to `main` and push.
4. Publish a GitHub release of a new tag `v<version>` on that commit, as the latest release. The release workflow (`.github/workflows/release.yml`) runs CI on the tag, publishes `typlet`, `rehype-typlet` and `markdown-it-typlet` to npm, and then deploys the documentation site. A pre-release, or a release that isn't the latest, publishes nothing.

npm trusts the release workflow to publish the three packages (trusted publishing), so it needs no token. A run that failed partway can be re-run, and skips the packages npm already has. The run uses the workflow of the tagged commit, so a fix to the workflow itself needs a new release.
