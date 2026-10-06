// Ported from Typst 0.15.1: crates/typst-eval/src/code.rs, crates/typst-eval/src/ops.rs, crates/typst-eval/src/markup.rs, crates/typst-library/src/foundations/fields.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import {
  BinOp,
  LinkedNode,
  UnOp,
  binaryOp,
  exprs,
  firstExpr,
  firstOfKind,
  intLiteral,
  isExpr,
  lastExpr,
  lastOfKind,
  numericLiteral,
  unaryOp,
  unescapeStr,
} from '../syntax/ast.js';
import { SyntaxKind } from '../syntax/kind.js';
import { evalLetBinding } from './binding.js';
import { evalFuncCall, evalMathCall } from './call.js';
import { strCast } from './cast.js';
import { evalClosure } from './closure.js';
import { INTERNAL_FIELDS, type Content, spaceElem, spanned, styled } from './content.js';
import { evalConditional, evalLoopControl, evalReturn } from './flow.js';
import { evalContentBlock, evalMarkupExpr } from './markup.js';
import { evalSetRule } from './rules.js';
import { type Span, SourceError, at, bail, bailAt, unsupported, rethrowAt } from './diag.js';
import { absCm, absIn, absMm, absPt, angleDeg, length } from './layout.js';
import {
  evalEquation,
  evalMath,
  evalMathAlignPoint,
  evalMathAttach,
  evalMathDelimited,
  evalMathFieldAccess,
  evalMathFrac,
  evalMathIdent,
  evalMathPrimes,
  evalMathRoot,
  evalMathShorthand,
  evalMathText,
} from './math.js';
import * as ops from './ops.js';
import { reprStr } from './repr.js';
import { moduleField } from './scope.js';
import { singleSymbol, symbolModified } from './symbol.js';
import {
  type Value,
  AUTO,
  ELEM_FIELDS,
  FALSE,
  NONE,
  TRUE,
  arrayValue,
  contentValue,
  dictValue,
  display,
  fieldValue,
  floatValue,
  intValue,
  strValue,
  typeOf,
} from './value.js';
import type { Vm } from './vm.js';

const K = SyntaxKind;

/** Evaluates an expression, like Typst's `Eval for ast::Expr`. */
export function evalExpr(vm: Vm, node: LinkedNode): Value {
  const value = evalExprInner(vm, node);
  if (value.type !== 'content') return value;
  // Content built by the expression itself already has the span.
  const content = spanned(value.v, node.span);
  return content === value.v ? value : contentValue(content);
}

function evalExprInner(vm: Vm, node: LinkedNode): Value {
  const span = node.span;
  switch (node.kind) {
    // Markup that appears in math.
    case K.Space:
      return contentValue(spaceElem(span));
    case K.Linebreak:
      return contentValue({ func: 'linebreak', span });
    case K.Escape:
      return { type: 'symbol', v: singleSymbol(escapeChar(node.text)) };

    // Math.
    case K.Equation:
      return contentValue(evalEquation(vm, node));
    case K.Math:
      return contentValue(evalMath(vm, node, span));
    case K.MathText:
      return contentValue(evalMathText(node));
    case K.MathIdent:
      return evalMathIdent(vm, node);
    case K.MathFieldAccess:
      return evalMathFieldAccess(vm, node);
    case K.MathShorthand:
      return evalMathShorthand(node);
    case K.MathAlignPoint:
      return contentValue(evalMathAlignPoint(span));
    case K.MathCall:
      return evalMathCall(vm, node);
    case K.MathDelimited:
      return contentValue(evalMathDelimited(vm, node));
    case K.MathAttach:
      return contentValue(evalMathAttach(vm, node));
    case K.MathPrimes:
      return contentValue(evalMathPrimes(node, span));
    case K.MathFrac:
      return contentValue(evalMathFrac(vm, node));
    case K.MathRoot:
      return contentValue(evalMathRoot(vm, node));

    // Literals, whose values are kept, as closures evaluate them often.
    case K.Int:
    case K.Float:
    case K.Numeric:
    case K.Str:
      return (node.memo as Value | undefined) ?? (node.memo = literal(node));
    case K.Ident:
      return readBinding(vm, at(span, () => vm.scopes.get(node.text, span)), span);
    case K.None:
      return NONE;
    case K.Auto:
      return AUTO;
    case K.Bool:
      return node.text === 'true' ? TRUE : FALSE;

    // Code.
    case K.Array:
      return evalArray(vm, node);
    case K.Dict:
      return evalDict(vm, node);
    case K.Parenthesized:
      return evalExpr(vm, firstExpr(node));
    case K.FieldAccess: {
      const target = evalExpr(vm, firstExpr(node));
      const field = lastOfKind(node, K.Ident)!;
      return accessField(vm, target, field.text, field.span);
    }
    case K.FuncCall:
      return evalFuncCall(vm, node);
    case K.Unary:
      return evalUnary(vm, node);
    case K.Binary:
      return evalBinary(vm, node);

    case K.SetRule:
      return bailAt(span, 'set is only allowed directly in code and content blocks');
    case K.ShowRule:
      return bailAt(span, 'show is only allowed directly in code and content blocks');

    // Code (embedded code Level 3).
    case K.CodeBlock:
      return evalCodeBlock(vm, node);
    case K.ContentBlock:
      return contentValue(evalContentBlock(vm, node));
    case K.LetBinding:
      return evalLetBinding(vm, node);
    case K.Closure:
      return evalClosure(vm, node);
    case K.Conditional:
      return evalConditional(vm, node);
    case K.FuncReturn:
      return evalReturn(vm, node);
    case K.LoopBreak:
      return evalLoopControl(vm, node, 'break');
    case K.LoopContinue:
      return evalLoopControl(vm, node, 'continue');

    default:
      return evalMarkupExpr(vm, node) ?? unsupported(span, describeUnsupported(node.kind));
  }
}

