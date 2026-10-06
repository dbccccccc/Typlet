// Typlet original: not ported from Typst.
//
// Draws formulas as HTML, through the layout engine.

import type { HtmlBackend } from '../render.js';
import { layoutBlock, layoutInline, layoutNumberedBlock } from '../layout/math.js';
import { frameBox, inlineHtml, numberedHtml } from './html.js';

export const HTML_BACKEND: HtmlBackend = {
  draw(item, block, warnings, styles, number, ctx) {
    if (!block) return inlineHtml(layoutInline(item, warnings, styles), ctx);
    if (number) return numberedHtml(layoutNumberedBlock(item, warnings, styles, number), ctx);
    return frameBox(layoutBlock(item, warnings, styles), ctx);
  },
};
