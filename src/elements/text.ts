// Ported from Typst 0.15.1: crates/typst-library/src/text/mod.rs, crates/typst-library/src/text/font/variant.rs, crates/typst-library/src/model/strong.rs, crates/typst-library/src/model/emph.rs, crates/typst-library/src/text/deco.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// `text` styles its body, and `strong`, `emph` and `highlight` are elements
// whose show rules do. Typlet evaluates every parameter as Typst does; the
// layout draws those that matter for New Computer Modern Math (§6.3).

import {
  type Cast,
  type CastInfo,
  arrayCast,
  castError,
  boolCast,
  contentCast,
  cornersCast,
  dictCast,
  enumCast,
  intCast,
  lengthCast,
  mapCast,
  optionCast,
  paintCast,
  ratioCast,
  relCast,
  sidesCast,
  smartCast,
  strCast,
  strokeCast,
  typeInfo,
  union,
  unionCast,
  valueCast,
  valueInfo,
} from '../eval/cast.js';
import { type Color, luma, rgb } from '../eval/color.js';
import { type TextEdge, styled } from '../eval/content.js';
import { type Span, bail, warning } from '../eval/diag.js';
import { type Func, param } from '../eval/func.js';
import { absPt, length, relFromRatio } from '../eval/layout.js';
import { type Property, property } from '../eval/styles.js';
import { AUTO, FALSE, NONE, TRUE, type TypeName, type Value, arrayValue, dictValue, intValue, strValue } from '../eval/value.js';
import { elemFunc } from './elem.js';

/** A cast whose info names types Typlet has no values of, such as `gradient`. */
const named = <T>(cast: Cast<T>, ...types: string[]): Cast<T> => ({
  ...cast,
  info: union(...types.map((t) => typeInfo(t as TypeName))),
});

const strValues = (...names: string[]): CastInfo => union(...names.map((n) => valueInfo(strValue(n))));

/** Font weights by name, like `FontWeight`'s cast. */
export const WEIGHTS: Readonly<Record<string, number>> = {
  thin: 100,
  extralight: 200,
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
};

/** A font weight: a number, clamped to 100–900, or a name. */
const weightCast: Cast<number> = (() => {
  const info = union(typeInfo('int'), strValues(...Object.keys(WEIGHTS)));
  return {
    info,
    castable: (v) => v.type === 'int' || (v.type === 'str' && v.v in WEIGHTS),
    cast(v) {
      if (v.type === 'int') return Math.min(900, Math.max(100, Number(v.v < 0n ? 0n : v.v > 65535n ? 65535n : v.v)));
      if (v.type === 'str' && v.v in WEIGHTS) return WEIGHTS[v.v]!;
      throw castError(info, v);
    },
  };
})();

/** A font family list: a name, an array of names, or a dictionary with `name` and `covers`. */
const fontListCast: Cast<readonly string[]> = {
  info: union(typeInfo('str'), typeInfo('dictionary'), typeInfo('array')),
  castable: (v) => v.type === 'str' || v.type === 'array' || v.type === 'dictionary',
  cast(v) {
    const family = (item: Value): string => {
      if (item.type === 'str') return item.v.toLowerCase();
      if (item.type === 'dictionary') {
        const name = item.v.get('name');
        if (name === undefined) bail('dictionary does not contain key "name"');
        return strCast.cast(name).toLowerCase();
      }
      return strCast.cast(item).toLowerCase();
    };
    if (v.type === 'array') return v.v.map(family);
    return [family(v)];
  },
};

/** The font families the oracle's Typst has, so that unknown ones warn as in Typst. */
export const KNOWN_FAMILIES: ReadonlySet<string> = new Set(['libertinus serif', 'new computer modern', 'new computer modern math', 'dejavu sans mono']);

/** The font families of equations, which their show rule sets. */
export const MATH_FAMILIES: readonly string[] = ['new computer modern math'];

const TOP_EDGES = ['ascender', 'cap-height', 'x-height', 'baseline', 'bounds'];
const BOTTOM_EDGES = ['baseline', 'descender', 'bounds'];

