import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderToResult, TypletError, typstVersion } from '../src/index.js';
import { corpusDir, type Formula, readJsonl } from './helpers.js';
import manifest from './browsers/visual-contract.json';
import { sourceHash, validateManifest, validateOracleSvgs, validateVisualContract } from './browsers/visual-contract.mjs';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isTypletError = (error: unknown) => error instanceof TypletError;
const realRenderer = { render: renderToResult, isTypletError, typstVersion };
const corpus = ['paired', 'features', 'typst-docs', 'levels'].flatMap((name) =>
  readJsonl<Formula>(`${corpusDir}/${name}.jsonl`).map((formula) => ({ ...formula, id: `${name}/${formula.id}` })),
);

function sample() {
  const formulas = [
    { id: 'sample/html', src: 'html', display: false },
    { id: 'sample/mathml', src: 'mathml', display: false },
    { id: 'sample/refused', src: 'error', display: false },
    { id: 'sample/skip', src: 'skip', display: false },
  ];
  const cases = formulas.map((formula) => ({
    id: formula.id, sourceHash: sourceHash(formula),
    expected: formula.src,
    ...(formula.src === 'error' ? { errorKind: 'unsupported' } : {}),
    ...(formula.src === 'skip' ? { reason: 'Oracle page contains preamble text.' } : {}),
  }));
  const contract = { schemaVersion: 1, typstVersion, cases };
  const render = (source: string) => {
    if (source === 'error') throw new TypletError('unsupported', [], source);
    return { drawnAs: source, markup: `<${source}>` };
  };
  const renderer = { render, isTypletError, typstVersion };
  return { formulas, contract, renderer };
}

describe('visual manifest', () => {
  it('locks the audited IDs, sources, modes and counts', () => {
    expect(validateManifest(manifest, typstVersion)).toBe(manifest);
    expect(manifest.cases).toHaveLength(507);
    expect(digest(manifest.cases.map(({ id, sourceHash }) => [id, sourceHash])))
      .toBe('7ce8ba9265e7a9ff0bc30fe2e704f31b7e02b1eae1e10eff1761ae8b896f6188');
    expect(digest(manifest.cases.map((entry) => [entry.id, entry.expected, 'errorKind' in entry ? entry.errorKind : null])))
      .toBe('153eec9f16bd75ba0111b32d35e326daa2a69f47de9354c7d501d899a3894de4');
    const counts: Record<string, number> = {};
    for (const entry of manifest.cases) counts[entry.expected] = (counts[entry.expected] ?? 0) + 1;
    expect(counts).toEqual({html: 406, mathml: 17, error: 83, skip: 1});
    for (const [id, expected] of [
      ['paired/show-rule', 'error'], ['paired/math-font', 'mathml'],
      ['features/text-tab', 'mathml'], ['levels/preamble-text', 'skip'],
    ]) expect(manifest.cases.find((entry) => entry.id === id)?.expected).toBe(expected);
    expect(manifest.cases.find((entry) => entry.id === 'paired/show-rule')).toHaveProperty('errorKind', 'unsupported');
  });

  it('checks the actual corpus against the source renderer before a build', () => {
    expect(validateVisualContract(corpus, manifest, realRenderer)).toHaveLength(406);
  });

  it('rejects duplicate manifest IDs', () => {
    const { contract } = sample();
    contract.cases.splice(1, 0, structuredClone(contract.cases[0]!));
    expect(() => validateManifest(contract, typstVersion)).toThrow('sample/html: expected one manifest entry, actual duplicate ID');
  });

  it('rejects unsupported schema or Typst versions', () => {
    const { contract } = sample();
    expect(() => validateManifest({ ...contract, schemaVersion: 2 }, typstVersion)).toThrow('expected schema 1');
    expect(() => validateManifest(contract, '0.15.2')).toThrow('expected schema 1 for Typst 0.15.2');
  });

  it('requires hashes, valid modes, error kinds and skip reasons', () => {
    const { contract } = sample();
    const changed = structuredClone(contract);
    changed.cases[0]!.sourceHash = 'invalid';
    expect(() => validateManifest(changed, typstVersion)).toThrow('sample/html: expected a SHA256 sourceHash');
    changed.cases[0] = { ...contract.cases[0]!, expected: 'fallback' };
    expect(() => validateManifest(changed, typstVersion)).toThrow('actual fallback');
    changed.cases[0] = structuredClone(contract.cases[0]!);
    delete changed.cases[2]!.errorKind;
    expect(() => validateManifest(changed, typstVersion)).toThrow('sample/refused: expected an errorKind');
    changed.cases[2] = structuredClone(contract.cases[2]!);
    changed.cases[3]!.reason = ' ';
    expect(() => validateManifest(changed, typstVersion)).toThrow('sample/skip: expected a nonempty reason');
  });
});

