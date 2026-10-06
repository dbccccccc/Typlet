// Ported from Typst 0.15.1: crates/typst-eval/src/call.rs, crates/typst-library/src/foundations/func.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

import { type LinkedNode, firstExpr, lastExpr } from '../syntax/ast.js';
import { SyntaxKind } from '../syntax/kind.js';
import type { Arg, Args } from './args.js';
import { destructure, isPattern, letParts, patternBindings, sinkIdent } from './binding.js';
import { valueCast } from './cast.js';
import { evalExpr } from './code.js';
import { SourceError } from './diag.js';
import type { Engine, Func } from './func.js';
import { type Binding, type Library, Scope, Scopes } from './scope.js';
import { type Value, NONE, funcValue } from './value.js';
import { Vm, forbidden } from './vm.js';

const K = SyntaxKind;

/** A closure's parameter: `x`, `(a, b)`, `y: 2` or `..rest`. */
type Param =
  | { readonly kind: 'pos'; readonly pattern: LinkedNode }
  | { readonly kind: 'named'; readonly name: LinkedNode; readonly expr: LinkedNode }
  | { readonly kind: 'spread'; readonly sink: LinkedNode | null };

/** The name of a closure defined with `let f(x) = ..`, like `Closure::name`. */
function closureName(node: LinkedNode): LinkedNode | null {
  const first = node.children()[0];
  return first?.kind === K.Ident ? first : null;
}

/** The parameters of a closure, like `Params::children`. */
function closureParams(node: LinkedNode): Param[] {
  const params = node.children().find((child) => child.kind === K.Params)!;
  return params.children().flatMap((child): Param[] => {
    if (child.kind === K.Named) {
      return [{ kind: 'named', name: child.children().find((c) => c.kind === K.Ident)!, expr: lastExpr(child) }];
    }
    if (child.kind === K.Spread) return [{ kind: 'spread', sink: sinkIdent(child) }];
    return isPattern(child) ? [{ kind: 'pos', pattern: child }] : [];
  });
}

/** Evaluates a closure expression to a function, like `Eval for ast::Closure`. */
export function evalClosure(vm: Vm, node: LinkedNode): Value {
  const params = closureParams(node);
  // The defaults of named parameters are evaluated where the closure is defined.
  const defaults: Value[] = [];
  for (const param of params) if (param.kind === 'named') defaults.push(evalExpr(vm, param.expr));

  const visitor = new CapturesVisitor(vm.scopes);
  visitor.visit(node);
  const captured = visitor.captures;

  const name = closureName(node);
  const body = lastExpr(node);
  const numPosParams = params.filter((p) => p.kind === 'pos').length;
  const library = vm.library;
  const func: Func = {
    name: name?.text ?? null,
    params: [],
    call: (engine, args) => callClosure(func, engine, library, name, params, defaults, numPosParams, body, captured, args),
  };
  return funcValue(func);
}

