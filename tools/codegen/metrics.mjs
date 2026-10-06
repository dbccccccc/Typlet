// Generates the metrics of Typst's math font, New Computer Modern Math Book,
// from the oracle (so build it first with `npm run oracle:build`):
//
//   test/fixtures/typst-<version>/font.jsonl
//                              the oracle's dump of the font as Typst reads it
//   src/generated/metrics.ts   what Typlet's layout needs of it, for the
//                              glyphs Typst can reach from the core
//                              characters: the math blocks and every symbol's
//                              characters (docs/DESIGN.md §4)
//   src/generated/metrics-extended.ts
//                              the same for the glyphs only the other
//                              characters reach, such as Devanagari
//
//   node tools/codegen/metrics.mjs
//
// The font files in fonts/ are built from the same dump (tools/fonts/).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonl } from '../lib/jsonl.mjs';
import { codexCharacters, isCoreText, readFont, reachableGlyphs, supportedTexts } from '../lib/math-font.mjs';
import { oracleVersion, runOracle } from '../lib/oracle.mjs';

const root = join(import.meta.dirname, '../..');
const version = oracleVersion();

const records = runOracle(['font']);
const fixtureDir = join(root, `test/fixtures/typst-${version}`);
mkdirSync(fixtureDir, { recursive: true });
writeJsonl(join(fixtureDir, 'font.jsonl'), records);

const font = readFont(records);
const texts = supportedTexts(font);
const codex = codexCharacters(root);
const coreTexts = texts.filter(([text]) => isCoreText(text, codex));
const extendedTexts = texts.filter(([text]) => !isCoreText(text, codex));
const coreGlyphs = reachableGlyphs(font, coreTexts);
const core = new Set(coreGlyphs);
const extendedGlyphs = reachableGlyphs(font, texts).filter((id) => !core.has(id));

// --- Shaping -------------------------------------------------------------------

// In this font, Typst's math shaping is: map the text, apply `dtls`, then
// apply `ssty`; every result is a single glyph at its own advance. The maps
// come from the dump, which is then checked against them in full.
function shapingMaps(font, texts) {
  const single = (features) => {
    const map = new Map();
    for (const [text, glyph] of texts) {
      const shaped = font.shapes.get(features)?.get(text);
      if (shaped?.length === 1) map.set(glyph, shaped[0][0]);
    }
    return map;
  };
  const dtls = single('dtls=1');
  const ssty = [1, 2].map((level) => {
    const map = single(`ssty=${level}`);
    // Dotless glyphs only appear through `dtls`, so their alternates only show
    // with both features.
    for (const [text, glyph] of texts) {
      const both = font.shapes.get(`ssty=${level},dtls=1`)?.get(text);
      const dotless = dtls.get(glyph);
      if (dotless !== undefined && both?.length === 1 && both[0][0] !== dotless) map.set(dotless, both[0][0]);
    }
    return map;
  });

  const ignorable = new Set([...font.shapes.get('').entries()].filter(([, g]) => g.length === 0).map(([t]) => t));
  for (const [features, results] of font.shapes) {
    const level = /ssty=(\d)/.exec(features)?.[1];
    for (const [text, glyph] of texts) {
      if (ignorable.has(text)) {
        if (results.get(text)?.length !== 0) throw new Error(`${features}: ${text} should shape to nothing`);
        continue;
      }
      let id = glyph;
      if (features.includes('dtls')) id = dtls.get(id) ?? id;
      if (level) id = ssty[level - 1].get(id) ?? id;
      const shaped = results.get(text) ?? [[glyph, font.glyphs.get(glyph).advance ?? 0, 0, 0, 0]];
      const expected = [[id, font.glyphs.get(id).advance ?? 0, 0, 0, 0]];
      if (JSON.stringify(shaped) !== JSON.stringify(expected)) {
        throw new Error(`${features}: ${JSON.stringify(text)} shapes to ${JSON.stringify(shaped)}, not ${JSON.stringify(expected)}`);
      }
    }
  }
  return { font, dtls, ssty, ignorable };
}
const book = shapingMaps(font, texts);

// --- Encoding --------------------------------------------------------------------

/** Base 36, with a minus sign for negative numbers. */
const b36 = (n) => (n < 0 ? `-${(-n).toString(36)}` : n.toString(36));

