// Builds Typlet's web fonts from New Computer Modern Math Book, the math font
// Typst uses, and a Latin subset of its Bold, which Typst uses for strong
// text in math (docs/DESIGN.md §4):
//
//   fonts/typlet-newcm-math-<group>.woff2   the font, split by characters
//   fonts/typlet.css                        @font-face rules and base styles
//   fonts/manifest.json                     the files, their characters and sizes
//   fonts/GUST-FONT-LICENSE.txt             the font's license
//   fonts/MANIFEST-typlet-newcm-math.txt    the derived files, as the license asks
//
//   node tools/fonts/build.mjs [--fonts DIRECTORY]
//
// It plans the files from the oracle's dump of the font
// (test/fixtures/typst-<version>/font.jsonl, from `npm run codegen`) and runs
// tools/fonts/subset.py, which needs Python with fontTools:
//
//   python -m venv .venv
//   .venv/Scripts/pip install -r tools/fonts/requirements.txt   (bin/pip elsewhere)
//
// Without --fonts, NewCMMath-Book.otf and NewCMMath-Bold.otf come from the
// typst-assets crate in the cargo registry, which building the oracle
// downloads.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { cratePath } from '../lib/cargo.mjs';
import { readJsonl } from '../lib/jsonl.mjs';
import {
  codexCharacters,
  drawingCodePoints,
  isCoreText,
  isPrivateUse,
  reachableGlyphs,
  readFont,
  supportedTexts,
} from '../lib/math-font.mjs';

const root = join(import.meta.dirname, '../..');
const outDir = join(root, 'fonts');
const FAMILY = 'Typlet NewCM Math';
const FILE_PREFIX = 'typlet-newcm-math';

const fontsArg = process.argv.indexOf('--fonts');
const assets = fontsArg === -1 ? cratePath('typst-assets') : null;
const sourceDir = fontsArg === -1 ? join(assets, 'files/fonts') : process.argv[fontsArg + 1];

// The Latin characters of the Bold subset.
const BOLD_LATIN = [
  [0x20, 0x7e],
  [0xa0, 0xff],
];
const BOLD_FILE = `${FILE_PREFIX}-bold-latin.woff2`;
const typstVersion = /typstVersion = '([^']+)'/.exec(readFileSync(join(root, 'src/version.ts'), 'utf8'))[1];
const font = readFont(readJsonl(join(root, `test/fixtures/typst-${typstVersion}/font.jsonl`)));

// --- Groups ------------------------------------------------------------------

const single = (cps) => cps.map((cp) => [cp, cp]);
const SCRIPT_LETTERLIKE = [0x210a, 0x210b, 0x2110, 0x2112, 0x211b, 0x212c, 0x212f, 0x2130, 0x2131, 0x2133, 0x2134];
const FRAKTUR_LETTERLIKE = [0x210c, 0x2111, 0x211c, 0x2128, 0x212d];
const DOUBLE_STRUCK_LETTERLIKE = [
  0x2102, 0x210d, 0x2115, 0x2119, 0x211a, 0x211d, 0x2124, 0x213c, 0x213d, 0x213e, 0x213f, 0x2140, 0x2145, 0x2146,
  0x2147, 0x2148, 0x2149,
];

// What most formulas use: ASCII, the Latin-1 signs of math, Greek, the
// accents of `math.accent`, common punctuation, letterlike symbols, arrows,
// operators and relations, delimiters, and math italic. The characters a
// formula among 128,000 converted from the IBEM corpus uses at least once in
// 10,000, plus their close neighbors.
const MAIN = [
  [0x20, 0x7e],
  ...single([0xa0, 0xa7, 0xac, 0xb0, 0xb1, 0xb7, 0xd7, 0xf7, 0x131, 0x237]),
  [0x300, 0x308],
  [0x30a, 0x30c],
  [0x370, 0x3ff],
  [0x2000, 0x200a],
  [0x2013, 0x2016],
  [0x2018, 0x2019],
  [0x201c, 0x201d],
  [0x2020, 0x2022],
  [0x2026, 0x2026],
  [0x2032, 0x2037],
  [0x2057, 0x2057],
  [0x20d0, 0x20d1],
  [0x20d6, 0x20d7],
  [0x20db, 0x20dc],
  [0x20e1, 0x20e1],
  [0x210e, 0x210f],
  ...single([0x2113, 0x2118, 0x2127]),
  [0x2135, 0x2138],
  [0x2190, 0x2199],
  [0x21a6, 0x21a6],
  [0x21a9, 0x21aa],
  [0x21bc, 0x21c4],
  [0x21d0, 0x21d5],
  [0x21dd, 0x21dd],
  [0x2200, 0x2245],
  ...single([0x2248, 0x224d, 0x2250, 0x2254, 0x225c]),
  [0x2260, 0x2271],
  [0x2272, 0x2273],
  [0x227a, 0x227b],
  [0x2282, 0x228b],
  [0x228e, 0x228e],
  [0x2293, 0x2299],
  [0x229b, 0x229b],
  [0x22a0, 0x22a9],
  [0x22ba, 0x22ba],
  [0x22c0, 0x22c6],
  [0x22ce, 0x22cf],
  [0x22ee, 0x22f1],
  [0x2308, 0x230b],
  // The braces, brackets, parentheses and shells of `underbrace` and co.
  [0x23b4, 0x23b5],
  [0x23dc, 0x23e1],
  [0x27c2, 0x27c2],
  [0x27e6, 0x27ef],
  [0x27f5, 0x27fc],
  [0x2a00, 0x2a02],
  [0x2a04, 0x2a06],
  [0x2a7d, 0x2a7e],
  [0x2aaf, 0x2ab0],
  [0x1d434, 0x1d467],
  [0x1d6a4, 0x1d6a5],
  [0x1d6e2, 0x1d71b],
];

