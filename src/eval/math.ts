// Ported from Typst 0.15.1: crates/typst-eval/src/math.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// Typst gives evaluated content its expression's span afterwards
// (`Content::spanned`). To save a copy, the functions here that only run as
// expressions build their content with that span; the others take it as a
// parameter, since nested uses, like an equation's body, stay detached.

import {
  type LinkedNode,
  attachBase,
  attachBottom,
  attachPrimes,
  attachTop,
  equationIsBlock,
  exprs,
  firstExpr,
  firstOfKind,
  lastExpr,
  mathShorthandChar,
  mathTextIsNumber,
  mathWasDeparenthesized,
  rootIndex,
} from '../syntax/ast.js';
import { SyntaxKind } from '../syntax/kind.js';
import { accessField, evalDisplay, evalExpr, readBinding } from './code.js';
import {
  type AttachElem,
  type Content,
  type EquationElem,
  type FracElem,
  join,
  sequence,
  symbolElem,
  textElem,
} from './content.js';
import { type Span, at } from './diag.js';
import { singleSymbol } from './symbol.js';
import type { Value } from './value.js';
import type { Vm } from './vm.js';

const K = SyntaxKind;

/** An equation: `$x$`. */
export function evalEquation(vm: Vm, node: LinkedNode): Content {
  const body = evalMath(vm, firstOfKind(node, K.Math)!);
  const elem: EquationElem = { func: 'equation', body, block: equationIsBlock(node), span: node.span };
  return elem;
}

/** A sequence of math expressions, including spaces. */
export function evalMath(vm: Vm, node: LinkedNode, span: Span = null): Content {
  return sequence(exprs(node, true).map((expr) => evalDisplay(vm, expr)), span);
}

/** A number or a single grapheme. Numbers become text, other graphemes symbols. */
export function evalMathText(node: LinkedNode): Content {
  return mathTextIsNumber(node) ? textElem(node.text, node.span) : symbolElem(node.text, node.span);
}

/** An identifier in math, looked up in local scopes and the math scope. */
export function evalMathIdent(vm: Vm, node: LinkedNode): Value {
  const span = node.span;
  return readBinding(vm, at(span, () => vm.scopes.getInMath(node.text, span)), span);
}

/** A field access in math: `arrow.r`. */
export function evalMathFieldAccess(vm: Vm, node: LinkedNode): Value {
  const target = evalExpr(vm, firstExpr(node));
  const field = lastExpr(node);
  return accessField(vm, target, field.text, field.span);
}

/** A shorthand such as `->`. */
export function evalMathShorthand(node: LinkedNode): Value {
  return { type: 'symbol', v: singleSymbol(mathShorthandChar(node.text)) };
}

/** An alignment point: `&`. */
export function evalMathAlignPoint(span: Span): Content {
  return { func: 'align-point', span };
}

/** Matched delimiters: `(x)`. */
export function evalMathDelimited(vm: Vm, node: LinkedNode): Content {
  const open = evalDisplay(vm, firstExpr(node));
  const body = evalMath(vm, firstOfKind(node, K.Math)!);
  const close = evalDisplay(vm, lastExpr(node));
  return { func: 'lr', body: join(join(open, body), close), span: node.span };
}

/** Attachments: `x_1^2`. */
export function evalMathAttach(vm: Vm, node: LinkedNode): Content {
  const base = evalDisplay(vm, attachBase(node));
  const elem: AttachElem = { func: 'attach', base, span: node.span };

  const top = attachTop(node);
  if (top) elem.t = evalDisplay(vm, top);

  // Always attach primes in scripts style (not limits style), i.e. at the
  // top-right corner.
  const primes = attachPrimes(node);
  if (primes) elem.tr = evalMathPrimes(primes);

  const bottom = attachBottom(node);
  if (bottom) elem.b = evalDisplay(vm, bottom);

  return elem;
}

/** Primes: `'`. */
export function evalMathPrimes(node: LinkedNode, span: Span = null): Content {
  return { func: 'primes', count: node.text.length, span };
}

/** A fraction: `1/2`. */
export function evalMathFrac(vm: Vm, node: LinkedNode): Content {
  const numNode = firstExpr(node);
  const num = evalDisplay(vm, numNode);
  const denomNode = lastExpr(node);
  const denom = evalDisplay(vm, denomNode);
  const deparenthesized = (n: LinkedNode) => n.kind === K.Math && mathWasDeparenthesized(n);
  const elem: FracElem = {
    func: 'frac',
    num,
    denom,
    numDeparenthesized: deparenthesized(numNode),
    denomDeparenthesized: deparenthesized(denomNode),
    span: node.span,
  };
  return elem;
}

/** A root: `√x` or `∛x`. */
export function evalMathRoot(vm: Vm, node: LinkedNode): Content {
  // The index is text, matching how numbers evaluate.
  const index = rootIndex(node);
  const radicand = evalDisplay(vm, firstExpr(node));
  return { func: 'root', radicand, index: index === null ? null : textElem(String(index)), span: node.span };
}
