// Typlet original: not ported from Typst.
//
// The metrics of Typst's math font, New Computer Modern Math Book, in font
// units and keyed by its glyph ids, as Typst's math layout reads them with
// ttf-parser and rustybuzz (typst-layout's `fragment/glyph.rs` and
// `shaping.rs`). They are decoded on first use from src/generated/metrics.ts,
// which tools/codegen/metrics.mjs generates from the oracle; the glyphs that
// only rarer characters reach, such as Devanagari, come from
// metrics-extended.ts once it is registered.
//
// The data is a set of strings. A formula needs few glyphs, so each glyph's
// values are read when it is first used:
// - GLYPHS: the glyph ids, as runs `gap.length` of numbers in base 36, the gap
//   counted from the end of the previous run;
// - ADVANCES, X_MIN, Y_MIN, X_MAX, Y_MAX, ITALICS, ACCENTS: number columns,
//   with two characters per glyph, in GLYPHS order, so that a glyph's number
//   is found without reading the others'. The characters are digits in base
//   92, and the number is their value minus one plus the column's entry in
//   MINS; the value 0 stands for a glyph without the number. X_MAX is
//   relative to the advance;
// - KERNS, VERTICAL, HORIZONTAL, DTLS, SSTY: field columns, with one
//   comma-separated field per glyph, in GLYPHS order, empty where the glyph
//   has no value, and numbers in base 36 with a minus sign for negative
//   ones. Few glyphs have these values, and empty fields compress to almost
//   nothing. A glyph's field is found by skipping the fields before it;
// - EXTENDED, UNMAPPED and IGNORABLE: runs like GLYPHS, of the glyphs the
//   MATH table marks as extended shapes, of the glyphs no character maps to,
//   and of the code points shaping removes;
// - CMAP: runs `gap length glyph` of characters mapped to consecutive glyphs,
//   the glyph relative to the previous run's first;
// - SEQUENCES: variation sequences `char selector glyph`.

import { BOLD_FONT, DATA as BOLD } from '../generated/metrics-bold.js';
import { DATA as CORE, FONT } from '../generated/metrics.js';
import { isMark } from '../syntax/unicode.js';

/** The fonts Typlet draws with: New Computer Modern Math Book, and its Bold for heavier text. */
export type FontFace = 'book' | 'bold';

/** The metrics data of a set of glyphs. */
export type MetricsData = typeof CORE;

/** The font's line and script metrics, in ems, as Typst's `FontMetrics`. */
export const FONT_METRICS = FONT.metrics;
/** The MATH table constants, in ems, as Typst's `MathConstants`. */
export const MATH_CONSTANTS = FONT.math;
export const UNITS_PER_EM = FONT.unitsPerEm;
/** The MATH table's minimum overlap of connected assembly parts, in font units. */
export const MIN_CONNECTOR_OVERLAP = FONT.minConnectorOverlap;