/**
 * The font files. Each supported character goes into the first group whose
 * ranges contain it: a math alphabet, `main`, or the group of its block. A
 * variation sequence goes with its character.
 */
const GROUPS = [
  { name: 'bold', ranges: [[0x1d400, 0x1d433], [0x1d6a8, 0x1d6e1], [0x1d7ca, 0x1d7d7]] },
  { name: 'bold-italic', ranges: [[0x1d468, 0x1d49b], [0x1d71c, 0x1d755]] },
  { name: 'script', ranges: [[0x1d49c, 0x1d4cf], ...single(SCRIPT_LETTERLIKE)] },
  { name: 'bold-script', ranges: [[0x1d4d0, 0x1d503]] },
  { name: 'fraktur', ranges: [[0x1d504, 0x1d537], ...single(FRAKTUR_LETTERLIKE)] },
  { name: 'bold-fraktur', ranges: [[0x1d56c, 0x1d59f]] },
  { name: 'double-struck', ranges: [[0x1d538, 0x1d56b], [0x1d7d8, 0x1d7e1], ...single(DOUBLE_STRUCK_LETTERLIKE)] },
  { name: 'sans', ranges: [[0x1d5a0, 0x1d5d3], [0x1d608, 0x1d63b], [0x1d7e2, 0x1d7eb]] },
  { name: 'sans-bold', ranges: [[0x1d5d4, 0x1d607], [0x1d63c, 0x1d66f], [0x1d756, 0x1d7c9], [0x1d7ec, 0x1d7f5]] },
  { name: 'mono', ranges: [[0x1d670, 0x1d6a3], [0x1d7f6, 0x1d7ff]] },
  { name: 'main', ranges: MAIN },
  { name: 'operators', ranges: [[0x2200, 0x22ff], [0x2300, 0x23ff], [0x2980, 0x2aff]] },
  { name: 'arrows', ranges: [[0x2190, 0x21ff], [0x27f0, 0x27ff], [0x2900, 0x297f], [0x2b00, 0x2bff], [0x1f800, 0x1f8ff]] },
  {
    name: 'symbols',
    ranges: [[0x2000, 0x218f], [0x2400, 0x27ef], [0x2e00, 0x2e7f], [0x3000, 0x303f], [0x1f700, 0x1f7ff]],
  },
  { name: 'latin', ranges: [[0xa0, 0x36f], [0x400, 0x6ff], [0x1e00, 0x1eff], [0xfb00, 0xfb4f]] },
  { name: 'devanagari', ranges: [[0x900, 0x97f]] },
  { name: 'arabic-math', ranges: [[0x1ee00, 0x1eeff]] },
  { name: 'other', ranges: [[0, 0x10ffff]] },
];

// A glyph shared by several files is drawn from the first of them in this
// order, so that formulas using only `main` load nothing else.
const PRIORITY = ['main', ...GROUPS.map((g) => g.name).filter((name) => name !== 'main')];

const texts = supportedTexts(font);
const codex = codexCharacters(root);
const coreTexts = texts.filter(([text]) => isCoreText(text, codex));
const coreGlyphs = reachableGlyphs(font, coreTexts);
const coreSet = new Set(coreGlyphs);
const extendedGlyphs = reachableGlyphs(font, texts).filter((id) => !coreSet.has(id));
const drawing = drawingCodePoints([
  [coreGlyphs, coreTexts],
  [extendedGlyphs, texts.filter(([text]) => !isCoreText(text, codex))],
]);

const groupOf = new Map();
for (const [text] of texts) {
  const cp = text.codePointAt(0);
  groupOf.set(text, GROUPS.find((g) => g.ranges.some(([first, last]) => cp >= first && cp <= last)).name);
}
const textsOf = (name) => texts.filter(([text]) => groupOf.get(text) === name);

