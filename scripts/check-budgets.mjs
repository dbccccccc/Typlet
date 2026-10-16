// Checks that the built bundle stops abusive formulas and finishes bounded
// computations within 50 ms (docs/DESIGN.md §6.8): each is rendered once to
// warm up, then five times, and the median time counts. Every case runs in a
// separate 128 MiB child process with a five-second hard deadline.
//
//   npm run build && node scripts/check-budgets.mjs

import { BOUNDED_CASES, BUDGET_CASES, ISOLATED_BUDGET_CASES, TYPST_LIMIT_CASES } from '../test/budget-cases.mjs';
import { runBudgetCase } from './lib/budget-runner.mjs';

const LIMIT_MS = 50;
const jobs = [
  ...BUDGET_CASES.map(([name, source, options]) => ({ name, source, options, expect: { kind: 'error', errorKind: 'limit' } })),
  ...TYPST_LIMIT_CASES.map(([name, source, options, errorKind, message]) => ({ name, source, options, expect: { kind: 'error', errorKind, message } })),
  ...BOUNDED_CASES.map(([name, source, options, contains]) => ({ name, source, options, expect: { kind: 'success', contains } })),
  ...ISOLATED_BUDGET_CASES,
];

let failures = 0;
for (const job of jobs) {
  const result = await runBudgetCase(job);
  if (!result.ok) {
    failures++;
    console.error(`FAIL ${job.name}: ${result.reason}`);
    continue;
  }
  const ok = result.medianMs < LIMIT_MS;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'SLOW'} ${job.name.padEnd(36)} ${result.medianMs.toFixed(1).padStart(6)} ms (${result.observed.kind}${result.observed.kind === 'error' ? '/' + result.observed.errorKind : ''}; ${result.samples} samples)`);
}
if (failures > 0) {
  console.error(`${failures} budget case(s) failed classification, isolation or the ${LIMIT_MS} ms median limit`);
  process.exitCode = 1;
}
