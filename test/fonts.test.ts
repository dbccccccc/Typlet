import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA as EXTENDED } from '../src/generated/metrics-extended.js';
import { drawingCodePoint, hasGlyph, registerExtendedMetrics } from '../src/layout/font.js';
import { renderToString } from '../src/mathml.js';
import { readFont, reachableGlyphs, supportedTexts } from '../tools/lib/math-font.mjs';
import { corpusDir, fixtureDir, readJsonl, root, type Formula } from './helpers.js';

registerExtendedMetrics(EXTENDED);

interface ManifestFile {
  file: string;
  weight?: 'bold';
  bytes: number;
  unicodeRange: string;
}

const fontsDir = join(root, 'fonts');
const manifest = JSON.parse(readFileSync(join(fontsDir, 'manifest.json'), 'utf8')) as { files: ManifestFile[] };
const css = readFileSync(join(fontsDir, 'typlet.css'), 'utf8');

/** A CSS unicode-range as inclusive ranges. */
const parseRange = (range: string) =>
  range.split(', ').map((r) => {
    const [first, last] = r.slice(2).split('-') as [string, string | undefined];
    return [parseInt(first, 16), parseInt(last ?? first, 16)] as const;
  });
const files = manifest.files.map((f) => ({ ...f, ranges: parseRange(f.unicodeRange) }));
const covers = (f: (typeof files)[number], cp: number) => f.ranges.some(([a, b]) => cp >= a && cp <= b);

/**
 * The file a browser draws a code point from, in normal or bold weight.
 * Where ranges overlap, the face defined last wins; typlet.css defines the
 * faces in reverse, so the first file in the manifest wins.
 */
const fileOf = (cp: number, weight?: 'bold') => files.find((f) => f.weight === weight && covers(f, cp));

describe('fonts', () => {
  it('lists every file with its size, and typlet.css loads each with its range', () => {
    for (const f of files) {
      expect(statSync(join(fontsDir, f.file)).size, f.file).toBe(f.bytes);
      const face = new RegExp(`src: url\\(${f.file.replaceAll('.', '\\.')}\\) format\\("woff2"\\);\\s+font-display: block;\\s+unicode-range: ([^;]+);`);
      expect(face.exec(css.replace(/\n  font-weight: bold;/g, ''))?.[1], f.file).toBe(f.unicodeRange);
      expect(css.includes(`url(${f.file}) format("woff2");\n  font-weight: bold;`), f.file).toBe(f.weight === 'bold');
    }
    expect(css.match(/@font-face/g)).toHaveLength(files.length);
  });

  it('draws every glyph from one file', () => {
    const font = readFont(readJsonl(`${fixtureDir}/font.jsonl`));
    const ambiguous: string[] = [];
    for (const id of reachableGlyphs(font, supportedTexts(font))) {
      const cp = drawingCodePoint(id)!;
      // Variation selectors are shared by the faces with variation sequences.
      if (cp >= 0xfe00 && cp <= 0xfe0f) continue;
      const owners = files.filter((f) => !f.weight && covers(f, cp)).map((f) => f.file);
      if (owners.length !== 1) ambiguous.push(`${id} U+${cp.toString(16)}: ${owners.join(', ') || 'none'}`);
    }
    expect(ambiguous).toEqual([]);
  });

  // The 74 formulas of the benchmark page that both Typst and KaTeX render
  // (test/corpus/web-page.json). KaTeX loads 200 KB of fonts for them.
  const ids = new Set<string>(
    JSON.parse(readFileSync(join(corpusDir, 'web-page.json'), 'utf8')).ids,
  );
  const page = readJsonl<Formula>(`${corpusDir}/paired.jsonl`).filter((f) => ids.has(f.id));
  type FrameGlyph = [font: number, id: number, x: number, y: number, size: number, text: string];
  const frames = new Map(
    readJsonl<{ id: string; frame: { fonts: string[]; glyphs: FrameGlyph[] } }>(`${fixtureDir}/paired.jsonl`).map(
      (r) => [r.id, r.frame],
    ),
  );
  const loaded = (cps: Iterable<number>, boldCps: Iterable<number> = []) => {
    const used = new Set<ManifestFile>();
    for (const cp of cps) {
      const f = fileOf(cp);
      if (f) used.add(f);
    }
    for (const cp of boldCps) used.add(fileOf(cp, 'bold')!);
    return [...used].reduce((sum, f) => sum + f.bytes, 0);
  };

  it('loads at most 250 KB for the 74-formula page in MathML', () => {
    expect(page).toHaveLength(74);
    const cps = new Set<number>();
    for (const f of page) {
      const mathml = renderToString(f.src, { displayMode: f.display, strict: 'ignore', throwOnError: false });
      const text = mathml.replace(/<annotation[\s\S]*?<\/annotation>/, '').replace(/<[^>]+>/g, '');
      for (const c of text) cps.add(c.codePointAt(0)!);
    }
    expect(loaded(cps)).toBeLessThanOrEqual(250 * 1024);
  });

  it('loads at most 250 KB for the 74-formula page drawn as Typst lays it out', () => {
    const cps = new Set<number>();
    const boldCps = new Set<number>();
    for (const f of page) {
      const frame = frames.get(f.id)!;
      for (const [font, id, , , , text] of frame.glyphs) {
        // Strong text is set in the Bold font, drawn from its characters.
        if (frame.fonts[font] === 'NewCMMath-Bold') {
          for (const c of text) boldCps.add(c.codePointAt(0)!);
          continue;
        }
        expect(frame.fonts[font]).toBe('NewCMMath-Book');
        expect(hasGlyph(id), `glyph ${id}`).toBe(true);
        cps.add(drawingCodePoint(id)!);
      }
    }
    expect(loaded(cps, boldCps)).toBeLessThanOrEqual(250 * 1024);
  });
});