// Glyphs that a group reaches are drawn with their code points. When one is
// another group's character, such as a bracket piece of an assembly, it moves
// to the earlier group, so that drawing the assembly needs no other file.
const byChar = new Map(texts.filter(([text]) => [...text].length === 1).map(([text]) => [text.codePointAt(0), text]));
for (let changed = true; changed; ) {
  changed = false;
  for (const [rank, name] of PRIORITY.entries()) {
    for (const id of reachableGlyphs(font, textsOf(name))) {
      const text = byChar.get(drawing.get(id));
      if (text === undefined) continue;
      const owner = groupOf.get(text);
      if (PRIORITY.indexOf(owner) > rank) {
        // The character's variation sequences move with it.
        for (const [t] of texts) if (t === text || (t.startsWith(text) && [...t].length === 2)) groupOf.set(t, name);
        changed = true;
      }
    }
  }
}

// Each file has the glyphs its characters reach. A glyph's private-use code
// point maps only in the first file, by priority, that has the glyph.
const files = [];
const home = new Map();
for (const name of PRIORITY) {
  const own = textsOf(name);
  if (own.length === 0) continue;
  const glyphs = reachableGlyphs(font, own);
  const chars = own.filter(([text]) => [...text].length === 1).map(([text]) => text.codePointAt(0));
  const privateUse = [];
  for (const id of glyphs) {
    if (home.has(id)) continue;
    home.set(id, name);
    if (isPrivateUse(drawing.get(id))) privateUse.push(drawing.get(id));
  }
  // Variation sequences need their selectors in the same face.
  const selectors = own.some(([text]) => [...text].length === 2) ? [...Array(16).keys()].map((i) => 0xfe00 + i) : [];
  const unicodes = [...new Set([...chars, ...selectors, ...privateUse])].sort((a, b) => a - b);
  files.push({ name, file: `${FILE_PREFIX}-${name}.woff2`, unicodes, glyphs, texts: own.length });
}

// --- Fonts -------------------------------------------------------------------

