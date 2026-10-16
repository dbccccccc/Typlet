import { describe, expect, it } from 'vitest';
import { type SourceDiagnostic, SourceError } from '../src/eval/diag.js';
import { renderToString } from '../src/index.js';
import { parseMath } from '../src/syntax/parser.js';
import { type Formula, corpusDir, fixtureDir, readJsonl } from './helpers.js';
import { type FlatFrame, type FrameFixture, frameDiff, layoutFlat } from './layout-helpers.js';

interface Fixture {
  id: string;
  frame?: FrameFixture | null;
}

/** Formulas whose frames differ from Typst's by design. */
const KNOWN_DIFFERENCES = new Set([
  // Typst draws rounded and partial borders as curves; Typlet keeps a box,
  // which its HTML draws with CSS.
  'levels/box-radius',
  'levels/box-side-stroke',
  // The oracle's frame has the preamble's text too.
  'levels/preamble-text',
]);

describe.each(['paired', 'typst-docs', 'symbols', 'code', 'features', 'levels'])('layout of %s formulas', (name) => {
  const fixtures = new Map(readJsonl<Fixture>(`${fixtureDir}/${name}.jsonl`).map((r) => [r.id, r]));
  const formulas = readJsonl<Formula>(`${corpusDir}/${name}.jsonl`);

  it('matches Typst’s frames', () => {
    let compared = 0;
    const failures: string[] = [];
    for (const formula of formulas) {
      const want = fixtures.get(formula.id)?.frame;
      if (!want || parseMath(formula.src).erroneous() || KNOWN_DIFFERENCES.has(`${name}/${formula.id}`)) continue;
      let got: FlatFrame;
      try {
        got = layoutFlat(formula);
      } catch (e) {
        if (e instanceof SourceError && e.diagnostics.some((d) => d.kind === 'unsupported')) continue;
        failures.push(`${formula.id}: ${formula.src}\n  ${e instanceof Error ? e.message : e}`);
        compared++;
        continue;
      }
      compared++;
      const diff = frameDiff(got, want);
      if (diff) failures.push(`${formula.id}: ${formula.src}\n  ${diff}`);
    }
    expect(failures).toEqual([]);
    expect(compared).toBeGreaterThan(0);
  });
});