/** A glyph's bounding box, in font units. */
export interface Rect {
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

/** A MATH kern table: `kerns` has one more entry than `heights`. */
export interface Kern {
  readonly heights: readonly number[];
  readonly kerns: readonly number[];
}

export interface KernInfo {
  readonly topRight?: Kern;
  readonly topLeft?: Kern;
  readonly bottomRight?: Kern;
  readonly bottomLeft?: Kern;
}

export interface GlyphPart {
  readonly glyph: number;
  readonly startConnector: number;
  readonly endConnector: number;
  readonly fullAdvance: number;
  readonly extender: boolean;
}

/** A glyph's size variants and assembly along one axis. */
export interface GlyphConstruction {
  readonly variants: readonly { readonly glyph: number; readonly advance: number }[];
  readonly assembly: { readonly italic: number; readonly parts: readonly GlyphPart[] } | null;
}

export type Axis = 'vertical' | 'horizontal';

const PRESENT = 1;
const HAS_BBOX = 2;
const EXTENDED_SHAPE = 4;
/** Set for a glyph whose numbers are read, or that no data has. */
const KNOWN = 8;
const HAS_ITALIC = 16;
const HAS_ACCENT = 32;
const FIRST_PRIVATE_USE = 0xe000;
const KERN_CORNERS = ['topRight', 'topLeft', 'bottomRight', 'bottomLeft'] as const;

// The digits of the number columns are the printable ASCII characters but
// `"`, `<` and the backslash, so that the data needs no escapes in a string,
// and can't end a script element it is inlined in.
const DIGITS = 92;
const digit = (c: number): number => c - 32 - (c > 34 ? 1 : 0) - (c > 60 ? 1 : 0) - (c > 92 ? 1 : 0);

/** The number at `index` of a number column, or NaN if the glyph has none. */
function readNumber(column: string, index: number, min: number): number {
  const value = digit(column.charCodeAt(2 * index)) * DIGITS + digit(column.charCodeAt(2 * index + 1));
  return value === 0 ? Number.NaN : value - 1 + min;
}

// A field column is searched from the nearest of its steps, which are STEP
// fields apart. The steps are found as far as a glyph needs them, by skipping
// fields with a regular expression, which scans in native code. Splitting a
// column into its fields instead took several times as long.
const STEP = 128;
const SKIP_STEP = /(?:[^,]*,){128}/y;
const SKIP_QUARTER_STEP = /(?:[^,]*,){32}/y;

/** The field at `index` of a field column. `steps` holds where its steps start, as far as they are known. */
function readField(data: string, steps: number[], index: number): string {
  const step = Math.floor(index / STEP);
  while (steps.length <= step) {
    SKIP_STEP.lastIndex = steps[steps.length - 1]!;
    SKIP_STEP.test(data);
    steps.push(SKIP_STEP.lastIndex);
  }
  let start = steps[step]!;
  let skip = index % STEP;
  for (; skip >= 32; skip -= 32) {
    SKIP_QUARTER_STEP.lastIndex = start;
    SKIP_QUARTER_STEP.test(data);
    start = SKIP_QUARTER_STEP.lastIndex;
  }
  for (; skip > 0; skip--) start = data.indexOf(',', start) + 1;
  const end = data.indexOf(',', start);
  return data.slice(start, end < 0 ? data.length : end);
}

const n36 = (s: string): number => parseInt(s, 36);

/** Numbers as runs: where each run starts and ends, and the index of its first number among them all. */
interface Runs {
  readonly starts: Int32Array;
  readonly ends: Int32Array;
  readonly indexes: Int32Array;
  readonly count: number;
}

/**
 * The numbers of a list: numbers in base 36, with a minus sign for negative
 * ones and any other character between them. They are read character by
 * character: taking the list apart into strings took several times as long.
 */
function readNumbers(data: string): number[] {
  const numbers: number[] = [];
  let value = 0;
  let sign = 1;
  let digits = 0;
  for (let i = 0; i <= data.length; i++) {
    // NaN, past the end, ends the last number as a separator does.
    const c = data.charCodeAt(i);
    if (c >= 97 && c <= 122) {
      value = value * 36 + c - 87;
      digits++;
    } else if (c >= 48 && c <= 57) {
      value = value * 36 + c - 48;
      digits++;
    } else if (c === 45) {
      sign = -1;
    } else if (digits > 0) {
      numbers.push(sign * value);
      value = 0;
      sign = 1;
      digits = 0;
    }
  }
  return numbers;
}

/** Decodes runs `gap.length`, each gap counted from the end of the previous run. */
function decodeRuns(data: string): Runs {
  const numbers = readNumbers(data);
  const length = numbers.length / 2;
  const starts = new Int32Array(length);
  const ends = new Int32Array(length);
  const indexes = new Int32Array(length);
  let next = 0;
  let count = 0;
  for (let k = 0; k < length; k++) {
    const start = next + numbers[2 * k]!;
    starts[k] = start;
    ends[k] = next = start + numbers[2 * k + 1]!;
    indexes[k] = count;
    count += next - start;
  }
  return { starts, ends, indexes, count };
}

/** The index of the last of the ascending numbers that is at most `n`, or -1. */
function lastAtMost(sorted: Int32Array, n: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= n) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi;
}

