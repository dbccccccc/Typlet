// Ported from Typst 0.15.1: crates/typst-library/src/math/style.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { boolCast, contentCast } from '../eval/cast.js';
import { type Content, styled } from '../eval/content.js';
import { type Func, contentFunc, param } from '../eval/func.js';
import { type Property, type StyleChain, get, property } from '../eval/styles.js';
import { FALSE, TRUE } from '../eval/value.js';
import type { MathVariant } from '../utils/styling.js';

/** The size of math content, from smallest to largest. */
export enum MathSize {
  ScriptScript,
  Script,
  Text,
  Display,
}

// The style fields of `math.equation` that math functions set. Typst keeps
// them internal; they only exist as styles.
export const equationSize = (styles: StyleChain): MathSize => get(styles, 'equation', 'size', MathSize.Text);
export const equationVariant = (styles: StyleChain): MathVariant | null =>
  get<MathVariant | null>(styles, 'equation', 'variant', null);
export const equationCramped = (styles: StyleChain): boolean => get(styles, 'equation', 'cramped', false);
export const equationBold = (styles: StyleChain): boolean => get(styles, 'equation', 'bold', false);
export const equationItalic = (styles: StyleChain): boolean | null =>
  get<boolean | null>(styles, 'equation', 'italic', null);

const body = param('body', contentCast, 'required');

function styleFunc(name: string, properties: (args: Parameters<Func['call']>[1]) => Property[], extra = false): Func {
  const params = [body];
  if (extra) {
    params.push(
      param('cramped', boolCast, 'named', { default: () => (name === 'script' || name === 'sscript' ? TRUE : FALSE) }),
    );
  }
  return contentFunc(name, params, (args) => {
    const content = args.expect('body', contentCast) as Content;
    return styled(content, properties(args));
  });
}

const set = (field: string, value: unknown) => () => [property('equation', field, value)];

export const bold = styleFunc('bold', set('bold', true));
export const upright = styleFunc('upright', set('italic', false));
export const italic = styleFunc('italic', set('italic', true));
export const serif = styleFunc('serif', set('variant', 'plain'));
export const sans = styleFunc('sans', set('variant', 'sans-serif'));
export const cal = styleFunc('cal', set('variant', 'chancery'));
export const scr = styleFunc('scr', set('variant', 'roundhand'));
export const frak = styleFunc('frak', set('variant', 'fraktur'));
export const mono = styleFunc('mono', set('variant', 'monospace'));
export const bb = styleFunc('bb', set('variant', 'double-struck'));

function sizeFunc(name: string, size: MathSize, crampedDefault: boolean): Func {
  return styleFunc(
    name,
    (args) => [
      property('equation', 'size', size),
      property('equation', 'cramped', args.named('cramped', boolCast) ?? crampedDefault),
    ],
    true,
  );
}

export const display = sizeFunc('display', MathSize.Display, false);
export const inline = sizeFunc('inline', MathSize.Text, false);
export const script = sizeFunc('script', MathSize.Script, true);
export const sscript = sizeFunc('sscript', MathSize.ScriptScript, true);

/** Activates the `flac` font feature, for flattened accents. */
export const styleFlac = (): Property => property('text', 'features', 'flac');
/** Activates the `dtls` font feature, for dotless bases of accents. */
export const styleDtls = (): Property => property('text', 'features', 'dtls');
/** Makes math cramped. */
export const styleCramped = (): Property => property('equation', 'cramped', true);

/** The style for superscripts: one size smaller. */
export function styleForSuperscript(styles: StyleChain): Property {
  const size = equationSize(styles);
  return property(
    'equation',
    'size',
    size === MathSize.Display || size === MathSize.Text ? MathSize.Script : MathSize.ScriptScript,
  );
}

/** The styles for subscripts: one size smaller, and cramped. */
export function styleForSubscript(styles: StyleChain): Property[] {
  return [styleForSuperscript(styles), styleCramped()];
}

/** The style for numerators. */
export function styleForNumerator(styles: StyleChain): Property {
  const size = equationSize(styles);
  return property(
    'equation',
    'size',
    size === MathSize.Display ? MathSize.Text : size === MathSize.Text ? MathSize.Script : MathSize.ScriptScript,
  );
}

/** The styles for denominators: like numerators, and cramped. */
export function styleForDenominator(styles: StyleChain): Property[] {
  return [styleForNumerator(styles), styleCramped()];
}