/** The value of a literal. */
function literal(node: LinkedNode): Value {
  switch (node.kind) {
    case K.Int:
      return evalInt(node);
    case K.Float:
      return floatValue(Number(node.text));
    case K.Numeric:
      return evalNumeric(node);
    default:
      return strValue(unescapeStr(node.text));
  }
}

/** How Typlet names a construct it refuses. */
function describeUnsupported(kind: SyntaxKind): string {
  switch (kind) {
    case K.WhileLoop:
    case K.ForLoop:
      return 'loops';
    case K.ModuleImport:
    case K.ModuleInclude:
      return 'imports and includes';
    case K.Contextual:
      return 'context expressions';
    case K.DestructAssignment:
      return 'assignments';
    default:
      return 'this kind of markup or code';
  }
}

/** A code block: `{ .. }`, with a scope of its own. */
function evalCodeBlock(vm: Vm, node: LinkedNode): Value {
  vm.scopes.enter();
  try {
    return evalCode(vm, (node.memo ??= exprs(firstOfKind(node, K.Code)!)) as LinkedNode[], 0);
  } finally {
    vm.scopes.exit();
  }
}

/**
 * Evaluates code expressions from `start` and joins their values, like
 * `eval_code`. A set rule styles the rest of the block.
 */
export function evalCode(vm: Vm, list: LinkedNode[], start: number): Value {
  const flow = vm.flow;
  vm.flow = null;
  let output: Value = NONE;
  for (let i = start; i < list.length; i++) {
    const expr = list[i]!;
    let value: Value;
    let last = false;
    if (expr.kind === K.SetRule) {
      const styles = evalSetRule(vm, expr);
      if (vm.flow) break;
      const tail = display(evalCode(vm, list, i + 1));
      value = contentValue(styled(tail, styles));
      last = true;
    } else if (expr.kind === K.ShowRule) {
      return unsupported(expr.span, '`show` rules');
    } else {
      value = evalExpr(vm, expr);
    }
    if (output.type === 'none') output = value;
    else if (value.type !== 'none') {
      try {
        output = ops.join(output, value);
      } catch (e) {
        rethrowAt(e, expr.span);
      }
    }
    if (vm.flow) {
      warnForDiscardedContent(vm, output);
      break;
    }
    if (last) break;
  }
  if (flow) vm.flow = flow;
  return output;
}

/** Warns when an unconditional return discards content before it. */
function warnForDiscardedContent(vm: Vm, joined: Value): void {
  const event = vm.flow;
  if (event?.kind !== 'return' || event.value === null || event.conditional || joined.type !== 'content') return;
  vm.warn(
    event.span,
    'this return unconditionally discards the content before it',
    'try omitting the `return` to automatically join all values',
  );
}

