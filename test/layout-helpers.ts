import { toHex } from '../src/eval/color.js';
import { type SourceDiagnostic, SourceError } from '../src/eval/diag.js';
import { evalCorpusFormula } from './eval-helpers.js';
import type { Formula } from './helpers.js';
import { absToPt } from '../src/eval/layout.js';
import { type Frame, type Placed, translate, walkFrame } from '../src/layout/frame.js';
import { layoutEquationBlock, layoutEquationInline } from '../src/layout/math.js';
import { parseMath } from '../src/syntax/parser.js';

/** A frame as the oracle flattens it (oracle/src/frame.rs), in points. */
export interface FlatFrame {
  box: { anchor: 'baseline'; width: number; ascent: number; descent: number } | { anchor: 'top'; width: number; height: number };
  fonts: string[];
  glyphs: (string | number | number[])[][];
  shapes: Record<string, unknown>[];
}

const FONT_NAMES = { book: 'NewCMMath-Book', bold: 'NewCMMath-Bold' } as const;
const round = (pt: number) => Math.round(pt * 1000) / 1000;

/** Flattens frames placed at points, relative to the anchor. */
function flatten(placements: [Frame, number, number][]): Pick<FlatFrame, 'fonts' | 'glyphs' | 'shapes'> {
  const fonts: string[] = [];
  const glyphs: FlatFrame['glyphs'] = [];
  const shapes: FlatFrame['shapes'] = [];
  const visit = (placed: Placed) => {
    // The oracle leaves links out.
    if (placed.kind === 'link') return;
    const t = placed.transform;
    const linear = t.sx !== 1 || t.ky !== 0 || t.kx !== 0 || t.sy !== 1;
    if (placed.kind === 'glyph') {
      const name = FONT_NAMES[placed.font];
      if (!fonts.includes(name)) fonts.push(name);
      const entry: FlatFrame['glyphs'][number] = [
        fonts.indexOf(name),
        placed.id,
        round(absToPt(placed.at.x)),
        round(absToPt(placed.at.y)),
        round(absToPt(placed.size)),
        placed.text,
      ];
      const fill = toHex(placed.fill);
      if (fill !== '#000000' || linear) entry.push(fill);
      if (linear) entry.push([t.sx, t.ky, t.kx, t.sy]);
      glyphs.push(entry);
    } else {
      const shape = placed.shape;
      const out: Record<string, unknown> = {};
      const apply = (x: number, y: number) => [
        round(absToPt(t.sx * x + t.kx * y + t.tx)),
        round(absToPt(t.ky * x + t.sy * y + t.ty)),
      ];
      if (shape.geometry.kind === 'line') {
        out.line = [...apply(0, 0), ...apply(shape.geometry.to.x, shape.geometry.to.y)];
      } else if (shape.geometry.kind === 'rect') {
        out.rect = [...apply(0, 0), round(absToPt(shape.geometry.size.x)), round(absToPt(shape.geometry.size.y))];
      } else {
        // Typst draws these as curves; Typlet keeps the box.
        out.box = [...apply(0, 0), round(absToPt(shape.geometry.size.x)), round(absToPt(shape.geometry.size.y))];
      }
      if (shape.fill) out.fill = toHex(shape.fill);
      if (shape.stroke) out.stroke = [toHex(shape.stroke.paint), round(absToPt(shape.stroke.thickness))];
      shapes.push(out);
    }
  };
  for (const [frame, x, y] of placements) walkFrame(frame, translate(x, y), visit);
  return { fonts, glyphs, shapes };
}

/**
 * Lays out a formula and flattens it as the oracle does: an inline formula
 * relative to the left end of its baseline, a display one to its top-left
 * corner. Throws a `SourceError` for formulas that fail.
 */
export function layoutFlat(formula: Formula, warnings: SourceDiagnostic[] = []): FlatFrame {
  const root = parseMath(formula.src);
  if (root.erroneous()) throw new Error('syntax error');
  const { equation, warnings: evalWarnings, styles: outer, number } = evalCorpusFormula(formula);
  warnings.push(...evalWarnings);
  if (formula.display) {
    const frame = layoutEquationBlock(equation, warnings, outer, number);
    return { box: { anchor: 'top', width: round(absToPt(frame.width)), height: round(absToPt(frame.height)) }, ...flatten([[frame, 0, 0]]) };
  }
  // The paragraph places the items in a row, on one baseline.
  const items = layoutEquationInline(equation, warnings, outer);
  const placements: [Frame, number, number][] = [];
  let x = 0;
  let ascent = 0;
  let descent = 0;
  for (const item of items) {
    if (item.kind === 'space') {
      x += item.width;
      continue;
    }
    placements.push([item.frame, x, -item.frame.baseline]);
    x += item.frame.width;
    ascent = Math.max(ascent, item.frame.ascent);
    descent = Math.max(descent, item.frame.descent);
  }
  return {
    box: { anchor: 'baseline', width: round(absToPt(x)), ascent: round(absToPt(ascent)), descent: round(absToPt(descent)) },
    ...flatten(placements),
  };
}

export { SourceError };

/** A frame as the oracle's fixtures hold it. */
export type FrameFixture = Omit<FlatFrame, 'box'> & { box: FlatFrame['box'] | null; fontSize: number };

/**
 * Positions may differ by the fixtures' rounding, 0.001pt. The plan allows
 * 0.01 em (0.11pt); the layout is exact, and this keeps it so.
 */
const TOLERANCE = 0.0015;

const near = (a: unknown, b: unknown) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= TOLERANCE;

/** How a laid-out frame differs from the oracle's, or `null` if it matches. */
export function frameDiff(got: FlatFrame, want: FrameFixture): string | null {
  for (const key of Object.keys(want.box ?? {})) {
    const a = (got.box as Record<string, unknown>)[key];
    const b = (want.box as Record<string, unknown>)[key];
    if (a !== b && !near(a, b)) return `box.${key}: ${a} vs ${b}`;
  }
  if (got.glyphs.length !== want.glyphs.length) return `${got.glyphs.length} glyphs vs ${want.glyphs.length}`;
  for (let i = 0; i < want.glyphs.length; i++) {
    const g = got.glyphs[i]!;
    const w = want.glyphs[i]!;
    if (got.fonts[g[0] as number] !== want.fonts[w[0] as number]) return `glyph ${i}: font`;
    if (g[1] !== w[1]) return `glyph ${i} (${w[5]}): id ${g[1]} vs ${w[1]}`;
    if (!near(g[2], w[2]) || !near(g[3], w[3])) return `glyph ${i} (${w[5]}): at ${g[2]},${g[3]} vs ${w[2]},${w[3]}`;
    if (!near(g[4], w[4])) return `glyph ${i}: size ${g[4]} vs ${w[4]}`;
  }
  if (got.shapes.length !== want.shapes.length) return `${got.shapes.length} shapes vs ${want.shapes.length}`;
  for (let i = 0; i < want.shapes.length; i++) {
    const g = got.shapes[i]!;
    const w = want.shapes[i]!;
    for (const key of Object.keys(w)) {
      const a = g[key];
      const b = w[key];
      if (Array.isArray(b)) {
        if (!Array.isArray(a) || a.length !== b.length || b.some((v, j) => v !== a[j] && !near(a[j], v))) {
          return `shape ${i}.${key}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
        }
      } else if (a !== b) {
        return `shape ${i}.${key}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
      }
    }
  }
  return null;
}
