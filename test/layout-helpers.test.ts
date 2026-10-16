import { describe, expect, it } from 'vitest';
import { type Formula, corpusDir, fixtureDir, readJsonl } from './helpers.js';
import { type FlatFrame, type FrameFixture, frameDiff, layoutFlat } from './layout-helpers.js';

function frames() {
  const got: FlatFrame = {
    box: { anchor: 'baseline', width: 8, ascent: 7, descent: 1 },
    fonts: ['NewCMMath-Book'],
    glyphs: [[0, 100, 0, 0, 11, 'x']],
    shapes: [],
  };
  const want: FrameFixture = { ...structuredClone(got), fontSize: 11 };
  return { got, want };
}

function transform(frame: FlatFrame | FrameFixture, value: number[]) {
  frame.glyphs[0]![6] = '#000000';
  frame.glyphs[0]![7] = value;
}

describe('frameDiff glyph attributes', () => {
  it('reports a fill-only difference', () => {
    const { got, want } = frames();
    got.glyphs[0]![6] = '#ff0000';
    expect(frameDiff(got, want)).toBe('glyph 0: fill #ff0000 vs #000000');
  });

  it.each([0, 1, 2, 3])('reports a difference in transform coefficient %i', (coefficient) => {
    const { got, want } = frames();
    const matrix = [1, 0, 0, 1];
    matrix[coefficient]! += 0.01;
    transform(got, matrix);
    expect(frameDiff(got, want)).toContain(`glyph 0: transform[${coefficient}]`);
  });

  it('treats omitted and explicit black fill as equivalent in both directions', () => {
    const { got, want } = frames();
    got.glyphs[0]![6] = '#000000';
    expect(frameDiff(got, want)).toBeNull();
    expect(frameDiff(want as FlatFrame, { ...got, fontSize: 11 })).toBeNull();
  });

  it('treats omitted and explicit identity transforms as equivalent in both directions', () => {
    const { got, want } = frames();
    transform(got, [1, 0, 0, 1]);
    expect(frameDiff(got, want)).toBeNull();
    expect(frameDiff(want as FlatFrame, { ...got, fontSize: 11 })).toBeNull();
  });

  it('accepts a transform difference within the existing tolerance', () => {
    const { got, want } = frames();
    transform(got, [1.0014, 0, 0, 1]);
    expect(frameDiff(got, want)).toBeNull();
  });

  it('rejects a transform difference just outside the existing tolerance', () => {
    const { got, want } = frames();
    transform(got, [1.0016, 0, 0, 1]);
    expect(frameDiff(got, want)).toContain('glyph 0: transform[0]');
  });

  it('compares font names independently of their table indices', () => {
    const { got, want } = frames();
    got.fonts.unshift('NewCMMath-Bold');
    got.glyphs[0]![0] = 1;
    expect(frameDiff(got, want)).toBeNull();
  });

  it.each([{ matrix: [1, 0, 0] }, { matrix: [1, 0, 0, 1, 0] }])('rejects a malformed transform $matrix on either side', ({ matrix }) => {
    const { got, want } = frames();
    transform(got, matrix);
    expect(frameDiff(got, want)).toContain('glyph 0: transform');
    expect(frameDiff(want as FlatFrame, { ...got, fontSize: 11 })).toContain('glyph 0: transform');
  });

  it.each([NaN, Infinity, -Infinity])('rejects a non-finite transform coefficient %s on either side', (value) => {
    const { got, want } = frames();
    transform(got, [1, value, 0, 1]);
    expect(frameDiff(got, want)).toContain('glyph 0: transform[1]');
    expect(frameDiff(want as FlatFrame, { ...got, fontSize: 11 })).toContain('glyph 0: transform[1]');
  });

  it.each([
    [1, 101, 'glyph 0 (x): id 101 vs 100'],
    [2, 0.01, 'glyph 0 (x): at 0.01,0 vs 0,0'],
    [4, 12, 'glyph 0: size 12 vs 11'],
  ] as const)('retains diagnostics when field %i differs', (field, value, diagnostic) => {
    const { got, want } = frames();
    got.glyphs[0]![field] = value;
    expect(frameDiff(got, want)).toBe(diagnostic);
  });

  it('detects a fill mutation in a real colored corpus frame', () => {
    const formula = readJsonl<Formula>(`${corpusDir}/levels.jsonl`).find((entry) => entry.id === 'text-fill-math')!;
    const fixture = readJsonl<{ id: string; frame: FrameFixture }>(`${fixtureDir}/levels.jsonl`)
      .find((entry) => entry.id === formula.id)!.frame;
    const got = layoutFlat(formula);
    expect(frameDiff(got, fixture)).toBeNull();
    const changed = structuredClone(got);
    const index = changed.glyphs.findIndex((glyph) => typeof glyph[6] === 'string' && glyph[6] !== '#000000');
    expect(index).toBeGreaterThanOrEqual(0);
    changed.glyphs[index]![6] = '#00ff00';
    expect(frameDiff(changed, fixture)).toContain(`glyph ${index}: fill`);
  });
});
