// Ported from Typst 0.15.1: crates/typst-library/src/lib.rs, crates/typst-library/src/math/mod.rs, crates/typst-library/src/layout/spacing.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// The scopes Typlet evaluates against: the parts of Typst's global scope that
// embedded code Level 1 needs (docs/DESIGN.md §6.3), and the whole math scope. The
// color constructors are ported from typst-library's visualize/color.rs.

import { accent, getAccentFunc } from '../elements/accent.js';
import { box, hide, link } from '../elements/box.js';
import { emph, highlight, strong, text } from '../elements/text.js';
import { attach, limits, primes, scripts, stretch } from '../elements/attach.js';
import { cancelFunc } from '../elements/cancel.js';
import { binom, frac } from '../elements/frac.js';
import { abs, getLrWrapperFunc, lr, mid, norm, round } from '../elements/lr.js';
import { cases, mat, vec } from '../elements/matrix.js';
import { MEDIUM, QUAD, THICK, THIN, WIDE, classFunc, equation } from '../elements/mod.js';
import { op, textOperators } from '../elements/op.js';
import { root, sqrt } from '../elements/root.js';
import * as style from '../elements/style.js';
import * as underover from '../elements/underover.js';
import {
  type Cast,
  boolCast,
  colorCast,
  frCast,
  funcCast as makeFuncCast,
  intCast,
  ratioCast,
  relCast,
  strCast,
  unionCast,
} from './cast.js';
import { type Color, NAMED_COLORS, colorFromHex, luma, rgb } from './color.js';
import type { Spacing } from './content.js';
import { at, bail, unsupported } from './diag.js';
import { type Func, contentFunc, param } from './func.js';
import { type Alignment, length, relFromLength } from './layout.js';
import { type Library, type Module, Scope } from './scope.js';
import { type Symbol, type SymDef, symbolGet, symModule } from './symbol.js';
import { FALSE, type Value, contentValue, funcValue, symbolValue } from './value.js';

/** The function a callable symbol stands for, like `Symbol::func`. */
export function symbolFunc(symbol: Symbol): Func {
  const value = symbolGet(symbol);
  return getAccentFunc(value) ?? getLrWrapperFunc(value) ?? bail(`symbol ${value} is not callable`);
}

/** Casts functions, including callable symbols. */
export const funcCast: Cast<Func> = makeFuncCast((v) => symbolFunc((v as Extract<Value, { type: 'symbol' }>).v));

/** Spacing for `h`: a relative length or a fraction. */
const spacingCast: Cast<Spacing> = unionCast<Spacing>(
  { ...relCast, cast: (v) => ({ rel: relCast.cast(v) }) },
  { ...frCast, cast: (v) => ({ fr: frCast.cast(v) }) },
);

/** Horizontal spacing: `h(1em)`. */
const h = contentFunc(
  'h',
  [param('amount', spacingCast, 'required'), param('weak', boolCast, 'named', { settable: true, default: () => FALSE })],
  (args) => {
    const amount = args.expect('amount', spacingCast);
    const weak = args.named('weak', boolCast);
    return { func: 'h', amount, ...(weak !== undefined ? { weak } : {}), span: null };
  },
  'h',
);

/** A color component: an integer from 0 to 255 or a ratio. */
const componentCast: Cast<number> = unionCast<number>(
  {
    ...intCast,
    cast(v) {
      const n = intCast.cast(v);
      if (n < 0n || n > 255n) bail('number must be between 0 and 255');
      return Number(n) / 255;
    },
  },
  { ...ratioCast, cast: (v) => ratioComponent(ratioCast.cast(v)) },
);

function ratioComponent(r: number): number {
  if (!(r >= 0 && r <= 1)) bail('ratio must be between 0% and 100%');
  return r;
}

/** `rgb(255, 0, 0)`, `rgb("#ff0000")` or `rgb(color)`. */
const rgbFunc: Func = {
  name: 'rgb',
  params: [
    // Typst describes these alternative forms as required parameters.
    param('red', componentCast, 'required'),
    param('green', componentCast, 'required'),
    param('blue', componentCast, 'required'),
    param('alpha', componentCast, 'required'),
    param('hex', strCast, 'required'),
    param('color', colorCast, 'required'),
  ],
  call(_engine, args) {
    const i = args.items.findIndex((item) => item.name === null && strCast.castable(item.value));
    if (i >= 0) {
      const [item] = args.items.splice(i, 1);
      return { type: 'color', v: at(item!.valueSpan, () => colorFromHex(strCast.cast(item!.value))) };
    }
    const color = args.find(colorCast);
    if (color) return { type: 'color', v: toRgb(color) };
    const r = args.expect('red component', componentCast);
    const g = args.expect('green component', componentCast);
    const b = args.expect('blue component', componentCast);
    const a = args.eat(componentCast) ?? 1;
    return { type: 'color', v: rgb(r, g, b, a) };
  },
};

