import { describe, expect, it } from 'vitest';
import type { CastInfo } from '../src/eval/cast.js';
import type { Func } from '../src/eval/func.js';
import { LIBRARY } from '../src/eval/library.js';
import { longName, repr } from '../src/eval/value.js';
import { fixtureDir, readJsonl } from './helpers.js';

interface TypstParam {
  name: string;
  input: string[];
  positional: boolean;
  named: boolean;
  variadic: boolean;
  required: boolean;
  settable: boolean;
  default?: string;
}

interface TypstName {
  scope: 'global' | 'math';
  name: string;
  type: string;
  params?: TypstParam[];
}

const names = readJsonl<TypstName>(`${fixtureDir}/names.jsonl`);

/** The leaves of a cast info, as the oracle lists them: type names and value reprs. */
function leaves(info: CastInfo): string[] {
  if (info.kind === 'union') return info.infos.flatMap(leaves);
  if (info.kind === 'any') return ['any'];
  if (info.kind === 'value') return [repr(info.value)];
  return [info.type];
}

function signature(func: Func): TypstParam[] {
  return func.params.map((p) => ({
    name: p.name,
    input: leaves(p.cast.info),
    positional: p.positional,
    named: p.named,
    variadic: p.variadic,
    required: p.required,
    settable: p.settable,
    ...(p.default ? { default: repr(p.default()) } : {}),
  }));
}

// Functions Typlet refuses as a whole, with the level that brings them.
const REFUSED = new Set<string>();

describe('math scope', () => {
  const math = names.filter((n) => n.scope === 'math');

  it('has every name of Typst’s math scope, with the same type', () => {
    const missing = math.filter((n) => !LIBRARY.math.scope.has(n.name)).map((n) => n.name);
    expect(missing).toEqual([]);
    const types = math
      .filter((n) => LIBRARY.math.scope.get(n.name)!.value.type !== n.type)
      .map((n) => `${n.name}: ${n.type} vs ${LIBRARY.math.scope.get(n.name)!.value.type}`);
    expect(types).toEqual([]);
  });

  it.each(math.filter((n) => n.params && !REFUSED.has(n.name)).map((n) => [n.name, n] as const))(
    '%s takes Typst’s parameters',
    (_, typst) => {
      const value = LIBRARY.math.scope.get(typst.name)!.value;
      if (value.type !== 'function') throw new Error(`${typst.name} is not a function`);
      expect(signature(value.v)).toEqual(
        typst.params!.map((p) => ({ ...p, input: p.input })),
      );
    },
  );
});

describe('global scope', () => {
  const global = names.filter((n) => n.scope === 'global');

  it.each(['h', 'rgb', 'luma', 'text', 'strong', 'emph', 'highlight', 'box', 'hide', 'link'])('%s takes Typst’s parameters', (name) => {
    const typst = global.find((n) => n.name === name)!;
    const value = LIBRARY.global.scope.get(name)!.value;
    if (value.type !== 'function') throw new Error(`${name} is not a function`);
    expect(signature(value.v)).toEqual(typst.params);
  });

  it('defines Typst’s values for the names it has', () => {
    for (const name of LIBRARY.global.scope.names()) {
      const typst = global.find((n) => n.name === name);
      expect(typst, name).toBeDefined();
      expect(LIBRARY.global.scope.get(name)!.value.type, name).toBe(typst!.type);
    }
  });

  it('names types as Typst does in messages', () => {
    expect(longName('int')).toBe('integer');
    expect(longName('relative')).toBe('relative length');
  });
});