/** Calls a closure with arguments, like `eval_closure`. */
function callClosure(
  func: Func,
  engine: Engine,
  library: Library,
  name: LinkedNode | null,
  params: readonly Param[],
  defaults: readonly Value[],
  numPosParams: number,
  body: LinkedNode,
  captured: Scope,
  args: Args,
): Value {
  // The scopes of the call site don't leak in: only the captured variables
  // and the library are visible. Typst copies the captured variables into
  // the call's scope; an outer scope that the call never changes does the same.
  const scopes = new Scopes(library);
  scopes.scopes.push(captured);
  const vm = new Vm(engine, library, scopes);

  // The closure itself, for recursive calls.
  if (name) vm.define(name.text, name.span, funcValue(func));

  const numPosArgs = args.remaining();
  const sinkSize = numPosArgs >= numPosParams ? numPosArgs - numPosParams : null;
  let sink: LinkedNode | null | undefined;
  let sinkPosValues: Arg[] | null = null;
  let d = 0;
  for (const param of params) {
    if (param.kind === 'pos') {
      if (param.pattern.kind === K.Ident) {
        vm.define(param.pattern.text, param.pattern.span, args.expect(param.pattern.text, valueCast));
      } else {
        destructure(vm, param.pattern, args.expect('pattern parameter', valueCast));
      }
    } else if (param.kind === 'spread') {
      sink = param.sink;
      if (sinkSize !== null) sinkPosValues = args.consume(sinkSize);
    } else {
      const value = args.named(param.name.text, valueCast) ?? defaults[d]!;
      d++;
      vm.define(param.name.text, param.name.span, value);
    }
  }

  if (sink !== undefined) {
    // The remaining arguments go to the sink, whether or not it is named.
    const remaining = args.take();
    if (sink !== null) {
      if (sinkPosValues) remaining.items.push(...sinkPosValues);
      vm.define(sink.text, sink.span, { type: 'arguments', v: remaining });
    }
  }

  // All arguments must be used.
  args.finish();

  engine.depth++;
  try {
    const output = evalExpr(vm, body);
    const flow = vm.flow;
    if (flow) {
      if (flow.kind !== 'return') throw new SourceError([forbidden(flow)]);
      if (flow.value !== null) return flow.value;
    }
    return output;
  } finally {
    engine.depth--;
  }
}

/** Finds the variables a closure captures, like Typst's `CapturesVisitor`. */
class CapturesVisitor {
  /** The names bound inside the closure; only their scoping matters. */
  private readonly internal = new Scopes(null);
  readonly captures = new Scope();

  constructor(private readonly external: Scopes) {}

  visit(node: LinkedNode): void {
    switch (node.kind) {
      case K.Ident:
        return this.capture(node.text, (scopes) => scopes.get(node.text, null));
      case K.MathIdent:
        return this.capture(node.text, (scopes) => scopes.getInMath(node.text, null));

      // Code and content blocks create a scope.
      case K.CodeBlock:
      case K.ContentBlock:
        this.internal.enter();
        for (const child of node.children()) this.visit(child);
        this.internal.exit();
        return;

      // The field of a field access is not a variable.
      case K.FieldAccess:
      case K.MathFieldAccess:
        return this.visit(firstExpr(node));

      // Parameters are bound before the body is evaluated, but the defaults
      // of named parameters can't see them.
      case K.Closure: {
        const params = closureParams(node);
        for (const param of params) if (param.kind === 'named') this.visit(param.expr);
        this.internal.enter();
        const name = closureName(node);
        if (name) this.bind(name);
        for (const param of params) {
          if (param.kind === 'pos') for (const ident of patternBindings(param.pattern)) this.bind(ident);
          else if (param.kind === 'named') this.bind(param.name);
          else if (param.sink) this.bind(param.sink);
        }
        this.visit(lastExpr(node));
        this.internal.exit();
        return;
      }

      // A binding is active only after its initializer.
      case K.LetBinding: {
        const { closure, pattern, init } = letParts(node);
        if (init) this.visit(init);
        if (closure) this.bind(closure);
        if (pattern) for (const ident of patternBindings(pattern)) this.bind(ident);
        return;
      }

      // A loop's pattern is active in its body.
      case K.ForLoop: {
        const children = node.children().filter(isPattern);
        const [pattern, iterable, loopBody] = [children[0]!, children[1]!, children[2]!];
        this.visit(iterable);
        this.internal.enter();
        for (const ident of patternBindings(pattern)) this.bind(ident);
        this.visit(loopBody);
        this.internal.exit();
        return;
      }

      // The name of a named pair is not a variable.
      case K.Named:
        return this.visit(lastExpr(node));

      default:
        for (const child of node.children()) this.visit(child);
    }
  }

  private bind(ident: LinkedNode): void {
    this.internal.top.define(ident.text, NONE);
  }

  private capture(name: string, getter: (scopes: Scopes) => Binding): void {
    if (this.internal.local(name)) return;
    let binding: Binding;
    try {
      binding = getter(this.external);
    } catch {
      return;
    }
    this.captures.bind(name, binding);
  }
}
