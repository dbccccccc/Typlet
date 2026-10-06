// Ported from Typst 0.15.1: crates/typst-library/src/visualize/color.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

// Typlet supports the grayscale and sRGB color spaces. Typst stores color
// components as 32-bit floats, so the components here are rounded with
// `Math.fround` to give the same hex codes and comparisons.

import { bail } from './diag.js';
import { reprRatio } from './layout.js';
import { reprStr } from './repr.js';

export type Color =
  | { readonly space: 'luma'; readonly luma: number; readonly alpha: number }
  | {
      readonly space: 'rgb';
      readonly red: number;
      readonly green: number;
      readonly blue: number;
      readonly alpha: number;
    };

const f = Math.fround;

export function luma(gray: number, alpha = 1): Color {
  return { space: 'luma', luma: f(gray), alpha: f(alpha) };
}

export function rgb(red: number, green: number, blue: number, alpha = 1): Color {
  return { space: 'rgb', red: f(red), green: f(green), blue: f(blue), alpha: f(alpha) };
}

/** Typst's named colors. */
export const NAMED_COLORS: Readonly<Record<string, Color>> = {
  black: luma(0),
  gray: luma(0.6666666),
  white: luma(1),
  silver: luma(0.8666667),
  navy: rgb(0, 0.121569, 0.247059),
  blue: rgb(0, 0.454902, 0.85098),
  aqua: rgb(0.4980392, 0.858823, 1),
  teal: rgb(0.223529, 0.8, 0.8),
  eastern: rgb(0.13725, 0.615686, 0.678431),
  purple: rgb(0.694118, 0.05098, 0.788235),
  fuchsia: rgb(0.941177, 0.070588, 0.745098),
  maroon: rgb(0.521569, 0.078431, 0.294118),
  red: rgb(1, 0.254902, 0.211765),
  orange: rgb(1, 0.521569, 0.105882),
  yellow: rgb(1, 0.8627451, 0),
  olive: rgb(0.239216, 0.6, 0.4392157),
  green: rgb(0.1803922, 0.8, 0.2509804),
  lime: rgb(0.0039216, 1, 0.4392157),
};

/** Parses a hex color such as `#aef`, `7a03c2` or `#abcdefff`. */
export function colorFromHex(text: string): Color {
  const hex = text.startsWith('#') ? text.slice(1) : text;
  if (/[^0-9a-fA-F]/.test(hex)) bail('color string contains non-hexadecimal letters');
  const len = hex.length;
  const long = len === 6 || len === 8;
  const short = len === 3 || len === 4;
  const alpha = len === 4 || len === 8;
  if (!long && !short) bail('color string has wrong length');
  const values = [255, 255, 255, 255];
  for (let i = 0; i < (alpha ? 4 : 3); i++) {
    const size = long ? 2 : 1;
    let value = parseInt(hex.slice(i * size, i * size + size), 16);
    if (short) value += value * 16;
    values[i] = value;
  }
  return fromU8(values[0]!, values[1]!, values[2]!, values[3]!);
}

function fromU8(r: number, g: number, b: number, a: number): Color {
  return rgb(f(r / 255), f(g / 255), f(b / 255), f(a / 255));
}

/** Converts a 32-bit float component to 0–255, as the palette crate does: rounding half to even. */
function toU8(component: number): number {
  const scaled = Math.min(f(f(component) * 255), 255);
  if (!(scaled > 0)) return 0;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** The color's components in sRGB, from 0 to 255. */
export function toRgbU8(color: Color): [number, number, number, number] {
  return color.space === 'luma'
    ? [toU8(color.luma), toU8(color.luma), toU8(color.luma), toU8(color.alpha)]
    : [toU8(color.red), toU8(color.green), toU8(color.blue), toU8(color.alpha)];
}

/** The color's hex code, such as `#ffaa32`, with an alpha byte only when it is not opaque. */
export function toHex(color: Color): string {
  const [r, g, b, a] = toRgbU8(color);
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}${a === 255 ? '' : hex(a)}`;
}

export function reprColor(color: Color): string {
  if (color.space === 'rgb') return `rgb(${reprStr(toHex(color))})`;
  return color.alpha === 1
    ? `luma(${reprRatio(color.luma)})`
    : `luma(${reprRatio(color.luma)}, ${reprRatio(color.alpha)})`;
}

/** Compares colors at 8-bit precision, as Typst does. */
export function colorEq(a: Color, b: Color): boolean {
  if (a.space !== b.space) return false;
  if (a.space === 'luma' && b.space === 'luma') {
    return Math.round(f(a.luma * 255)) === Math.round(f(b.luma * 255));
  }
  return toRgbU8(a).every((c, i) => c === toRgbU8(b)[i]);
}
