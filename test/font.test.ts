import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { DATA as EXTENDED } from '../src/generated/metrics-extended.js';
import {
  FONT_METRICS,
  MATH_CONSTANTS,
  MIN_CONNECTOR_OVERLAP,
  UNITS_PER_EM,
  advance,
  boundingBox,
  drawingCodePoint,
  glyphConstruction,
  glyphIndex,
  hasGlyph,
  isExtendedShape,
  italicCorrection,
  kernInfo,
  registerExtendedMetrics,
  shapeMath,
  topAccentAttachment,
} from '../src/layout/font.js';
import {
  codexCharacters,
  drawingCodePoints,
  isCoreText,
  reachableGlyphs,
  readFont,
  supportedTexts,
} from '../tools/lib/math-font.mjs';
import { fixtureDir, readJsonl, root } from './helpers.js';

registerExtendedMetrics(EXTENDED);

type Corner = { heights: number[]; kerns: number[] };
interface GlyphRecord {
  id: number;
  advance?: number;
  bbox?: [number, number, number, number];
  italic?: number;
  accent?: number;
  extended?: boolean;
  kern?: Record<string, Corner>;
  vertical?: Construction;
  horizontal?: Construction;
}
interface Construction {
  variants: [number, number][];
  assembly: { italic: number; parts: [number, number, number, number, boolean][] } | null;
}

const records = readJsonl(`${fixtureDir}/font.jsonl`);
const font = readFont(records);
const texts: [string, number][] = supportedTexts(font);
const reachable: number[] = reachableGlyphs(font, texts);

/** A construction as the decoder gives it. */
const construction = (c: Construction | undefined) =>
  c && {
    variants: c.variants.map(([glyph, adv]) => ({ glyph, advance: adv })),
    assembly: c.assembly && {
      italic: c.assembly.italic,
      parts: c.assembly.parts.map(([glyph, startConnector, endConnector, fullAdvance, extender]) => ({
        glyph,
        startConnector,
        endConnector,
        fullAdvance,
        extender,
      })),
    },
  };

describe('math font metrics', () => {
  it('has Typst’s font metrics and math constants', () => {
    expect(UNITS_PER_EM).toBe(font.header.unitsPerEm);
    expect(MIN_CONNECTOR_OVERLAP).toBe(font.header.minConnectorOverlap);
    expect(FONT_METRICS).toEqual(font.header.metrics);
    expect(MATH_CONSTANTS).toEqual(font.header.math);
  });

  it('has exactly the glyphs Typst can reach from supported text', () => {
    const present = [...font.glyphs.keys()].filter((id) => hasGlyph(id));
    expect(present).toEqual(reachable);
  });

  it('reads every reachable glyph as Typst does', () => {
    const mismatches: string[] = [];
    for (const id of reachable) {
      const g = font.glyphs.get(id) as GlyphRecord;
      const want = {
        advance: g.advance ?? 0,
        bbox: g.bbox ? { xMin: g.bbox[0], yMin: g.bbox[1], xMax: g.bbox[2], yMax: g.bbox[3] } : null,
        italic: g.italic,
        accent: g.accent,
        extended: g.extended ?? false,
        kern: g.kern,
        vertical: construction(g.vertical),
        horizontal: construction(g.horizontal),
      };
      const got = {
        advance: advance(id),
        bbox: boundingBox(id),
        italic: italicCorrection(id),
        accent: topAccentAttachment(id),
        extended: isExtendedShape(id),
        kern: kernInfo(id),
        vertical: glyphConstruction(id, 'vertical'),
        horizontal: glyphConstruction(id, 'horizontal'),
      };
      if (!isDeepStrictEqual(got, want)) {
        mismatches.push(`${id}: want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`);
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it('maps every supported character and variation sequence', () => {
    const wrong = texts.filter(([text, glyph]) => glyphIndex(text) !== glyph);
    expect(wrong).toEqual([]);
  });

  it('shapes like Typst’s math shaping, with every feature set', () => {
    const mismatches: string[] = [];
    for (const [features, results] of font.shapes) {
      const ssty = Number(/ssty=(\d)/.exec(features)?.[1] ?? 0) as 0 | 1 | 2;
      const dtls = features.includes('dtls');
      for (const [text, glyph] of texts) {
        const shaped = results.get(text);
        const want = shaped ? shaped.map(([id]: number[]) => id) : [glyph];
        const got = shapeMath(text, ssty, dtls);
        if (JSON.stringify(got) !== JSON.stringify(want)) mismatches.push(`${features} ${text}: ${got} vs ${want}`);
        // Every glyph comes at its own advance, without offsets.
        for (const [id, xAdvance, ...offsets] of shaped ?? []) {
          if (xAdvance !== advance(id) || offsets.some((o: number) => o !== 0)) mismatches.push(`${text}: positioned`);
        }
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it('draws each glyph with its own code point or a private-use one', () => {
    const codex = codexCharacters(root);
    const core = texts.filter(([text]) => isCoreText(text, codex));
    const coreGlyphs: number[] = reachableGlyphs(font, core);
    const coreSet = new Set(coreGlyphs);
    const rest = reachable.filter((id) => !coreSet.has(id));
    const want = drawingCodePoints([
      [coreGlyphs, core],
      [rest, texts.filter(([text]) => !isCoreText(text, codex))],
    ]);
    const got = new Map(reachable.map((id) => [id, drawingCodePoint(id)]));
    expect(got).toEqual(want);
    expect(new Set(got.values()).size).toBe(reachable.length);
  });
});