// The digits of a number column: the printable ASCII characters but `"`, `<`
// and the backslash, so that the data needs no escapes in a string, and can't
// end a script element it is inlined in.
const DIGITS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).filter((c) => !'"<\\'.includes(c));

/**
 * Numbers as a number column: two digits per number, so that the font module
 * finds a glyph's number without reading the others'. A number is stored as
 * its distance from the smallest, plus one; 0 stands for `undefined`.
 * Returns the column and the smallest number.
 */
function numberColumn(numbers) {
  const present = numbers.filter((n) => n !== undefined);
  const min = present.length > 0 ? Math.min(...present) : 0;
  const base = DIGITS.length;
  const column = numbers
    .map((n) => {
      const value = n === undefined ? 0 : n - min + 1;
      if (value >= base * base) throw new Error(`${n} does not fit a number column that starts at ${min}`);
      return DIGITS[Math.floor(value / base)] + DIGITS[value % base];
    })
    .join('');
  return [column, min];
}

/** Sorted numbers as runs: the gap before each run and its length. */
function runs(ids) {
  const out = [];
  let prev = 0;
  for (let i = 0; i < ids.length; ) {
    let j = i + 1;
    while (j < ids.length && ids[j] === ids[j - 1] + 1) j++;
    out.push(`${b36(ids[i] - prev)}.${b36(j - i)}`);
    prev = ids[j - 1] + 1;
    i = j;
  }
  return out.join(',');
}

const kernCorner = (k) => (k ? `${k.heights.map(b36).join(' ')};${k.kerns.map(b36).join(' ')}` : '');
const kernTable = (k) => ['topRight', 'topLeft', 'bottomRight', 'bottomLeft'].map((c) => kernCorner(k[c])).join('|');
const construction = (base, c) => {
  const variants = c.variants.map(([id, advance]) => `${b36(id - base)} ${b36(advance)}`).join(' ');
  const parts = c.assembly?.parts.map(([id, start, end, full, extender]) =>
    [b36(id - base), b36(start), b36(end), b36(full), extender ? 1 : 0].join(' '),
  );
  return `${variants}|${c.assembly ? [b36(c.assembly.italic), ...parts].join(';') : ''}`;
};

/**
 * The metrics of `glyphs` and the shaping of `ownTexts` in a font, as strings.
 * Each table of the glyphs is a column, in the order of GLYPHS. The numbers
 * every glyph needs are number columns. The tables few glyphs have are
 * columns of fields separated by commas, empty where the glyph has no value.
 * The font module reads only the glyphs a formula needs.
 */
function encode({ font, dtls, ssty, ignorable }, glyphs, ownTexts) {
  const column = (f) => glyphs.map((id) => f(font.glyphs.get(id), id) ?? '').join(',');
  const mins = [];
  const numbers = (f) => {
    const [text, min] = numberColumn(glyphs.map((id) => f(font.glyphs.get(id))));
    mins.push(min);
    return text;
  };
  const bbox = (i) => numbers((g) => g.bbox && (i === 2 ? g.bbox[2] - (g.advance ?? 0) : g.bbox[i]));

  // The character map, as runs of characters mapped to consecutive glyphs.
  const chars = ownTexts.filter(([text]) => [...text].length === 1).map(([text, id]) => [text.codePointAt(0), id]);
  const cmap = [];
  for (let i = 0, prevCp = 0, prevId = 0; i < chars.length; ) {
    let j = i + 1;
    while (j < chars.length && chars[j][0] === chars[j - 1][0] + 1 && chars[j][1] === chars[j - 1][1] + 1) j++;
    cmap.push(`${b36(chars[i][0] - prevCp)} ${b36(j - i)} ${b36(chars[i][1] - prevId)}`);
    prevCp = chars[j - 1][0] + 1;
    prevId = chars[i][1];
    i = j;
  }
  const sequences = ownTexts
    .filter(([text]) => [...text].length === 2)
    .map(([text, id]) => [...[...text].map((c) => c.codePointAt(0)), id].map(b36).join(' '));

  // Characters shaping removes, such as zero-width joiners.
  const ignorables = chars.filter(([cp]) => ignorable.has(String.fromCodePoint(cp))).map(([cp]) => cp);
  const mapped = new Set(chars.map(([, id]) => id));

  return {
    GLYPHS: runs(glyphs),
    ADVANCES: numbers((g) => g.advance ?? 0),
    X_MIN: bbox(0),
    Y_MIN: bbox(1),
    X_MAX: bbox(2),
    Y_MAX: bbox(3),
    ITALICS: numbers((g) => g.italic),
    ACCENTS: numbers((g) => g.accent),
    // The smallest number of each number column, in the order above.
    MINS: mins,
    EXTENDED: runs(glyphs.filter((id) => font.glyphs.get(id).extended)),
    // The glyphs no character maps to, which are drawn with private-use code points.
    UNMAPPED: runs(glyphs.filter((id) => !mapped.has(id))),
    KERNS: column((g) => g.kern && kernTable(g.kern)),
    VERTICAL: column((g, id) => g.vertical && construction(id, g.vertical)),
    HORIZONTAL: column((g, id) => g.horizontal && construction(id, g.horizontal)),
    CMAP: cmap.join(','),
    SEQUENCES: sequences.join(','),
    IGNORABLE: runs(ignorables),
    DTLS: column((_, id) => (dtls.has(id) ? b36(dtls.get(id) - id) : '')),
    SSTY: column((_, id) => (ssty[0].has(id) || ssty[1].has(id) ? ssty.map((m) => (m.has(id) ? b36(m.get(id) - id) : '')).join(' ') : '')),
  };
}