describe('visual rendering contract', () => {
  it('selects exactly the expected HTML records and skips only reviewed exclusions', () => {
    const { formulas, contract, renderer } = sample();
    const seen: string[] = [];
    const render = (source: string) => { seen.push(source); return renderer.render(source); };
    expect(validateVisualContract(formulas, contract, { ...renderer, render }))
      .toEqual([{ ...formulas[0], html: '<html>' }]);
    expect(seen).toEqual(['html', 'mathml', 'error']);
  });

  it('rejects a missing corpus ID', () => {
    const { formulas, contract, renderer } = sample();
    formulas.pop();
    expect(() => validateVisualContract(formulas, contract, renderer)).toThrow('sample/skip: expected corpus record, actual missing ID');
  });

  it('rejects an extra corpus ID', () => {
    const { formulas, contract, renderer } = sample();
    formulas.push({ id: 'sample/new', src: 'html', display: false });
    expect(() => validateVisualContract(formulas, contract, renderer)).toThrow('sample/new: expected no extra corpus ID, actual unexpected ID');
  });

  it('rejects a replaced corpus ID even when the total count is unchanged', () => {
    const { formulas, contract, renderer } = sample();
    formulas[0]!.id = 'sample/replacement';
    expect(() => validateVisualContract(formulas, contract, renderer)).toThrow('sample/replacement: expected no extra corpus ID, actual unexpected ID');
  });

  it('rejects a duplicate corpus ID', () => {
    const { formulas, contract, renderer } = sample();
    formulas.push(structuredClone(formulas[0]!));
    expect(() => validateVisualContract(formulas, contract, renderer)).toThrow('sample/html: expected one corpus record, actual duplicate ID');
  });

  it.each(['src', 'preamble', 'display'] as const)('rejects a changed %s before rendering', (field) => {
    const { formulas, contract, renderer } = sample();
    const changed = formulas as (Formula & { id: string })[];
    if (field === 'display') changed[0]![field] = true;
    else changed[0]![field] = 'changed source';
    expect(() => validateVisualContract(changed, contract, renderer)).toThrow('sample/html: expected sourceHash');
  });

  it('rejects an HTML formula falling back to MathML', () => {
    const { formulas, contract, renderer } = sample();
    const render = (source: string) => source === 'html' ? { drawnAs: 'mathml', markup: '' } : renderer.render(source);
    expect(() => validateVisualContract(formulas, contract, { ...renderer, render })).toThrow('sample/html: expected html, actual mathml');
  });

  it('requires review when a MathML formula starts drawing HTML', () => {
    const { formulas, contract, renderer } = sample();
    const render = (source: string) => source === 'mathml' ? { drawnAs: 'html', markup: '' } : renderer.render(source);
    expect(() => validateVisualContract(formulas, contract, { ...renderer, render })).toThrow('sample/mathml: expected mathml, actual html');
  });

  it('rejects exchanged drawing modes even when both mode counts are unchanged', () => {
    const { formulas, contract, renderer } = sample();
    const render = (source: string) => {
      if (source === 'html' || source === 'mathml') return { drawnAs: source === 'html' ? 'mathml' : 'html', markup: '' };
      return renderer.render(source);
    };
    expect(() => validateVisualContract(formulas, contract, { ...renderer, render })).toThrow('sample/html: expected html, actual mathml');
  });

  it('rejects changed TypletError kinds', () => {
    const { formulas, contract, renderer } = sample();
    const render = (source: string) => {
      if (source === 'error') throw new TypletError('eval', [], source);
      return renderer.render(source);
    };
    expect(() => validateVisualContract(formulas, contract, { ...renderer, render })).toThrow('sample/refused: expected error/unsupported, actual error/eval');
  });

  it('rejects unexpected native errors even for an expected error case', () => {
    const { formulas, contract, renderer } = sample();
    const render = (source: string) => {
      if (source === 'error') throw new RangeError('test failure');
      return renderer.render(source);
    };
    expect(() => validateVisualContract(formulas, contract, { ...renderer, render })).toThrow('sample/refused: expected error/unsupported, actual native exception: test failure');
  });

  it('does not mistake errors with a matching name and kind for the injected class', () => {
    const { formulas, contract, renderer } = sample();
    const render = (source: string) => {
      if (source === 'error') throw Object.assign(new Error('impostor'), { name: 'TypletError', kind: 'unsupported' });
      return renderer.render(source);
    };
    expect(() => validateVisualContract(formulas, contract, { ...renderer, render })).toThrow('actual native exception: impostor');
  });

  it('normalizes absent or whitespace-only preambles in the source hash', () => {
    const { formulas } = sample();
    expect(sourceHash({ ...formulas[0]!, preamble: '  ' })).toBe(sourceHash(formulas[0]!));
  });
});

describe('visual oracle SVG contract', () => {
  const formulas = [{ id: 'first' }, { id: 'second' }];
  const records = [{ id: 'first', svg: '<svg>first</svg>' }, { id: 'second', svg: '<svg>second</svg>' }];

  it('matches by ID when oracle records arrive out of order', () => {
    const svgs = validateOracleSvgs(formulas, [...records].reverse());
    expect(formulas.map(({ id }) => svgs.get(id))).toEqual(['<svg>first</svg>', '<svg>second</svg>']);
  });

  it('rejects missing SVG records', () => {
    expect(() => validateOracleSvgs(formulas, records.slice(1))).toThrow('first: expected oracle SVG, actual missing ID');
  });

  it('rejects duplicate SVG records', () => {
    expect(() => validateOracleSvgs(formulas, [records[0]!, records[0]!, records[1]!])).toThrow('first: expected one oracle SVG, actual duplicate ID');
  });

  it('rejects unknown oracle IDs', () => {
    expect(() => validateOracleSvgs(formulas, [...records, { id: 'extra', svg: '<svg/>' }])).toThrow('extra: expected a requested oracle ID, actual unknown ID');
  });

  it.each([undefined, null, '', '  '])('rejects an empty or missing SVG %j', (svg) => {
    expect(() => validateOracleSvgs(formulas, [{ id: 'first', svg }, records[1]!])).toThrow('first: expected nonempty SVG');
  });

  it.each(['error', 'panic'])('rejects an oracle %s record', (field) => {
    expect(() => validateOracleSvgs(formulas, [{ ...records[0], [field]: 'oracle failed' }, records[1]!])).toThrow('first: expected SVG, actual oracle error/panic');
  });
});