/** A text edge: a metric's name or a length. */
const edgeCast = (names: string[]): Cast<TextEdge> => unionCast<TextEdge>(enumCast(names), lengthCast);

/** A language code, like `Lang`'s cast. */
const langCast: Cast<string> = mapCast(strCast, (s) => {
  if (!/^[a-zA-Z]{2,3}$/.test(s)) bail('expected two or three letter language code (ISO 639-1/2/3)');
  return s.toLowerCase();
});

/** A region code, like `Region`'s cast. */
const regionCast: Cast<string> = mapCast(strCast, (s) => {
  if (!/^[a-zA-Z]{2}$/.test(s)) bail('expected two letter region code (ISO 3166-1 alpha-2)');
  return s.toUpperCase();
});

const COSTS_DEFAULT = (): Value =>
  dictValue(
    new Map(['hyphenation', 'runt', 'widow', 'orphan'].map((key) => [key, { type: 'ratio', v: 1 } as Value])),
  );

/** A settable parameter of `text`: its name, cast and default, and how it is found. */
interface TextParam {
  readonly name: string;
  readonly cast: Cast<unknown>;
  readonly default: () => Value;
  /** Also found as a positional argument of a type it accepts. */
  readonly orFind?: boolean;
}

const TEXT_PARAMS: readonly TextParam[] = [
  { name: 'font', cast: fontListCast, default: () => strValue('libertinus serif') },
  { name: 'fallback', cast: boolCast, default: () => TRUE },
  { name: 'style', cast: enumCast(['normal', 'italic', 'oblique']), default: () => strValue('normal') },
  { name: 'weight', cast: weightCast, default: () => strValue('regular') },
  { name: 'stretch', cast: ratioCast, default: () => ({ type: 'ratio', v: 1 }) },
  { name: 'size', cast: lengthCast, default: () => ({ type: 'length', v: length(absPt(11), 0) }), orFind: true },
  { name: 'fill', cast: paintCast, default: () => ({ type: 'color', v: luma(0) }), orFind: true },
  { name: 'stroke', cast: optionCast(strokeCast), default: () => NONE },
  { name: 'tracking', cast: lengthCast, default: () => ({ type: 'length', v: length(0, 0) }) },
  { name: 'spacing', cast: relCast, default: () => ({ type: 'relative', v: relFromRatio(1) }) },
  { name: 'cjk-latin-spacing', cast: named(optionCast(smartCast(valueCast)), 'none', 'auto'), default: () => AUTO },
  { name: 'baseline', cast: lengthCast, default: () => ({ type: 'length', v: length(0, 0) }) },
  { name: 'overhang', cast: boolCast, default: () => TRUE },
  { name: 'top-edge', cast: edgeCast(TOP_EDGES), default: () => strValue('cap-height') },
  { name: 'bottom-edge', cast: edgeCast(BOTTOM_EDGES), default: () => strValue('baseline') },
  { name: 'lang', cast: langCast, default: () => strValue('en') },
  { name: 'region', cast: optionCast(regionCast), default: () => NONE },
  { name: 'script', cast: smartCast(strCast), default: () => AUTO },
  { name: 'dir', cast: named(smartCast(valueCast), 'direction', 'auto'), default: () => AUTO },
  { name: 'hyphenate', cast: smartCast(boolCast), default: () => AUTO },
  { name: 'costs', cast: dictCast, default: COSTS_DEFAULT },
  { name: 'kerning', cast: boolCast, default: () => TRUE },
  { name: 'alternates', cast: unionCast<unknown>(boolCast, intCast), default: () => intValue(0n) },
  { name: 'stylistic-set', cast: named(optionCast(unionCast<unknown>(intCast, arrayCast)), 'none', 'int', 'array'), default: () => arrayValue([]) },
  { name: 'ligatures', cast: boolCast, default: () => TRUE },
  { name: 'discretionary-ligatures', cast: boolCast, default: () => FALSE },
  { name: 'historical-ligatures', cast: boolCast, default: () => FALSE },
  { name: 'number-type', cast: smartCast(enumCast(['lining', 'old-style'])), default: () => AUTO },
  { name: 'number-width', cast: smartCast(enumCast(['proportional', 'tabular'])), default: () => AUTO },
  { name: 'slashed-zero', cast: boolCast, default: () => FALSE },
  { name: 'fractions', cast: boolCast, default: () => FALSE },
  { name: 'features', cast: unionCast<unknown>(arrayCast, dictCast), default: () => dictValue(new Map()) },
  { name: 'variations', cast: dictCast, default: () => dictValue(new Map()) },
];

