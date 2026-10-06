// Generates test fixtures by running the oracle over the corpus (docs/DESIGN.md §5.1).
//
//   node tools/fixtures.mjs           regenerate test/fixtures/typst-<version>/
//   node tools/fixtures.mjs --check   fail if the committed fixtures are stale
//   node tools/fixtures.mjs --local   also run test/corpus/local/ (not committed)
//   node tools/fixtures.mjs --only levels,expressions   only these corpora
//
// Requires the oracle: `npm run oracle:build`.

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonl, writeJsonl } from './lib/jsonl.mjs';
import { oracleVersion, runOracle } from './lib/oracle.mjs';

const root = resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');
const local = process.argv.includes('--local');
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg === -1 ? null : new Set(process.argv[onlyArg + 1].split(','));

// SVG is left out: it is large, and visual tests render it when they need it.
const OUTPUTS = 'cst,content,mathml,frame,diagnostics';

const typstVersion = oracleVersion();
const pinned = /typstVersion = '([^']+)'/.exec(readFileSync(join(root, 'src/version.ts'), 'utf8'))[1];
if (typstVersion !== pinned) {
  throw new Error(`The oracle runs Typst ${typstVersion}, but src/version.ts pins ${pinned}.`);
}

const jobs = readdirSync(join(root, 'test/corpus'))
  .filter((f) => f.endsWith('.jsonl') && (!only || only.has(f.slice(0, -'.jsonl'.length))))
  .sort()
  .map((f) => ({ corpus: join(root, 'test/corpus', f), fixture: join(root, `test/fixtures/typst-${typstVersion}`, f) }));
if (local && existsSync(join(root, 'test/corpus/local'))) {
  for (const f of readdirSync(join(root, 'test/corpus/local')).filter((f) => f.endsWith('.jsonl'))) {
    jobs.push({ corpus: join(root, 'test/corpus/local', f), fixture: join(root, 'test/fixtures/local', f) });
  }
}

let stale = 0;
for (const { corpus, fixture } of jobs) {
  const records = readJsonl(corpus);
  const started = performance.now();
  // Syntax edge cases only need the syntax tree, in their own parsing mode.
  const args = corpus.endsWith('syntax.jsonl') ? ['parse'] : ['run', '--outputs', OUTPUTS];
  const results = runOracle(args, records);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);

  const failed = results.filter((r) => r.panic !== undefined || r.error !== undefined);
  for (const r of failed) console.error(`  ${r.id ?? '?'}: ${r.panic ?? r.error}`);

  const name = fixture.slice(root.length + 1).replaceAll('\\', '/');
  if (check) {
    const expected = existsSync(fixture) ? readFileSync(fixture, 'utf8') : '';
    const tmp = `${fixture}.check`;
    writeJsonl(tmp, results);
    const actual = readFileSync(tmp, 'utf8');
    (await import('node:fs')).rmSync(tmp);
    if (actual !== expected) {
      stale++;
      console.error(`STALE ${name}`);
    } else {
      console.log(`ok    ${name}`);
    }
  } else {
    mkdirSync(resolve(fixture, '..'), { recursive: true });
    writeJsonl(fixture, results);
    console.log(`${name}: ${results.length} records in ${seconds} s${failed.length ? `, ${failed.length} failed` : ''}`);
  }
}

if (check && stale > 0) {
  console.error(`${stale} fixture file(s) are stale. Run \`npm run fixtures\` and commit the result.`);
  process.exit(1);
}