/** `n`'s index among the numbers of the runs, or -1 if they don't have it. */
function runIndex(runs: Runs, n: number): number {
  const k = lastAtMost(runs.starts, n);
  return k >= 0 && n < runs.ends[k]! ? runs.indexes[k]! + n - runs.starts[k]! : -1;
}

function decodeKern(corner: string): Kern | undefined {
  if (corner === '') return undefined;
  const [heights, kerns] = corner.split(';') as [string, string];
  const numbers = (s: string) => (s === '' ? [] : s.split(' ').map(n36));
  return { heights: numbers(heights), kerns: numbers(kerns) };
}

function decodeKerns(value: string): KernInfo {
  const corners = value.split('|');
  const info: Record<string, Kern> = {};
  KERN_CORNERS.forEach((name, i) => {
    const kern = decodeKern(corners[i]!);
    if (kern) info[name] = kern;
  });
  return info;
}

function decodeConstruction(base: number, value: string): GlyphConstruction {
  const [variantData, assemblyData] = value.split('|') as [string, string];
  const v = variantData === '' ? [] : variantData.split(' ').map(n36);
  const variants = [];
  for (let i = 0; i < v.length; i += 2) variants.push({ glyph: base + v[i]!, advance: v[i + 1]! });
  let assembly: GlyphConstruction['assembly'] = null;
  if (assemblyData !== '') {
    const [italic, ...parts] = assemblyData.split(';');
    assembly = {
      italic: n36(italic!),
      parts: parts.map((part) => {
        const [glyph, start, end, full, extender] = part.split(' ').map(n36) as [number, number, number, number, number];
        return { glyph: base + glyph, startConnector: start, endConnector: end, fullAdvance: full, extender: extender === 1 };
      }),
    };
  }
  return { variants, assembly };
}

type FieldColumn = 'KERNS' | 'VERTICAL' | 'HORIZONTAL' | 'DTLS' | 'SSTY';

/** A field column's values, decoded glyph by glyph as they are used. */
class Sparse<T> {
  private readonly values = new Map<number, T | undefined>();

  constructor(
    private readonly sets: readonly GlyphSet[],
    private readonly column: FieldColumn,
    private readonly decode: (id: number, value: string) => T,
  ) {}

  get(id: number): T | undefined {
    let value = this.values.get(id);
    if (value !== undefined || this.values.has(id)) return value;
    for (const set of this.sets) {
      const index = runIndex(set.glyphs, id);
      if (index < 0) continue;
      const field = set.field(this.column, index);
      if (field !== '') value = this.decode(id, field);
      this.values.set(id, value);
      break;
    }
    return value;
  }
}

/** A set of glyphs' data, and what is decoded of it. */
class GlyphSet {
  readonly glyphs: Runs;
  /** Where the steps of each field column start, as far as they are known. */
  readonly #steps = new Map<FieldColumn, number[]>();
  #extended?: Runs;
  #unmapped?: Runs;
  #ignorable?: Runs;
  #chars?: { readonly chars: Int32Array; readonly lengths: Int32Array; readonly glyphs: Int32Array };

  constructor(readonly data: MetricsData) {
    this.glyphs = decodeRuns(data.GLYPHS);
  }

  /** The field of the glyph at `index` in a field column. */
  field(column: FieldColumn, index: number): string {
    let steps = this.#steps.get(column);
    if (!steps) this.#steps.set(column, (steps = [0]));
    return readField(this.data[column], steps, index);
  }

