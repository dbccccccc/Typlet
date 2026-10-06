// Typst's math font as the oracle dumps it (`typlet-oracle font`), and what
// Typlet derives from it: the texts it supports, the glyphs Typst can reach
// from them, and the code points Typlet draws those glyphs with.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Private-use code points, which Typlet doesn't support as input. */
export const isPrivateUse = (cp) => (cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000;

/** The first code point Typlet assigns to glyphs that have none of their own. */
export const FIRST_PRIVATE_USE = 0xe000;

/** Reads the oracle's records into lookup tables. */
export function readFont(records) {
  const header = records.find((r) => r.kind === 'font');
  const cmap = records.find((r) => r.kind === 'cmap');
  if (!header || !cmap) throw new Error('not a font dump: missing the font or cmap record');
  const glyphs = new Map(records.filter((r) => r.kind === 'glyph').map((r) => [r.id, r]));
  // Shaping results per feature set, keyed by text; texts not listed shape
  // to their mapped glyph at its advance.
  const shapes = new Map(
    records.filter((r) => r.kind === 'shape').map((r) => [r.features.join(','), new Map(r.results)]),
  );
  return { header, glyphs, chars: cmap.chars, sequences: cmap.sequences, shapes };
}

/** Control characters and noncharacters, which Typlet doesn't support either. */
const isControlOrNonCharacter = (cp) =>
  cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0xfdd0 && cp <= 0xfdef) || (cp & 0xfffe) === 0xfffe;

/**
 * The texts Typlet supports: every character the font maps, except private
 * use, control and noncharacters, and every variation sequence on those
 * characters.
 */
export function supportedTexts(font) {
  const chars = font.chars.filter(([text]) => {
    const cp = text.codePointAt(0);
    return !isPrivateUse(cp) && !isControlOrNonCharacter(cp);
  });
  const supported = new Set(chars.map(([text]) => text));
  const sequences = font.sequences.filter(([text]) => supported.has(String.fromCodePoint(text.codePointAt(0))));
  return [...chars, ...sequences];
}

/** The glyphs a text shapes to with each feature set Typst uses. */
export function shapedGlyphs(font, text, glyph) {
  const out = new Set();
  for (const results of font.shapes.values()) {
    const shaped = results.get(text);
    if (shaped) for (const [id] of shaped) out.add(id);
  }
  // Without features, a text that isn't listed gives its mapped glyph.
  if (!font.shapes.get('')?.has(text)) out.add(glyph);
  return out;
}

/** The variants and assembly parts of a glyph's constructions. */
export function constructionGlyphs(glyph) {
  const out = [];
  for (const axis of ['vertical', 'horizontal']) {
    const construction = glyph[axis];
    if (!construction) continue;
    for (const [id] of construction.variants) out.push(id);
    for (const [id] of construction.assembly?.parts ?? []) out.push(id);
  }
  return out;
}

/** The glyphs reachable from `texts` (`[text, glyph]` pairs): shaped, then stretched. */
export function reachableGlyphs(font, texts) {
  const reached = new Set();
  const queue = [];
  const add = (id) => {
    if (!reached.has(id)) {
      reached.add(id);
      queue.push(id);
    }
  };
  for (const [text, glyph] of texts) for (const id of shapedGlyphs(font, text, glyph)) add(id);
  while (queue.length > 0) for (const id of constructionGlyphs(font.glyphs.get(queue.pop()))) add(id);
  return [...reached].sort((a, b) => a - b);
}

// The Unicode blocks of the core metrics: Latin-1, combining marks, Greek,
// punctuation through letterlike symbols and number forms, arrows,
// operators, technical and miscellaneous math symbols, supplemental arrows
// and operators, and the math alphanumerics.
const CORE_BLOCKS = [
  [0x20, 0xff],
  [0x300, 0x3ff],
  [0x2000, 0x23ff],
  [0x27c0, 0x27ff],
  [0x2900, 0x2aff],
  [0x1d400, 0x1d7ff],
];

/** The characters of every symbol in Typst's `sym` module, from src/generated/symbols.ts. */
export function codexCharacters(root) {
  const source = readFileSync(join(root, 'src/generated/symbols.ts'), 'utf8');
  const literal = /export const SYMBOLS =\s*("(?:[^"\\]|\\.)*")/.exec(source)?.[1];
  if (literal === undefined) throw new Error('SYMBOLS not found in src/generated/symbols.ts');
  const values = JSON.parse(literal)
    .split('\n')
    .flatMap((line) => line.split('\t').slice(1))
    .map((field) => field.slice(field.indexOf('=') + 1));
  return new Set(values.flatMap((value) => [...value].map((c) => c.codePointAt(0))));
}

/**
 * Whether a text belongs to the core metrics, which Typlet always bundles:
 * its first character is in a core block or used by a symbol. The rest, such
 * as Devanagari and box drawing, are in the extended metrics.
 */
export function isCoreText(text, codex) {
  const cp = text.codePointAt(0);
  return codex.has(cp) || CORE_BLOCKS.some(([first, last]) => cp >= first && cp <= last);
}

/**
 * The code points Typlet draws glyphs with, for the core glyphs and then the
 * extended ones (each `[glyphs, texts]`, glyphs sorted): the smallest of the
 * set's characters mapped to a glyph, or else the next private-use code
 * point, counting from U+E000 through both sets.
 */
export function drawingCodePoints(sets) {
  const out = new Map();
  let next = FIRST_PRIVATE_USE;
  for (const [glyphs, texts] of sets) {
    const mapped = new Map();
    for (const [text, glyph] of texts) {
      const cp = text.codePointAt(0);
      if ([...text].length === 1 && (!mapped.has(glyph) || cp < mapped.get(glyph))) mapped.set(glyph, cp);
    }
    for (const id of glyphs) out.set(id, mapped.get(id) ?? next++);
  }
  if (next > 0xf8ff) throw new Error(`too many glyphs without code points: ${next - FIRST_PRIVATE_USE}`);
  return out;
}