/** The character an escape sequence such as `\#` or `\u{2192}` stands for. */
function escapeChar(text: string): string {
  if (text.startsWith('\\u{')) {
    const hex = /^[0-9a-fA-F]*/.exec(text.slice(3))![0];
    const cp = hex === '' ? NaN : parseInt(hex, 16);
    return cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '\0';
  }
  return String.fromCodePoint(text.codePointAt(1) ?? 0);
}

/** Reads a binding, emitting its deprecation warning, like `Binding::read_checked`. */
export function readBinding(vm: Vm, binding: { value: Value; deprecation: string | null }, span: Span): Value {
  if (binding.deprecation !== null) vm.warn(span, binding.deprecation);
  return binding.value;
}

const I64_MAX = 2n ** 63n - 1n;

function evalInt(node: LinkedNode): Value {
  const n = intLiteral(node.text);
  // The lexer rejects larger literals.
  return intValue(n > I64_MAX ? 0n : n);
}

function evalNumeric(node: LinkedNode): Value {
  const [v, unit] = numericLiteral(node.text);
  switch (unit) {
    case 'pt':
      return { type: 'length', v: length(absPt(v), 0) };
    case 'mm':
      return { type: 'length', v: length(absMm(v), 0) };
    case 'cm':
      return { type: 'length', v: length(absCm(v), 0) };
    case 'in':
      return { type: 'length', v: length(absIn(v), 0) };
    case 'em':
      return { type: 'length', v: length(0, v) };
    case 'rad':
      return { type: 'angle', v };
    case 'deg':
      return { type: 'angle', v: angleDeg(v) };
    case 'fr':
      return { type: 'fraction', v };
    case '%':
      return { type: 'ratio', v: v / 100 };
  }
}

function evalArray(vm: Vm, node: LinkedNode): Value {
  const items: Value[] = [];
  const children = node.children().filter((child) => child.kind === K.Spread || isExpr(child));
  // All items are spreads of dictionaries until proven otherwise.
  let allDictSpreads = true;
  for (let i = 0; i < children.length; i++) {
    const item = children[i]!;
    if (item.kind !== K.Spread) {
      allDictSpreads = false;
      items.push(evalExpr(vm, item));
      continue;
    }
    const spread = item;
    const value = evalExpr(vm, firstExpr(spread));
    if (value.type === 'none') continue;
    if (value.type === 'array') {
      allDictSpreads = false;
      items.push(...value.v);
      continue;
    }
    if (
      value.type === 'dictionary' &&
      allDictSpreads &&
      children.slice(i + 1).every((rest) => rest.kind === K.Spread && safeIsDict(vm, rest))
    ) {
      const fixed = node.fullText().replace('(', '(: ');
      bailAt(spread.span, `cannot spread ${typeOf(value)} into array`, `add a colon to create a dictionary instead: \`${fixed}\``);
    }
    bailAt(spread.span, `cannot spread ${typeOf(value)} into array`);
  }
  return arrayValue(items);
}

function safeIsDict(vm: Vm, spread: LinkedNode): boolean {
  try {
    return evalExpr(vm, firstExpr(spread)).type === 'dictionary';
  } catch {
    return false;
  }
}

function evalDict(vm: Vm, node: LinkedNode): Value {
  const map = new Map<string, Value>();
  const invalidKeys: SourceError['diagnostics'] = [];
  for (const item of node.children()) {
    if (item.kind === K.Named) {
      const name = item.children().find((c) => c.kind === K.Ident)!.text;
      map.set(name, evalExpr(vm, lastExpr(item)));
    } else if (item.kind === K.Keyed) {
      const rawKey = firstExpr(item);
      const key = evalExpr(vm, rawKey);
      let name = '';
      try {
        name = at(rawKey.span, () => strCast.cast(key));
      } catch (e) {
        if (!(e instanceof SourceError)) throw e;
        invalidKeys.push(...e.diagnostics);
      }
      map.set(name, evalExpr(vm, lastExpr(item)));
    } else if (item.kind === K.Spread) {
      const value = evalExpr(vm, firstExpr(item));
      if (value.type === 'none') continue;
      if (value.type === 'dictionary') {
        for (const [k, v] of value.v) map.set(k, v);
        continue;
      }
      bailAt(item.span, `cannot spread ${typeOf(value)} into dictionary`);
    }
  }
  if (invalidKeys.length > 0) throw new SourceError(invalidKeys);
  return dictValue(map);
}