function toRgb(color: Color): Color {
  return color.space === 'rgb' ? color : rgb(color.luma, color.luma, color.luma, color.alpha);
}

/** `luma(50%)` or `luma(color)`. */
const lumaFunc: Func = {
  name: 'luma',
  params: [
    param('lightness', componentCast, 'required'),
    param('alpha', ratioCast, 'required'),
    param('color', colorCast, 'required'),
  ],
  call(_engine, args) {
    const color = args.find(colorCast);
    if (color) {
      if (color.space !== 'luma') unsupported(args.span, 'converting colors to `luma` yet');
      return { type: 'color', v: color };
    }
    // Typst ignores a missing or invalid gray component and uses 100%.
    let gray = 1;
    try {
      gray = args.expect('gray component', componentCast);
    } catch {
      // As Typst does.
    }
    const alpha = args.eat({ ...ratioCast, cast: (v) => ratioComponent(ratioCast.cast(v)) }) ?? 1;
    return { type: 'color', v: luma(gray, alpha) };
  },
};

/** A module whose scope is built when first used. */
function lazyModule(name: string, build: (scope: Scope) => void): Module {
  let scope: Scope | null = null;
  return {
    name,
    get scope() {
      if (!scope) {
        scope = new Scope();
        build(scope);
      }
      return scope;
    },
  };
}

/** Defines the definitions of a codex module, recursively. */
function defineSymbols(scope: Scope, defs: ReadonlyMap<string, SymDef>): void {
  for (const [name, def] of defs) {
    if (def.kind === 'symbol') {
      scope.define(name, symbolValue(def.symbol), def.deprecation);
    } else {
      scope.define(name, { type: 'module', v: lazyModule(name, (inner) => defineSymbols(inner, def.defs)) });
    }
  }
}

const symModuleValue = lazyModule('sym', (scope) => defineSymbols(scope, symModule()));

const mathModule = lazyModule('math', (math) => {
  const elems: Func[] = [
    equation,
    text,
    lr,
    mid,
    attach,
    stretch,
    scripts,
    limits,
    accent,
    underover.underline,
    underover.overline,
    underover.underbrace,
    underover.overbrace,
    underover.underbracket,
    underover.overbracket,
    underover.underparen,
    underover.overparen,
    underover.undershell,
    underover.overshell,
    cancelFunc(funcCast),
    frac,
    binom,
    vec,
    mat,
    cases,
    root,
    classFunc,
    op,
    primes,
    abs,
    norm,
    round,
    sqrt,
    style.upright,
    style.bold,
    style.italic,
    style.serif,
    style.sans,
    style.scr,
    style.cal,
    style.frak,
    style.mono,
    style.bb,
    style.display,
    style.inline,
    style.script,
    style.sscript,
  ];
  for (const func of elems) math.define(func.name!, funcValue(func));

  // Text operators.
  for (const [name, content] of textOperators()) math.define(name, contentValue(content));

  // Spacings.
  for (const [name, em] of [
    ['thin', THIN],
    ['med', MEDIUM],
    ['thick', THICK],
    ['quad', QUAD],
    ['wide', WIDE],
  ] as const) {
    math.define(name, contentValue({ func: 'h', amount: { rel: relFromLength(length(0, em)) }, span: null }));
  }

  // Symbols.
  defineSymbols(math, symModule());
});

const ALIGNMENTS: readonly [string, Alignment][] = [
  ['start', { x: 'start' }],
  ['left', { x: 'left' }],
  ['center', { x: 'center' }],
  ['right', { x: 'right' }],
  ['end', { x: 'end' }],
  ['top', { y: 'top' }],
  ['horizon', { y: 'horizon' }],
  ['bottom', { y: 'bottom' }],
];

const globalModule = lazyModule('global', (global) => {
  global.define('h', funcValue(h));
  for (const func of [text, strong, emph, highlight, box, hide, link]) global.define(func.name!, funcValue(func));
  global.define('sym', { type: 'module', v: symModuleValue });
  global.define('math', { type: 'module', v: mathModule });
  for (const [name, color] of Object.entries(NAMED_COLORS)) global.define(name, { type: 'color', v: color });
  global.define('luma', funcValue(lumaFunc));
  global.define('rgb', funcValue(rgbFunc));
  for (const [name, alignment] of ALIGNMENTS) global.define(name, { type: 'alignment', v: alignment });
});

/** The library Typlet evaluates with. */
export const LIBRARY: Library = { global: globalModule, math: mathModule };