/** The styles a call of `text` or a `text` set rule sets, like `TextElem::set`. */
function setText(args: import('../eval/args.js').Args, warn: (span: Span, message: string) => void): Property[] {
  const styles: Property[] = [];
  for (const p of TEXT_PARAMS) {
    let value: unknown;
    if (p.orFind) {
      value = args.namedOrFind(p.name, p.cast);
    } else if (p.name === 'font') {
      // Typst warns about families it has no font for.
      const item = args.items.find((i) => i.name === 'font');
      value = args.named('font', p.cast);
      if (value !== undefined) {
        for (const family of value as string[]) {
          if (!KNOWN_FAMILIES.has(family)) warn(item!.valueSpan, `unknown font family: ${family}`);
        }
      }
    } else {
      value = args.named(p.name, p.cast);
    }
    if (value !== undefined) styles.push(property('text', p.name, value));
  }
  return styles;
}

/** `text(fill: red)[x]`: styles all text in its body, like `TextElem`'s constructor. */
export const text: Func = {
  name: 'text',
  elem: 'text',
  params: [
    ...TEXT_PARAMS.map((p) => param(p.name, p.cast, 'named', { settable: true, default: p.default })),
    param('body', contentCast, 'named', { default: () => ({ type: 'content', v: { func: 'sequence', children: [], span: null } }) }),
    param('text', strCast, 'required'),
  ],
  call(engine, args) {
    const styles = setText(args, (span, message) => engine.warnings.push(warning(span, message)));
    const body = args.expect('body', contentCast);
    return { type: 'content', v: styled(body, styles) };
  },
  set(engine, args) {
    return setText(args, (span, message) => engine.warnings.push(warning(span, message)));
  },
};

/** Strong emphasis: `strong[x]`, drawn in a heavier weight. */
export const strong = elemFunc('strong', [
  { name: 'delta', cast: mapCast(intCast, Number), kind: 'named', default: () => intValue(300n) },
  { name: 'body', cast: contentCast, kind: 'required' },
]);

/** Emphasis: `emph[x]`, which toggles italic text. */
export const emph = elemFunc('emph', [{ name: 'body', cast: contentCast, kind: 'required' }]);

const optionalStroke = optionCast(strokeCast);

/** A highlight behind text: `highlight[x]`. */
export const highlight = elemFunc('highlight', [
  {
    name: 'fill',
    cast: named(optionCast(paintCast), 'color', 'gradient', 'tiling', 'none'),
    kind: 'named',
    default: () => ({ type: 'color', v: highlightYellow() }),
  },
  { name: 'stroke', cast: sidesCast(optionalStroke), kind: 'named', default: () => dictValue(new Map()) },
  { name: 'top-edge', cast: edgeCast(TOP_EDGES), kind: 'named', default: () => strValue('ascender') },
  { name: 'bottom-edge', cast: edgeCast(BOTTOM_EDGES), kind: 'named', default: () => strValue('descender') },
  { name: 'extent', cast: lengthCast, kind: 'named', default: () => ({ type: 'length', v: length(0, 0) }) },
  { name: 'radius', cast: cornersCast(relCast), kind: 'named', default: () => dictValue(new Map()) },
  { name: 'body', cast: contentCast, kind: 'required' },
]);

/** Typst's default highlight: `rgb("#fffd11a1")`. */
export function highlightYellow(): Color {
  return rgb(0xff / 255, 0xfd / 255, 0x11 / 255, 0xa1 / 255);
}