function evalUnary(vm: Vm, node: LinkedNode): Value {
  const value = evalExpr(vm, lastExpr(node));
  return at(node.span, () => {
    switch (unaryOp(node)) {
      case UnOp.Pos:
        return ops.pos(value);
      case UnOp.Neg:
        return ops.neg(value);
      case UnOp.Not:
        return ops.not(value);
    }
  });
}

const BINARY: Partial<Record<BinOp, (a: Value, b: Value) => Value>> = {
  [BinOp.Add]: ops.add,
  [BinOp.Sub]: ops.sub,
  [BinOp.Mul]: ops.mul,
  [BinOp.Div]: ops.div,
  [BinOp.And]: ops.and,
  [BinOp.Or]: ops.or,
  [BinOp.Eq]: ops.eq,
  [BinOp.Neq]: ops.neq,
  [BinOp.Lt]: ops.lt,
  [BinOp.Leq]: ops.leq,
  [BinOp.Gt]: ops.gt,
  [BinOp.Geq]: ops.geq,
  [BinOp.In]: ops.inOp,
  [BinOp.NotIn]: ops.notIn,
};

function evalBinary(vm: Vm, node: LinkedNode): Value {
  const op = binaryOp(node);
  const apply = BINARY[op];
  if (!apply) return unsupported(node.span, 'assignments');
  const lhs = evalExpr(vm, firstExpr(node));
  // Short-circuit boolean operations.
  if ((op === BinOp.And && lhs === FALSE) || (op === BinOp.Or && lhs === TRUE)) return lhs;
  const rhs = evalExpr(vm, lastExpr(node));
  try {
    return apply(lhs, rhs);
  } catch (e) {
    return rethrowAt(e, node.span);
  }
}

/** Accesses a field of a value, like Typst's `access_field` and `Value::field`. */
export function accessField(vm: Vm, target: Value, field: string, fieldSpan: Span): Value {
  return at(fieldSpan, () => {
    switch (target.type) {
      case 'symbol': {
        const [symbol, deprecation] = symbolModified(target.v, field);
        if (deprecation !== null) vm.warn(fieldSpan, deprecation);
        return { type: 'symbol', v: symbol };
      }
      case 'module':
        return readBinding(vm, moduleField(target.v, field), fieldSpan);
      case 'dictionary': {
        const value = target.v.get(field);
        if (value === undefined) bail(`dictionary does not contain key ${reprStr(field)}`);
        return value;
      }
      case 'arguments':
        return target.v.field(field);
      case 'content':
        return contentField(target.v, field);
      case 'function':
        return bail(
          target.v.name === null
            ? 'cannot access fields on user-defined functions'
            : `function \`${target.v.name}\` does not contain field \`${field}\``,
        );
      case 'length':
        if (field === 'em') return floatValue(target.v.em);
        if (field === 'abs') return { type: 'length', v: length(target.v.abs, 0) };
        return bail(`length does not contain field "${field}"`);
      case 'relative':
        if (field === 'ratio') return { type: 'ratio', v: target.v.rel };
        if (field === 'length') return { type: 'length', v: target.v.abs };
        return bail(`relative length does not contain field "${field}"`);
      case 'alignment':
        if (field === 'x') return target.v.x ? { type: 'alignment', v: { x: target.v.x } } : NONE;
        if (field === 'y') return target.v.y ? { type: 'alignment', v: { y: target.v.y } } : NONE;
        return bail(`alignment does not contain field "${field}"`);
      default:
        return bail(`cannot access fields on type ${typeOf(target)}`);
    }
  });
}

/** A field of content, like `Content::field_by_name`. */
function contentField(content: Content, field: string): Value {
  const record = content as unknown as Record<string, unknown>;
  const spec = ELEM_FIELDS[content.func].find(([name]) => name === field);
  if (!spec || INTERNAL_FIELDS.has(field)) bail(`${content.func} does not have field ${reprStr(field)}`);
  if (record[field] === undefined) bail(`field ${reprStr(field)} in ${content.func} is not known at this point`);
  return fieldValue(spec[1], record[field]);
}

/** Evaluates an expression and displays its value, like Typst's `eval_display`. */
export function evalDisplay(vm: Vm, node: LinkedNode): Content {
  return display(evalExpr(vm, node), node.span);
}