// Frames captured from the pinned Typst 0.15.1 oracle, including its line strokes.
describe('math line font metrics', () => {
  it.each([
    {
      formula: { id: '3-false', src: '#strong[$underline(mid(|))$] - cos & 2', display: false },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0.055, width: 39.007 }, fontSize: 11,
        fonts: ['NewCMMath-Bold', 'NewCMMath-Book'],
        glyphs: [[0, 93, 0, 0, 11, '|'], [1, 993, 6.565, 0, 11, '−'], [1, 68, 16.956, 0, 11, 'c'], [1, 80, 21.84, 0, 11, 'o'], [1, 84, 27.34, 0, 11, 's'], [1, 19, 33.507, 0, 11, '2']],
        shapes: [{ line: [0, 4.4, 3.509, 4.4], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: '3-true', src: '#strong[$underline(mid(|))$] - cos & 2', display: true },
      want: {
        box: { anchor: 'top', height: 13.42, width: 39.007 }, fontSize: 11,
        fonts: ['NewCMMath-Bold', 'NewCMMath-Book'],
        glyphs: [[0, 93, 0, 8.36, 11, '|'], [1, 993, 6.565, 8.36, 11, '−'], [1, 68, 16.956, 8.36, 11, 'c'], [1, 80, 21.84, 8.36, 11, 'o'], [1, 84, 27.34, 8.36, 11, 's'], [1, 19, 33.507, 8.36, 11, '2']],
        shapes: [{ line: [0, 12.76, 3.509, 12.76], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: '13-false', src: '#strong[$overline(mid(|))$] - cos & 2', display: false },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0, width: 39.007 }, fontSize: 11,
        fonts: ['NewCMMath-Bold', 'NewCMMath-Book'],
        glyphs: [[0, 93, 0, 0, 11, '|'], [1, 993, 6.565, 0, 11, '−'], [1, 68, 16.956, 0, 11, 'c'], [1, 80, 21.84, 0, 11, 'o'], [1, 84, 27.34, 0, 11, 's'], [1, 19, 33.507, 0, 11, '2']],
        shapes: [{ line: [0, -9.9, 3.509, -9.9], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: '13-true', src: '#strong[$overline(mid(|))$] - cos & 2', display: true },
      want: {
        box: { anchor: 'top', height: 13.42, width: 39.007 }, fontSize: 11,
        fonts: ['NewCMMath-Bold', 'NewCMMath-Book'],
        glyphs: [[0, 93, 0, 10.56, 11, '|'], [1, 993, 6.565, 10.56, 11, '−'], [1, 68, 16.956, 10.56, 11, 'c'], [1, 80, 21.84, 10.56, 11, 'o'], [1, 84, 27.34, 10.56, 11, 's'], [1, 19, 33.507, 10.56, 11, '2']],
        shapes: [{ line: [0, 0.66, 3.509, 0.66], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: 'line-0-false', src: 'underline(|)', display: false },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0.121, width: 3.058 }, fontSize: 11,
        fonts: ['NewCMMath-Book'],
        glyphs: [[0, 93, 0, 0, 11, '|']],
        shapes: [{ line: [0, 4.334, 3.058, 4.334], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-1-false', src: 'overline(|)', display: false },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0, width: 3.058 }, fontSize: 11,
        fonts: ['NewCMMath-Book'],
        glyphs: [[0, 93, 0, 0, 11, '|']],
        shapes: [{ line: [0, -9.834, 3.058, -9.834], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-2-false', src: '#strong[$underline(|)$]', display: false },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0.055, width: 3.509 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 93, 0, 0, 11, '|']],
        shapes: [{ line: [0, 4.4, 3.509, 4.4], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: 'line-3-false', src: '#strong[$overline(|)$]', display: false },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0, width: 3.509 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 93, 0, 0, 11, '|']],
        shapes: [{ line: [0, -9.9, 3.509, -9.9], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: 'line-4-false', src: '#strong[$underline(1)$]', display: false },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0, width: 6.325 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 18, 0, 0, 11, '1']],
        shapes: [{ line: [0, 1.584, 6.325, 1.584], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-5-false', src: '#strong[$overline(1)$]', display: false },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0, width: 6.325 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 18, 0, 0, 11, '1']],
        shapes: [{ line: [0, -8.789, 6.325, -8.789], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-6-false', src: '#strong[$underline("ab")$]', display: false },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0, width: 13.178 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 66, 0, 0, 11, 'a'], [0, 67, 6.149, 0, 11, 'b']],
        shapes: [{ line: [0, 1.65, 13.178, 1.65], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-7-false', src: '#strong[$overline("ab")$]', display: false },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0, width: 13.178 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 66, 0, 0, 11, 'a'], [0, 67, 6.149, 0, 11, 'b']],
        shapes: [{ line: [0, -9.218, 13.178, -9.218], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-8-false', src: '#strong[$underline(| |)$]', display: false },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0.231, width: 10.67 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 93, 0, 0, 11, '|'], [0, 93, 7.161, 0, 11, '|']],
        shapes: [{ line: [0, 4.444, 10.67, 4.444], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-9-false', src: '#strong[$overline(| |)$]', display: false },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0, width: 10.67 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 93, 0, 0, 11, '|'], [0, 93, 7.161, 0, 11, '|']],
        shapes: [{ line: [0, -9.944, 10.67, -9.944], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-10-false', src: '#strong[$underline(overline(|))$]', display: false },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0.231, width: 3.509 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 93, 0, 0, 11, '|']],
        shapes: [{ line: [0, -9.9, 3.509, -9.9], stroke: ['#000000', 0.44] }, { line: [0, 4.444, 3.509, 4.444], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-11-false', src: '#strong[$overline(underline(|))$]', display: false },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0.055, width: 3.509 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 93, 0, 0, 11, '|']],
        shapes: [{ line: [0, 4.4, 3.509, 4.4], stroke: ['#000000', 0.44] }, { line: [0, -9.944, 3.509, -9.944], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'outer-weight-0-false', src: 'underline(1)', display: false, preamble: '#set text(weight: "bold")' },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0, width: 5.5 }, fontSize: 11,
        fonts: ['NewCMMath-Book'],
        glyphs: [[0, 18, 0, 0, 11, '1']],
        shapes: [{ line: [0, 1.584, 5.5, 1.584], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'outer-weight-1-false', src: 'overline("ab")', display: false, preamble: '#set text(weight: "bold")' },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0, width: 11.616 }, fontSize: 11,
        fonts: ['NewCMMath-Book'],
        glyphs: [[0, 66, 0, 0, 11, 'a'], [0, 67, 5.5, 0, 11, 'b']],
        shapes: [{ line: [0, -9.218, 11.616, -9.218], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'outer-weight-2-false', src: 'underline(| |)', display: false, preamble: '#set text(weight: "bold")' },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0.121, width: 9.768 }, fontSize: 11,
        fonts: ['NewCMMath-Book'],
        glyphs: [[0, 93, 0, 0, 11, '|'], [0, 93, 6.71, 0, 11, '|']],
        shapes: [{ line: [0, 4.334, 9.768, 4.334], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'outer-weight-3-false', src: 'overline(underline(|))', display: false, preamble: '#set text(weight: "bold")' },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0.121, width: 3.058 }, fontSize: 11,
        fonts: ['NewCMMath-Book'],
        glyphs: [[0, 93, 0, 0, 11, '|']],
        shapes: [{ line: [0, 4.334, 3.058, 4.334], stroke: ['#000000', 0.528] }, { line: [0, -9.834, 3.058, -9.834], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'outer-weight-4-false', src: 'underline(#h(1em))', display: false, preamble: '#set text(weight: "bold")' },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0, width: 11 }, fontSize: 11,
        fonts: [],
        glyphs: [],
        shapes: [{ line: [0, 1.584, 11, 1.584], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'outer-weight-5-false', src: 'overline(#h(1em))', display: false, preamble: '#set text(weight: "bold")' },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0, width: 11 }, fontSize: 11,
        fonts: [],
        glyphs: [],
        shapes: [{ line: [0, -1.584, 11, -1.584], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-0-true', src: 'underline(|)', display: true },
      want: {
        box: { anchor: 'top', height: 13.376, width: 3.058 }, fontSize: 11,
        fonts: ['NewCMMath-Book'],
        glyphs: [[0, 93, 0, 8.25, 11, '|']],
        shapes: [{ line: [0, 12.584, 3.058, 12.584], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-1-true', src: 'overline(|)', display: true },
      want: {
        box: { anchor: 'top', height: 13.376, width: 3.058 }, fontSize: 11,
        fonts: ['NewCMMath-Book'],
        glyphs: [[0, 93, 0, 10.626, 11, '|']],
        shapes: [{ line: [0, 0.792, 3.058, 0.792], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-2-true', src: '#strong[$underline(|)$]', display: true },
      want: {
        box: { anchor: 'top', height: 13.42, width: 3.509 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 93, 0, 8.36, 11, '|']],
        shapes: [{ line: [0, 12.76, 3.509, 12.76], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: 'line-3-true', src: '#strong[$overline(|)$]', display: true },
      want: {
        box: { anchor: 'top', height: 13.42, width: 3.509 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 93, 0, 10.56, 11, '|']],
        shapes: [{ line: [0, 0.66, 3.509, 0.66], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: 'line-4-true', src: '#strong[$underline(1)$]', display: true },
      want: {
        box: { anchor: 'top', height: 9.581, width: 6.325 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 18, 0, 7.205, 11, '1']],
        shapes: [{ line: [0, 8.789, 6.325, 8.789], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-5-true', src: '#strong[$overline(1)$]', display: true },
      want: {
        box: { anchor: 'top', height: 9.581, width: 6.325 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 18, 0, 9.581, 11, '1']],
        shapes: [{ line: [0, 0.792, 6.325, 0.792], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-6-true', src: '#strong[$underline("ab")$]', display: true },
      want: {
        box: { anchor: 'top', height: 10.076, width: 13.178 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 66, 0, 7.634, 11, 'a'], [0, 67, 6.149, 7.634, 11, 'b']],
        shapes: [{ line: [0, 9.284, 13.178, 9.284], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-7-true', src: '#strong[$overline("ab")$]', display: true },
      want: {
        box: { anchor: 'top', height: 10.076, width: 13.178 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 66, 0, 10.01, 11, 'a'], [0, 67, 6.149, 10.01, 11, 'b']],
        shapes: [{ line: [0, 0.792, 13.178, 0.792], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-8-true', src: '#strong[$underline(| |)$]', display: true },
      want: {
        box: { anchor: 'top', height: 13.596, width: 10.67 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 93, 0, 8.36, 11, '|'], [0, 93, 7.161, 8.36, 11, '|']],
        shapes: [{ line: [0, 12.804, 10.67, 12.804], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-9-true', src: '#strong[$overline(| |)$]', display: true },
      want: {
        box: { anchor: 'top', height: 13.596, width: 10.67 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 93, 0, 10.736, 11, '|'], [0, 93, 7.161, 10.736, 11, '|']],
        shapes: [{ line: [0, 0.792, 10.67, 0.792], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-10-true', src: '#strong[$underline(overline(|))$]', display: true },
      want: {
        box: { anchor: 'top', height: 15.796, width: 3.509 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 93, 0, 10.56, 11, '|']],
        shapes: [{ line: [0, 0.66, 3.509, 0.66], stroke: ['#000000', 0.44] }, { line: [0, 15.004, 3.509, 15.004], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'line-11-true', src: '#strong[$overline(underline(|))$]', display: true },
      want: {
        box: { anchor: 'top', height: 15.796, width: 3.509 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 93, 0, 10.736, 11, '|']],
        shapes: [{ line: [0, 15.136, 3.509, 15.136], stroke: ['#000000', 0.44] }, { line: [0, 0.792, 3.509, 0.792], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'outer-weight-0-true', src: 'underline(1)', display: true, preamble: '#set text(weight: "bold")' },
      want: {
        box: { anchor: 'top', height: 9.702, width: 5.5 }, fontSize: 11,
        fonts: ['NewCMMath-Book'],
        glyphs: [[0, 18, 0, 7.326, 11, '1']],
        shapes: [{ line: [0, 8.91, 5.5, 8.91], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'outer-weight-1-true', src: 'overline("ab")', display: true, preamble: '#set text(weight: "bold")' },
      want: {
        box: { anchor: 'top', height: 10.131, width: 11.616 }, fontSize: 11,
        fonts: ['NewCMMath-Book'],
        glyphs: [[0, 66, 0, 10.01, 11, 'a'], [0, 67, 5.5, 10.01, 11, 'b']],
        shapes: [{ line: [0, 0.792, 11.616, 0.792], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'outer-weight-2-true', src: 'underline(| |)', display: true, preamble: '#set text(weight: "bold")' },
      want: {
        box: { anchor: 'top', height: 13.376, width: 9.768 }, fontSize: 11,
        fonts: ['NewCMMath-Book'],
        glyphs: [[0, 93, 0, 8.25, 11, '|'], [0, 93, 6.71, 8.25, 11, '|']],
        shapes: [{ line: [0, 12.584, 9.768, 12.584], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'outer-weight-3-true', src: 'overline(underline(|))', display: true, preamble: '#set text(weight: "bold")' },
      want: {
        box: { anchor: 'top', height: 15.752, width: 3.058 }, fontSize: 11,
        fonts: ['NewCMMath-Book'],
        glyphs: [[0, 93, 0, 10.626, 11, '|']],
        shapes: [{ line: [0, 14.96, 3.058, 14.96], stroke: ['#000000', 0.528] }, { line: [0, 0.792, 3.058, 0.792], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'outer-weight-4-true', src: 'underline(#h(1em))', display: true, preamble: '#set text(weight: "bold")' },
      want: {
        box: { anchor: 'top', height: 2.376, width: 11 }, fontSize: 11,
        fonts: [],
        glyphs: [],
        shapes: [{ line: [0, 1.584, 11, 1.584], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'outer-weight-5-true', src: 'overline(#h(1em))', display: true, preamble: '#set text(weight: "bold")' },
      want: {
        box: { anchor: 'top', height: 2.376, width: 11 }, fontSize: 11,
        fonts: [],
        glyphs: [],
        shapes: [{ line: [0, 0.792, 11, 0.792], stroke: ['#000000', 0.528] }],
      },
    },
    {
      formula: { id: 'equation-bold-0-false', src: 'underline(1)', display: false, preamble: '#show math.equation: set text(weight: "bold")' },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0, width: 6.325 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 18, 0, 0, 11, '1']],
        shapes: [{ line: [0, 1.54, 6.325, 1.54], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: 'equation-bold-1-false', src: 'overline("ab")', display: false, preamble: '#show math.equation: set text(weight: "bold")' },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0, width: 13.178 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 66, 0, 0, 11, 'a'], [0, 67, 6.149, 0, 11, 'b']],
        shapes: [{ line: [0, -9.174, 13.178, -9.174], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: 'equation-bold-2-false', src: 'underline(| |)', display: false, preamble: '#show math.equation: set text(weight: "bold")' },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0.055, width: 10.67 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 93, 0, 0, 11, '|'], [0, 93, 7.161, 0, 11, '|']],
        shapes: [{ line: [0, 4.4, 10.67, 4.4], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: 'equation-bold-3-false', src: 'overline(underline(|))', display: false, preamble: '#show math.equation: set text(weight: "bold")' },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0.055, width: 3.509 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 93, 0, 0, 11, '|']],
        shapes: [{ line: [0, 4.4, 3.509, 4.4], stroke: ['#000000', 0.44] }, { line: [0, -9.9, 3.509, -9.9], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: 'equation-bold-4-false', src: 'underline(#h(1em))', display: false, preamble: '#show math.equation: set text(weight: "bold")' },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0, width: 11 }, fontSize: 11,
        fonts: [],
        glyphs: [],
        shapes: [{ line: [0, 1.54, 11, 1.54], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: 'equation-bold-5-false', src: 'overline(#h(1em))', display: false, preamble: '#show math.equation: set text(weight: "bold")' },
      want: {
        box: { anchor: 'baseline', ascent: 7.513, descent: 0, width: 11 }, fontSize: 11,
        fonts: [],
        glyphs: [],
        shapes: [{ line: [0, -1.54, 11, -1.54], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: 'equation-bold-0-true', src: 'underline(1)', display: true, preamble: '#show math.equation: set text(weight: "bold")' },
      want: {
        box: { anchor: 'top', height: 9.405, width: 6.325 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 18, 0, 7.205, 11, '1']],
        shapes: [{ line: [0, 8.745, 6.325, 8.745], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: 'equation-bold-1-true', src: 'overline("ab")', display: true, preamble: '#show math.equation: set text(weight: "bold")' },
      want: {
        box: { anchor: 'top', height: 9.9, width: 13.178 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 66, 0, 9.834, 11, 'a'], [0, 67, 6.149, 9.834, 11, 'b']],
        shapes: [{ line: [0, 0.66, 13.178, 0.66], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: 'equation-bold-2-true', src: 'underline(| |)', display: true, preamble: '#show math.equation: set text(weight: "bold")' },
      want: {
        box: { anchor: 'top', height: 13.42, width: 10.67 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 93, 0, 8.36, 11, '|'], [0, 93, 7.161, 8.36, 11, '|']],
        shapes: [{ line: [0, 12.76, 10.67, 12.76], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: 'equation-bold-3-true', src: 'overline(underline(|))', display: true, preamble: '#show math.equation: set text(weight: "bold")' },
      want: {
        box: { anchor: 'top', height: 15.62, width: 3.509 }, fontSize: 11,
        fonts: ['NewCMMath-Bold'],
        glyphs: [[0, 93, 0, 10.56, 11, '|']],
        shapes: [{ line: [0, 14.96, 3.509, 14.96], stroke: ['#000000', 0.44] }, { line: [0, 0.66, 3.509, 0.66], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: 'equation-bold-4-true', src: 'underline(#h(1em))', display: true, preamble: '#show math.equation: set text(weight: "bold")' },
      want: {
        box: { anchor: 'top', height: 2.2, width: 11 }, fontSize: 11,
        fonts: [],
        glyphs: [],
        shapes: [{ line: [0, 1.54, 11, 1.54], stroke: ['#000000', 0.44] }],
      },
    },
    {
      formula: { id: 'equation-bold-5-true', src: 'overline(#h(1em))', display: true, preamble: '#show math.equation: set text(weight: "bold")' },
      want: {
        box: { anchor: 'top', height: 2.2, width: 11 }, fontSize: 11,
        fonts: [],
        glyphs: [],
        shapes: [{ line: [0, 0.66, 11, 0.66], stroke: ['#000000', 0.44] }],
      },
    },
  ] satisfies { formula: Formula; want: FrameFixture }[])('matches the oracle for $formula.id', ({ formula, want }) => {
    expect(frameDiff(layoutFlat(formula), want)).toBeNull();
  });

  it.each([false, true])('retains unsupported bold mathematical letters in display %s', (display) => {
    const formula = { id: 'unsupported-bold-line', src: '#strong[$underline(x)$] - cos & 2', display };
    try { layoutFlat(formula); }
    catch (error) {
      expect(error).toBeInstanceOf(SourceError);
      expect((error as SourceError).diagnostics[0]?.kind).toBe('unsupported');
      return;
    }
    throw new Error('expected the existing unsupported bold glyph boundary');
  });

  it.each([
    { formula: { id: 'font: "unknown-font" ', src: '', display: false, preamble: '#show math.equation: set text(font: "unknown-font")' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 0, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [] }, warnings: [{ severity: 'warning', span: { start: 36, end: 50, file: 'preamble' }, message: 'unknown font family: unknown-font', hints: [], trace: [] }] },
    { formula: { id: 'font: "unknown-font" quad', src: 'quad', display: false, preamble: '#show math.equation: set text(font: "unknown-font")' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 11, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [] }, warnings: [{ severity: 'warning', span: { start: 36, end: 50, file: 'preamble' }, message: 'unknown font family: unknown-font', hints: [], trace: [] }] },
    { formula: { id: 'font: "unknown-font" x', src: 'x', display: false, preamble: '#show math.equation: set text(font: "unknown-font")' }, kind: 'unsupported', message: 'Typlet does not support the font "unknown-font" in HTML output', warnings: [{ severity: 'warning', span: { start: 36, end: 50, file: 'preamble' }, message: 'unknown font family: unknown-font', hints: [], trace: [] }] },
    { formula: { id: 'weight: 400 ', src: '', display: false, preamble: '#show math.equation: set text(weight: 400)' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 0, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [] }, warnings: [] },
    { formula: { id: 'weight: 400 quad', src: 'quad', display: false, preamble: '#show math.equation: set text(weight: 400)' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 11, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [] }, warnings: [] },
    { formula: { id: 'weight: 400 x', src: 'x', display: false, preamble: '#show math.equation: set text(weight: 400)' }, kind: 'unsupported', message: 'Typlet does not support the font weight 400 in HTML output yet', warnings: [] },
    { formula: { id: 'stroke: red ', src: '', display: false, preamble: '#show math.equation: set text(stroke: red)' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 0, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [] }, warnings: [] },
    { formula: { id: 'stroke: red quad', src: 'quad', display: false, preamble: '#show math.equation: set text(stroke: red)' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 11, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [] }, warnings: [] },
    { formula: { id: 'stroke: red x', src: 'x', display: false, preamble: '#show math.equation: set text(stroke: red)' }, kind: 'unsupported', message: 'Typlet does not support text strokes in HTML output yet', warnings: [] },
    { formula: { id: 'features: ("ss01",) ', src: '', display: false, preamble: '#show math.equation: set text(features: ("ss01",))' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 0, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [] }, warnings: [] },
    { formula: { id: 'features: ("ss01",) quad', src: 'quad', display: false, preamble: '#show math.equation: set text(features: ("ss01",))' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 11, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [] }, warnings: [] },
    { formula: { id: 'features: ("ss01",) x', src: 'x', display: false, preamble: '#show math.equation: set text(features: ("ss01",))' }, kind: 'unsupported', message: 'Typlet does not support OpenType features in HTML output yet', warnings: [] },
    { formula: { id: 'font: "unknown-font" underline(#none)', src: 'underline(#none)', display: false, preamble: '#show math.equation: set text(font: "unknown-font")' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 0, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [{ line: [0, 1.584, 0, 1.584], stroke: ['#000000', 0.528] }] }, warnings: [{ severity: 'warning', span: { start: 36, end: 50, file: 'preamble' }, message: 'unknown font family: unknown-font', hints: [], trace: [] }] },
    { formula: { id: 'font: "unknown-font" overline(#none)', src: 'overline(#none)', display: false, preamble: '#show math.equation: set text(font: "unknown-font")' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 0, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [{ line: [0, -1.584, 0, -1.584], stroke: ['#000000', 0.528] }] }, warnings: [{ severity: 'warning', span: { start: 36, end: 50, file: 'preamble' }, message: 'unknown font family: unknown-font', hints: [], trace: [] }] },
    { formula: { id: 'font: "unknown-font" underline(#h(1em))', src: 'underline(#h(1em))', display: false, preamble: '#show math.equation: set text(font: "unknown-font")' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 11, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [{ line: [0, 1.584, 11, 1.584], stroke: ['#000000', 0.528] }] }, warnings: [{ severity: 'warning', span: { start: 36, end: 50, file: 'preamble' }, message: 'unknown font family: unknown-font', hints: [], trace: [] }] },
    { formula: { id: 'font: "unknown-font" overline(#h(1em))', src: 'overline(#h(1em))', display: false, preamble: '#show math.equation: set text(font: "unknown-font")' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 11, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [{ line: [0, -1.584, 11, -1.584], stroke: ['#000000', 0.528] }] }, warnings: [{ severity: 'warning', span: { start: 36, end: 50, file: 'preamble' }, message: 'unknown font family: unknown-font', hints: [], trace: [] }] },
    { formula: { id: 'weight: 400 underline(#none)', src: 'underline(#none)', display: false, preamble: '#show math.equation: set text(weight: 400)' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 0, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [{ line: [0, 1.584, 0, 1.584], stroke: ['#000000', 0.528] }] }, warnings: [] },
    { formula: { id: 'weight: 400 overline(#none)', src: 'overline(#none)', display: false, preamble: '#show math.equation: set text(weight: 400)' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 0, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [{ line: [0, -1.584, 0, -1.584], stroke: ['#000000', 0.528] }] }, warnings: [] },
    { formula: { id: 'weight: 400 underline(#h(1em))', src: 'underline(#h(1em))', display: false, preamble: '#show math.equation: set text(weight: 400)' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 11, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [{ line: [0, 1.584, 11, 1.584], stroke: ['#000000', 0.528] }] }, warnings: [] },
    { formula: { id: 'weight: 400 overline(#h(1em))', src: 'overline(#h(1em))', display: false, preamble: '#show math.equation: set text(weight: 400)' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 11, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [{ line: [0, -1.584, 11, -1.584], stroke: ['#000000', 0.528] }] }, warnings: [] },
    { formula: { id: 'stroke: red underline(#none)', src: 'underline(#none)', display: false, preamble: '#show math.equation: set text(stroke: red)' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 0, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [{ line: [0, 1.584, 0, 1.584], stroke: ['#000000', 0.528] }] }, warnings: [] },
    { formula: { id: 'stroke: red overline(#none)', src: 'overline(#none)', display: false, preamble: '#show math.equation: set text(stroke: red)' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 0, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [{ line: [0, -1.584, 0, -1.584], stroke: ['#000000', 0.528] }] }, warnings: [] },
    { formula: { id: 'stroke: red underline(#h(1em))', src: 'underline(#h(1em))', display: false, preamble: '#show math.equation: set text(stroke: red)' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 11, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [{ line: [0, 1.584, 11, 1.584], stroke: ['#000000', 0.528] }] }, warnings: [] },
    { formula: { id: 'stroke: red overline(#h(1em))', src: 'overline(#h(1em))', display: false, preamble: '#show math.equation: set text(stroke: red)' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 11, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [{ line: [0, -1.584, 11, -1.584], stroke: ['#000000', 0.528] }] }, warnings: [] },
    { formula: { id: 'features: ("ss01",) underline(#none)', src: 'underline(#none)', display: false, preamble: '#show math.equation: set text(features: ("ss01",))' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 0, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [{ line: [0, 1.584, 0, 1.584], stroke: ['#000000', 0.528] }] }, warnings: [] },
    { formula: { id: 'features: ("ss01",) overline(#none)', src: 'overline(#none)', display: false, preamble: '#show math.equation: set text(features: ("ss01",))' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 0, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [{ line: [0, -1.584, 0, -1.584], stroke: ['#000000', 0.528] }] }, warnings: [] },
    { formula: { id: 'features: ("ss01",) underline(#h(1em))', src: 'underline(#h(1em))', display: false, preamble: '#show math.equation: set text(features: ("ss01",))' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 11, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [{ line: [0, 1.584, 11, 1.584], stroke: ['#000000', 0.528] }] }, warnings: [] },
    { formula: { id: 'features: ("ss01",) overline(#h(1em))', src: 'overline(#h(1em))', display: false, preamble: '#show math.equation: set text(features: ("ss01",))' }, kind: 'success', frame: { box: { anchor: 'baseline', width: 11, ascent: 7.513, descent: 0 }, fonts: [], glyphs: [], shapes: [{ line: [0, -1.584, 11, -1.584], stroke: ['#000000', 0.528] }] }, warnings: [] },
  ] satisfies { formula: Formula; kind: string; frame?: FlatFrame; message?: string; warnings: SourceDiagnostic[] }[])('keeps lazy font validation for $formula.id', ({ formula, kind, ...expected }) => {
    const warnings: SourceDiagnostic[] = [];
    if (kind === 'success') {
      expect(layoutFlat(formula, warnings)).toEqual(expected.frame);
      expect(warnings).toEqual(expected.warnings);
      return;
    }
    try { layoutFlat(formula, warnings); }
    catch (error) {
      expect(warnings).toEqual(expected.warnings);
      expect(error).toBeInstanceOf(SourceError);
      expect((error as SourceError).diagnostics[0]?.kind).toBe(kind);
      expect((error as SourceError).diagnostics[0]?.message).toBe(expected.message);
      return;
    }
    throw new Error('expected the existing unsupported font boundary');
  });

  it('preserves MathML for the corrected bold line', () => {
    expect(renderToString('#strong[$underline(|)$]', { output: 'mathml', strict: 'ignore' })).toBe('<span class="typlet"><math><semantics><mrow><strong><math><munder accentunder="true"><mo lspace="0em" rspace="0em">|</mo><mo stretchy="true">_</mo></munder></math></strong></mrow><annotation encoding="application/x-typst">#strong[$underline(|)$]</annotation></semantics></math></span>');
  });
});
