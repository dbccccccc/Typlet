// Typlet original: not ported from Typst.
//
// Typst declares elements with the `#[elem]` macro (typst-macros, elem.rs),
// which generates a constructor from the field declarations: required fields
// are taken positionally with `args.expect`, variadic ones with `args.all`,
// optional positional ones with `args.find` and the rest by name with
// `args.named`, all in declaration order. `elemFunc` does the same from a list
// of field specs, which also describe the parameters for comparison with
// Typst's.

import type { Args } from '../eval/args.js';
import type { Cast } from '../eval/cast.js';
import type { Content, ElemName } from '../eval/content.js';
import { type Engine, type Func, type ParamInfo, param } from '../eval/func.js';
import { type Property, get, property, type StyleChain } from '../eval/styles.js';
import { type Value, contentValue } from '../eval/value.js';

export interface FieldSpec {
  readonly name: string;
  readonly cast: Cast<unknown>;
  readonly kind: 'required' | 'positional' | 'named' | 'variadic';
  /** The default as a value, for the parameter description. */
  readonly default?: () => Value;
  /**
   * Custom argument parsing, like a field's `#[parse]` attribute. `scratch` is
   * fresh for each call, for parsers that share a variable.
   */
  readonly parse?: (args: Args, engine: Engine, scratch: Record<string, unknown>) => unknown;
  /** A parameter that is not stored as a field, like `mat`'s `gap`. */
  readonly external?: boolean;
  /** Whether set rules can set the field; by default, optional fields are settable. */
  readonly settable?: boolean;
}

/** Builds an element function from its field specs. */
export function elemFunc(name: ElemName, fields: readonly FieldSpec[]): Func {
  const params: ParamInfo[] = fields.map((f) =>
    param(f.name, f.cast, f.kind, {
      settable: f.settable ?? (f.kind === 'named' || f.kind === 'positional'),
      ...(f.default ? { default: f.default } : {}),
    }),
  );
  return {
    name,
    elem: name,
    params,
    call(engine, args) {
      const elem: Record<string, unknown> = { func: name, span: null };
      const scratch: Record<string, unknown> = {};
      for (const f of fields) {
        if (f.external && !f.parse) continue;
        const value = f.parse
          ? f.parse(args, engine, scratch)
          : f.kind === 'variadic'
            ? args.all(f.cast)
            : f.kind === 'required'
              ? args.expect(f.name, f.cast)
              : f.kind === 'positional'
                ? args.find(f.cast)
                : args.named(f.name, f.cast);
        if (value !== undefined && !f.external) elem[f.name] = value;
      }
      return contentValue(elem as unknown as Content);
    },
    // The settable fields, parsed as the constructor parses them. Parsers of
    // other fields only run for what they share, like `mat`'s `gap`.
    set(engine, args) {
      const styles: Property[] = [];
      const scratch: Record<string, unknown> = {};
      for (const [i, f] of fields.entries()) {
        if (!params[i]!.settable) {
          if (f.external && f.parse) f.parse(args, engine, scratch);
          continue;
        }
        const value = f.parse
          ? f.parse(args, engine, scratch)
          : f.kind === 'positional'
            ? args.find(f.cast)
            : args.named(f.name, f.cast);
        if (value !== undefined && !f.external) styles.push(property(name, f.name, value));
      }
      return styles;
    },
  };
}

/**
 * The value of an element's field: its own value if set, else the innermost
 * one from a set rule, else the default. Like Typst's `elem.field.get(styles)`.
 */
export function fieldOr<T>(own: T | undefined, styles: StyleChain, elem: ElemName, field: string, fallback: T): T {
  return own !== undefined ? own : get(styles, elem, field, fallback);
}