  isExtendedShape(id: number): boolean {
    return runIndex((this.#extended ??= decodeRuns(this.data.EXTENDED)), id) >= 0;
  }

  /** The glyphs of the set that no character maps to: they are drawn with private-use code points. */
  get unmapped(): Runs {
    return (this.#unmapped ??= decodeRuns(this.data.UNMAPPED));
  }

  isIgnorable(cp: number): boolean {
    return runIndex((this.#ignorable ??= decodeRuns(this.data.IGNORABLE)), cp) >= 0;
  }

  /** The character map's runs: the first character and glyph of each, and its length. */
  get chars(): { readonly chars: Int32Array; readonly lengths: Int32Array; readonly glyphs: Int32Array } {
    if (this.#chars) return this.#chars;
    const numbers = readNumbers(this.data.CMAP);
    const count = numbers.length / 3;
    const chars = new Int32Array(count);
    const lengths = new Int32Array(count);
    const glyphs = new Int32Array(count);
    let cp = 0;
    let first = 0;
    for (let k = 0; k < count; k++) {
      cp += numbers[3 * k]!;
      first += numbers[3 * k + 2]!;
      chars[k] = cp;
      lengths[k] = numbers[3 * k + 1]!;
      glyphs[k] = first;
      cp += lengths[k]!;
    }
    return (this.#chars = { chars, lengths, glyphs });
  }

  /** The glyph the character maps to, or -1. */
  glyphOf(cp: number): number {
    const { chars, lengths, glyphs } = this.chars;
    const k = lastAtMost(chars, cp);
    return k >= 0 && cp < chars[k]! + lengths[k]! ? glyphs[k]! + cp - chars[k]! : -1;
  }

  /** The smallest character that maps to the glyph, or -1. The runs are in the characters' order. */
  firstChar(id: number): number {
    const { chars, lengths, glyphs } = this.chars;
    for (let k = 0; k < chars.length; k++) {
      if (id >= glyphs[k]! && id < glyphs[k]! + lengths[k]!) return chars[k]! + id - glyphs[k]!;
    }
    return -1;
  }

}

/**
 * The metrics of a face, read glyph by glyph as glyphs are used. Dense arrays
 * are indexed by glyph id.
 */
class Tables {
  readonly flags: Uint8Array;
  readonly advances: Uint16Array;
  readonly xMin: Int16Array;
  readonly yMin: Int16Array;
  readonly xMax: Int16Array;
  readonly yMax: Int16Array;
  readonly italics: Int16Array;
  readonly accents: Int16Array;
  /** The code points glyphs are drawn with, found on first use; 0 before. */
  readonly codePoints: Int32Array;
  readonly sets: GlyphSet[] = [];
  readonly kerns = new Sparse(this.sets, 'KERNS', (_, value) => decodeKerns(value));
  readonly vertical = new Sparse(this.sets, 'VERTICAL', decodeConstruction);
  readonly horizontal = new Sparse(this.sets, 'HORIZONTAL', decodeConstruction);
  readonly dtls = new Sparse(this.sets, 'DTLS', (id, value) => id + n36(value));
  /** The glyphs `ssty` substitutes at script levels 1 and 2. */
  readonly ssty = new Sparse(this.sets, 'SSTY', (id, value) => value.split(' ').map((delta) => (delta === '' ? undefined : id + n36(delta))));
  #sequences = new Map<string, number>();
  #sequenceSets = 0;

  constructor(glyphCount: number, data: MetricsData) {
    this.flags = new Uint8Array(glyphCount);
    this.advances = new Uint16Array(glyphCount);
    this.xMin = new Int16Array(glyphCount);
    this.yMin = new Int16Array(glyphCount);
    this.xMax = new Int16Array(glyphCount);
    this.yMax = new Int16Array(glyphCount);
    this.italics = new Int16Array(glyphCount);
    this.accents = new Int16Array(glyphCount);
    this.codePoints = new Int32Array(glyphCount);
    this.sets.push(new GlyphSet(data));
  }

  add(data: MetricsData): void {
    this.sets.push(new GlyphSet(data));
    // Glyphs no data had may be in the new data.
    for (let id = 0; id < this.flags.length; id++) if (this.flags[id] === KNOWN) this.flags[id] = 0;
  }

  /** The glyph's flags, reading its numbers first if need be. */
  flagsOf(id: number): number {
    const flags = this.flags[id];
    if (flags === undefined) return 0;
    if ((flags & KNOWN) !== 0) return flags;
    for (const set of this.sets) {
      const index = runIndex(set.glyphs, id);
      if (index >= 0) return this.read(set, index, id);
    }
    this.flags[id] = KNOWN;
    return KNOWN;
  }

  /** Reads the numbers of the glyph at `index` of a set, and returns its flags. */
  private read(set: GlyphSet, index: number, id: number): number {
    const { data } = set;
    const mins = data.MINS;
    let flags = KNOWN | PRESENT;
    const advance = readNumber(data.ADVANCES, index, mins[0]!);
    this.advances[id] = advance;
    const xMin = readNumber(data.X_MIN, index, mins[1]!);
    if (!Number.isNaN(xMin)) {
      flags |= HAS_BBOX;
      this.xMin[id] = xMin;
      this.yMin[id] = readNumber(data.Y_MIN, index, mins[2]!);
      this.xMax[id] = advance + readNumber(data.X_MAX, index, mins[3]!);
      this.yMax[id] = readNumber(data.Y_MAX, index, mins[4]!);
    }
    const italic = readNumber(data.ITALICS, index, mins[5]!);
    if (!Number.isNaN(italic)) {
      flags |= HAS_ITALIC;
      this.italics[id] = italic;
    }
    const accent = readNumber(data.ACCENTS, index, mins[6]!);
    if (!Number.isNaN(accent)) {
      flags |= HAS_ACCENT;
      this.accents[id] = accent;
    }
    if (set.isExtendedShape(id)) flags |= EXTENDED_SHAPE;
    this.flags[id] = flags;
    return flags;
  }

  /** The glyph a character maps to: in the data added last that maps it. */
  glyphOf(cp: number): number | undefined {
    for (let s = this.sets.length - 1; s >= 0; s--) {
      const glyph = this.sets[s]!.glyphOf(cp);
      if (glyph >= 0) return glyph;
    }
    return undefined;
  }

  isIgnorable(cp: number): boolean {
    return this.sets.some((set) => set.isIgnorable(cp));
  }

  get sequences(): Map<string, number> {
    for (; this.#sequenceSets < this.sets.length; this.#sequenceSets++) {
      const numbers = readNumbers(this.sets[this.#sequenceSets]!.data.SEQUENCES);
      for (let k = 0; k < numbers.length; k += 3) {
        this.#sequences.set(String.fromCodePoint(numbers[k]!, numbers[k + 1]!), numbers[k + 2]!);
      }
    }
    return this.#sequences;
  }

  /**
   * The code point the glyph is drawn with: the smallest character that maps
   * to it, or else a private-use code point. Those are given in the order of
   * the glyphs without characters, set after set, as the font files have them.
   */
  codePoint(id: number): number | undefined {
    if ((this.flagsOf(id) & PRESENT) === 0) return undefined;
    if (this.codePoints[id] !== 0) return this.codePoints[id];
    let base = FIRST_PRIVATE_USE;
    for (const set of this.sets) {
      const index = runIndex(set.unmapped, id);
      if (index >= 0) return (this.codePoints[id] = base + index);
      if (runIndex(set.glyphs, id) >= 0) return (this.codePoints[id] = set.firstChar(id));
      base += set.unmapped.count;
    }
    return undefined;
  }
}

let tables: Tables | null = null;
let boldTables: Tables | null = null;
let extended: MetricsData | null = null;

function get(face: FontFace = 'book'): Tables {
  if (face === 'bold') return (boldTables ??= new Tables(BOLD_FONT.glyphCount, BOLD));
  if (!tables) {
    tables = new Tables(FONT.glyphCount, CORE);
    if (extended) tables.add(extended);
  }
  return tables;
}

/**
 * Adds the metrics of the glyphs that only rarer characters reach, from
 * src/generated/metrics-extended.ts.
 */
export function registerExtendedMetrics(data: MetricsData): void {
  if (extended) return;
  extended = data;
  tables?.add(data);
}

/** Whether Typlet has the glyph's metrics. */
export function hasGlyph(id: number, face: FontFace = 'book'): boolean {
  return (get(face).flagsOf(id) & PRESENT) !== 0;
}

/** The glyph's horizontal advance, from `hmtx`. */
export function advance(id: number, face: FontFace = 'book'): number {
  const t = get(face);
  t.flagsOf(id);
  return t.advances[id]!;
}

/** The glyph's bounding box, or `null` for glyphs without an outline. */
export function boundingBox(id: number, face: FontFace = 'book'): Rect | null {
  const t = get(face);
  if ((t.flagsOf(id) & HAS_BBOX) === 0) return null;
  return { xMin: t.xMin[id]!, yMin: t.yMin[id]!, xMax: t.xMax[id]!, yMax: t.yMax[id]! };
}

/** The glyph's italic correction from the MATH table, if it has one. */
export function italicCorrection(id: number, face: FontFace = 'book'): number | undefined {
  const t = get(face);
  return (t.flagsOf(id) & HAS_ITALIC) !== 0 ? t.italics[id] : undefined;
}

/** The glyph's top accent attachment from the MATH table, if it has one. */
export function topAccentAttachment(id: number, face: FontFace = 'book'): number | undefined {
  const t = get(face);
  return (t.flagsOf(id) & HAS_ACCENT) !== 0 ? t.accents[id] : undefined;
}

/** Whether the MATH table marks the glyph as an extended shape. */
export function isExtendedShape(id: number, face: FontFace = 'book'): boolean {
  return (get(face).flagsOf(id) & EXTENDED_SHAPE) !== 0;
}

/** The glyph's MATH kern tables, if it has any. */
export function kernInfo(id: number, face: FontFace = 'book'): KernInfo | undefined {
  return get(face).kerns.get(id);
}

/** The glyph's size variants and assembly along an axis, if it has them. */
export function glyphConstruction(id: number, axis: Axis, face: FontFace = 'book'): GlyphConstruction | undefined {
  const t = get(face);
  return (axis === 'vertical' ? t.vertical : t.horizontal).get(id);
}

/** The glyph a character, or a character with a variation selector, maps to. */
export function glyphIndex(text: string, face: FontFace = 'book'): number | undefined {
  const t = get(face);
  const length = [...text].length;
  if (length === 1) return t.glyphOf(text.codePointAt(0)!);
  return length === 2 ? t.sequences.get(text) : undefined;
}

const isVariationSelector = (cp: number): boolean => cp >= 0xfe00 && cp <= 0xfe0f;

/**
 * Shapes a grapheme cluster as Typst's math shaping does in this font: each
 * character, or character with a variation selector, maps to its glyph;
 * a base and combining marks compose where the font has the composition;
 * default-ignorable characters disappear; then `dtls` and `ssty` substitute
 * glyphs. The advances are the glyphs' own. `null` if the font doesn't map a
 * character.
 */
export function shapeMath(text: string, ssty: 0 | 1 | 2, dtls: boolean, face: FontFace = 'book'): number[] | null {
  const t = get(face);
  const out: number[] = [];
  const cps = [...text].map((c) => c.codePointAt(0)!);
  for (let i = 0; i < cps.length; i++) {
    let cp = cps[i]!;
    // A base and the combining marks after it become their composition when
    // the font has a glyph for it, as HarfBuzz composes them: `e` and U+0301
    // become `é`. Other marks stay glyphs of their own.
    while (i + 1 < cps.length && isMark(cps[i + 1]!) && !isVariationSelector(cps[i + 1]!)) {
      const composed = String.fromCodePoint(cp, cps[i + 1]!).normalize('NFC');
      const c = composed.codePointAt(0)!;
      if (composed.length !== String.fromCodePoint(c).length || t.glyphOf(c) === undefined) break;
      cp = c;
      i++;
    }
    let glyph: number | undefined;
    const next = cps[i + 1];
    if (next !== undefined && next >= 0xfe00 && next <= 0xfe0f) {
      glyph = t.sequences.get(String.fromCodePoint(cp, next));
      if (glyph !== undefined) i++;
    }
    if (glyph === undefined) {
      if (t.isIgnorable(cp) || (cp >= 0xfe00 && cp <= 0xfe0f)) continue;
      glyph = t.glyphOf(cp);
      if (glyph === undefined) return null;
    }
    if (dtls) glyph = t.dtls.get(glyph) ?? glyph;
    if (ssty > 0) glyph = t.ssty.get(glyph)?.[ssty - 1] ?? glyph;
    out.push(glyph);
  }
  return out;
}

/** The code point Typlet draws the glyph with: its own, or a private-use one. */
export function drawingCodePoint(id: number, face: FontFace = 'book'): number | undefined {
  return get(face).codePoint(id);
}