function write(file, title, data, extra = [], source = font) {
  const lines = [
    `// Generated by tools/codegen/metrics.mjs from the oracle's dump of`,
    `// ${source.header.postScriptName}, Typst ${version}'s math font: ${title}. Do not edit.`,
    `// src/layout/font.ts reads it.`,
    ``,
    ...extra,
    `export const DATA = {`,
    ...Object.entries(data).map(([name, value]) => `  ${name}: ${JSON.stringify(value)},`),
    `};`,
    ``,
  ];
  writeFileSync(join(root, 'src/generated', file), lines.join('\n'));
}

const header = {
  unitsPerEm: font.header.unitsPerEm,
  glyphCount: font.header.glyphCount,
  minConnectorOverlap: font.header.minConnectorOverlap,
  metrics: font.header.metrics,
  math: font.header.math,
};
write('metrics.ts', 'the core glyphs', encode(book, coreGlyphs, coreTexts), [
  `export const FONT = ${JSON.stringify(header, null, 2)};`,
  ``,
]);
write('metrics-extended.ts', 'the extended glyphs', encode(book, extendedGlyphs, extendedTexts));

// --- The Bold face -----------------------------------------------------------------

// Typst sets text in a heavier weight, such as `strong[x]`, in New Computer
// Modern Math Bold. Typlet has its metrics for the characters of the Bold
// font subset (tools/fonts/build.mjs): Latin letters, digits and punctuation.
const BOLD_RANGES = [
  [0x20, 0x7e],
  [0xa0, 0xff],
];
const boldRecords = runOracle(['font', 'NewCMMath-Bold']);
const boldFont = readFont(boldRecords);
const boldTexts = supportedTexts(boldFont).filter(([text]) => {
  const cp = text.codePointAt(0);
  return [...text].length === 1 && BOLD_RANGES.some(([a, b]) => cp >= a && cp <= b);
});
const boldGlyphs = [...new Set(boldTexts.map(([, id]) => id))].sort((a, b) => a - b);
const bold = shapingMaps(boldFont, boldTexts);
// The fixture keeps what Typlet has: the header, these glyphs, and their map.
const boldIds = new Set(boldGlyphs);
writeJsonl(join(fixtureDir, 'font-bold.jsonl'), [
  boldRecords.find((r) => r.kind === 'font'),
  ...boldRecords.filter((r) => r.kind === 'glyph' && boldIds.has(r.id)),
  { kind: 'cmap', chars: boldTexts, sequences: [] },
]);
write('metrics-bold.ts', 'the Bold face, for Latin text', encode(bold, boldGlyphs, boldTexts), [
  `export const BOLD_FONT = ${JSON.stringify({ postScriptName: boldFont.header.postScriptName, glyphCount: boldFont.header.glyphCount })};`,
  ``,
], boldFont);

console.log(
  `metrics.ts: ${coreGlyphs.length} glyphs, ${coreTexts.length} texts; ` +
    `metrics-extended.ts: ${extendedGlyphs.length} glyphs, ${extendedTexts.length} texts; ` +
    `metrics-bold.ts: ${boldGlyphs.length} glyphs; ` +
    `font.jsonl: ${records.length} records`,
);