function python() {
  const venv = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  for (const candidate of [venv, 'python3', 'python']) {
    if (candidate === venv && !existsSync(venv)) continue;
    const probe = spawnSync(candidate, ['-c', 'import fontTools, brotli'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  throw new Error('Python with fontTools and brotli is required: see tools/fonts/build.mjs.');
}

mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (f.endsWith('.woff2')) rmSync(join(outDir, f));

const boldUnicodes = BOLD_LATIN.flatMap(([first, last]) => [...Array(last - first + 1).keys()].map((i) => first + i));
const plan = {
  outDir,
  family: FAMILY,
  faces: [
    {
      source: join(sourceDir, 'NewCMMath-Book.otf'),
      postScriptName: 'TypletNewCMMath-Book',
      style: 'Book',
      privateUse: [...drawing].filter(([, cp]) => isPrivateUse(cp)).map(([id, cp]) => [cp, id]),
      layoutFeatures: ['ssty', 'dtls', 'kern'],
      keepMath: true,
      files: files.map((f) => ({ name: f.file, unicodes: f.unicodes, glyphs: f.glyphs })),
    },
    {
      source: join(sourceDir, 'NewCMMath-Bold.otf'),
      postScriptName: 'TypletNewCMMath-Bold',
      style: 'Bold',
      privateUse: [],
      layoutFeatures: ['kern'],
      keepMath: false,
      files: [{ name: BOLD_FILE, unicodes: boldUnicodes, glyphs: [] }],
    },
  ],
};
const result = spawnSync(python(), [join(import.meta.dirname, 'subset.py')], {
  input: JSON.stringify(plan),
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (result.status !== 0) throw new Error(`subset.py failed:\n${result.stderr}`);
const built = new Map(
  result.stdout
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .map((r) => [r.name, r]),
);

// --- CSS, manifest and license -----------------------------------------------

/** Code points as CSS unicode-range values. */
function unicodeRange(cps) {
  const out = [];
  for (let i = 0; i < cps.length; ) {
    let j = i + 1;
    while (j < cps.length && cps[j] === cps[j - 1] + 1) j++;
    const hex = (cp) => cp.toString(16).toUpperCase();
    out.push(j - i === 1 ? `U+${hex(cps[i])}` : `U+${hex(cps[i])}-${hex(cps[j - 1])}`);
    i = j;
  }
  return out.join(', ');
}

// Typst's styles for MathML, from its HTML export, and those of Typlet's HTML.
const bundle = join(tmpdir(), `typlet-fonts-${process.pid}.mjs`);
await build({
  stdin: {
    contents: `export { equationCss } from './src/mathml/mathml.ts'; export { HTML_CSS } from './src/html/css.ts';`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  logLevel: 'error',
});
const { equationCss, HTML_CSS } = await import(pathToFileURL(bundle).href);
rmSync(bundle);

/** Scopes every rule under `.typlet`, which wraps all of Typlet's output. */
function scoped(css) {
  return css.replace(/(^|\})([^{}]*?)([^\s{}][^{}]*)\{/g, (_, close, space, selectors) => {
    const comment = /^(\/\*[\s\S]*?\*\/\s*)/.exec(selectors)?.[1] ?? '';
    const list = selectors.slice(comment.length).trim().split(/,\s*/);
    return `${close}${space}${comment}${list.map((s) => `.typlet ${s}`).join(',\n')} {`;
  });
}

// Overlapping ranges resolve to the last face that covers a code point, so
// `main`, which every formula loads, comes last.
const face = (file, unicodes, weight) => `@font-face {
  font-family: "${FAMILY}";
  src: url(${file}) format("woff2");${weight ? `\n  font-weight: ${weight};` : ''}
  font-display: block;
  unicode-range: ${unicodeRange(unicodes)};
}`;
const faces = [face(BOLD_FILE, boldUnicodes, 'bold'), ...[...files].reverse().map((f) => face(f.file, f.unicodes))];
const css = `/*! Typlet's fonts: ${FAMILY}, derived from New Computer Modern Math Book
 * by Antonis Tsolomitis, under the GUST Font License (GUST-FONT-LICENSE.txt).
 * The styles for MathML, from the "Alignment" rules on, are ported from Typst's
 * HTML export: Copyright The Typst Project Developers, Apache License 2.0. The
 * other styles are Typlet's, under the MIT License. See THIRD_PARTY_NOTICES.md.
 * Generated by tools/fonts/build.mjs. */

${faces.join('\n')}

${HTML_CSS}

${scoped(`math {
  font-family: "${FAMILY}", math;
}

${equationCss()}`)}
`;
writeFileSync(join(outDir, 'typlet.css'), css);

const manifest = {
  family: FAMILY,
  source: {
    fonts: ['NewCMMath-Book.otf', 'NewCMMath-Bold.otf'],
    package: assets ? `typst-assets ${/typst-assets-([\d.]+)/.exec(assets)?.[1] ?? ''}` : sourceDir,
    typst: typstVersion,
    license: 'GUST Font License 1.0',
  },
  files: [
    ...files.map((f) => ({
      file: f.file,
      bytes: built.get(f.file).bytes,
      glyphs: built.get(f.file).glyphs,
      characters: f.texts,
      unicodeRange: unicodeRange(f.unicodes),
    })),
    {
      file: BOLD_FILE,
      weight: 'bold',
      bytes: built.get(BOLD_FILE).bytes,
      glyphs: built.get(BOLD_FILE).glyphs,
      unicodeRange: unicodeRange(boldUnicodes),
    },
  ],
};
writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

if (assets) {
  // typst-assets' NOTICE carries the license text New Computer Modern ships with.
  const notice = readFileSync(join(assets, 'NOTICE'), 'utf8');
  const start = notice.indexOf('% This is version 1.0, dated 22 June 2009, of the GUST Font License.');
  const end = notice.indexOf('================', start);
  if (start === -1 || end === -1) throw new Error('GUST Font License not found in typst-assets NOTICE');
  writeFileSync(join(outDir, 'GUST-FONT-LICENSE.txt'), `${notice.slice(start, end).trimEnd()}\n`);
}
writeFileSync(
  join(outDir, 'MANIFEST-typlet-newcm-math.txt'),
  `${FAMILY}

The files below make up ${FAMILY}, derived from New Computer Modern Math
Book and Bold (NewCMMath-Book.otf and NewCMMath-Bold.otf, (C) 2019-2026
Antonis Tsolomitis), as bundled by Typst ${typstVersion}. As the GUST Font
License requests, the fonts and their files have new names. The changes:
the Book font is subset to the glyphs Typst reaches from the characters
Typlet supports, split into the files below by character, and given
private-use code points for its glyphs that have none; the Bold font is
subset to Latin characters; both have the same ascent and descent in their
hhea, OS/2 typo and win metrics, and TrueType outlines converted from their
CFF ones. The license is in GUST-FONT-LICENSE.txt.

${[...files.map((f) => f.file), BOLD_FILE].join('\n')}
typlet.css
`,
);

let total = 0;
for (const f of [...files, { file: BOLD_FILE }]) {
  const { bytes, glyphs } = built.get(f.file);
  total += bytes;
  console.log(`${f.file.padEnd(40)} ${String(glyphs).padStart(5)} glyphs ${(bytes / 1024).toFixed(1).padStart(7)} KB`);
}
console.log(`${files.length + 1} files, ${(total / 1024).toFixed(1)} KB`);
