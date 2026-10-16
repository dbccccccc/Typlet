import { createHash } from 'node:crypto';

/** @typedef {{ id: string, src: string, display: boolean, preamble?: string }} Formula */
/** @typedef {{ id: string, sourceHash: string, expected: 'html' | 'mathml' | 'error' | 'skip', errorKind?: string, reason?: string }} ContractCase */
/** @typedef {{ schemaVersion: 1, typstVersion: string, cases: ContractCase[] }} VisualContract */
/** @typedef {Formula & { html: string }} HtmlFormula */

/** Hashes exactly the source inputs that affect the formula's rendering. @param {Formula} formula */
export function sourceHash(formula) {
  return createHash('sha256')
    .update(JSON.stringify([formula.id, formula.src, Boolean(formula.display), formula.preamble?.trim() ? formula.preamble : '']))
    .digest('hex');
}

/**
 * Validates review data independently of the renderer and corpus.
 * @param {unknown} raw
 * @param {string} typstVersion
 * @returns {VisualContract}
 */
export function validateManifest(raw, typstVersion) {
  const manifest = /** @type {VisualContract} */ (raw);
  if (!manifest || manifest.schemaVersion !== 1 || manifest.typstVersion !== typstVersion || !Array.isArray(manifest.cases)) {
    throw new Error(`visual manifest: expected schema 1 for Typst ${typstVersion}`);
  }
  const ids = new Set();
  let previous = '';
  for (const entry of manifest.cases) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) throw new Error('visual manifest: expected a nonempty ID');
    const { id } = entry;
    if (ids.has(id)) throw new Error(`${id}: expected one manifest entry, actual duplicate ID`);
    if (id < previous) throw new Error(`${id}: expected manifest IDs in JavaScript string order`);
    ids.add(id);
    previous = id;
    if (typeof entry.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sourceHash)) {
      throw new Error(`${id}: expected a SHA256 sourceHash`);
    }
    if (!['html', 'mathml', 'error', 'skip'].includes(entry.expected)) {
      throw new Error(`${id}: expected html/mathml/error/skip, actual ${entry.expected}`);
    }
    if (entry.expected === 'error' ? !['syntax', 'eval', 'unsupported', 'limit'].includes(entry.errorKind ?? '') : entry.errorKind !== undefined) {
      throw new Error(`${id}: expected an errorKind only for an error case`);
    }
    if (entry.expected === 'skip' ? typeof entry.reason !== 'string' || !entry.reason.trim() : entry.reason !== undefined) {
      throw new Error(`${id}: expected a nonempty reason only for a skip case`);
    }
  }
  return manifest;
}

/**
 * Checks all inputs and drawing modes before returning the HTML sample set.
 * The caller supplies its renderer's error identity, so source and dist classes
 * are never confused and native errors cannot silently remove samples.
 * @param {Formula[]} formulas
 * @param {unknown} rawManifest
 * @param {{ typstVersion: string, render: (source: string, options: object) => { drawnAs: string, markup: string }, isTypletError: (error: unknown) => boolean }} renderer
 * @returns {HtmlFormula[]}
 */
export function validateVisualContract(formulas, rawManifest, renderer) {
  const manifest = validateManifest(rawManifest, renderer.typstVersion);
  const expected = new Map(manifest.cases.map((entry) => [entry.id, entry]));
  const inputs = new Map();
  for (const formula of formulas) {
    if (inputs.has(formula.id)) throw new Error(`${formula.id}: expected one corpus record, actual duplicate ID`);
    if (!expected.has(formula.id)) throw new Error(`${formula.id}: expected no extra corpus ID, actual unexpected ID`);
    inputs.set(formula.id, formula);
  }
  for (const entry of manifest.cases) {
    const formula = inputs.get(entry.id);
    if (!formula) throw new Error(`${entry.id}: expected corpus record, actual missing ID`);
    const hash = sourceHash(formula);
    if (hash !== entry.sourceHash) throw new Error(`${entry.id}: expected sourceHash ${entry.sourceHash}, actual ${hash}`);
  }
  const html = [];
  for (const formula of formulas) {
    const entry = expected.get(formula.id);
    if (entry.expected === 'skip') continue;
    const wanted = entry.expected === 'error' ? `error/${entry.errorKind}` : entry.expected;
    let actual;
    let result;
    try {
      result = renderer.render(formula.src, {
        output: 'html', displayMode: Boolean(formula.display), strict: 'ignore', trust: true,
        preamble: formula.preamble?.trim() ? formula.preamble : undefined,
      });
      actual = result.drawnAs;
    } catch (error) {
      if (!renderer.isTypletError(error)) {
        throw new Error(`${formula.id}: expected ${wanted}, actual native exception: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      actual = `error/${/** @type {{ kind: string }} */ (error).kind}`;
    }
    if (actual !== wanted) throw new Error(`${formula.id}: expected ${wanted}, actual ${actual}`);
    if (actual === 'html') html.push({ ...formula, html: result.markup });
  }
  return html;
}

/**
 * Matches oracle records by ID, refusing every way a sample could disappear.
 * @param {{ id: string }[]} formulas
 * @param {{ id?: string, svg?: unknown, error?: unknown, panic?: unknown }[]} records
 * @returns {Map<string, string>}
 */
export function validateOracleSvgs(formulas, records) {
  const expected = new Set(formulas.map((formula) => formula.id));
  const svgs = new Map();
  for (const record of records) {
    const id = record?.id;
    if (!expected.has(id)) throw new Error(`${id ?? '<missing ID>'}: expected a requested oracle ID, actual unknown ID`);
    if (svgs.has(id)) throw new Error(`${id}: expected one oracle SVG, actual duplicate ID`);
    if ('error' in record || 'panic' in record) throw new Error(`${id}: expected SVG, actual oracle error/panic`);
    if (typeof record.svg !== 'string' || !record.svg.trim()) throw new Error(`${id}: expected nonempty SVG, actual empty or invalid SVG`);
    svgs.set(id, record.svg);
  }
  for (const id of expected) {
    if (!svgs.has(id)) throw new Error(`${id}: expected oracle SVG, actual missing ID`);
  }
  return svgs;
}
