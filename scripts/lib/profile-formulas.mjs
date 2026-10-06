// Finds the functions of a bundle that rendering the typical formulas calls.
// scripts/build.mjs runs it in a process of its own, which imports only the
// bundle:
//
//   node scripts/lib/profile-formulas.mjs <bundle.mjs>
//
// It prints one JSON object:
// - `functions`: the `{ start, end }` offsets in the bundle of each function
//   called, as V8's coverage reports them, for scripts/lib/eager.mjs;
// - `digest`: a hash of what the formulas rendered to, which tells whether
//   another build of the bundle renders them the same.

import { createHash } from 'node:crypto';
import { Session } from 'node:inspector';
import { pathToFileURL } from 'node:url';
import { TYPICAL_FORMULAS } from './typical-formulas.mjs';

const url = pathToFileURL(process.argv[2]).href;
const session = new Session();
session.connect();
// The session is in this process, so its replies arrive before `post` returns.
function post(method, params) {
  let reply;
  session.post(method, params, (error, result) => {
    if (error) throw error;
    reply = result;
  });
  return reply;
}
/** The functions of the bundle called since the last call. */
function called() {
  const { result } = post('Profiler.takePreciseCoverage');
  const functions = result.find((script) => script.url === url)?.functions ?? [];
  return functions.map((f) => f.ranges[0]).filter((range) => range.count > 0);
}

post('Profiler.enable');
post('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
const { renderToString } = await import(url);
// What importing the bundle calls is compiled by then anyway.
called();

const digest = createHash('sha256');
for (const { src, display = false } of TYPICAL_FORMULAS) {
  digest.update(renderToString(src, { displayMode: display, strict: 'error' }));
}
const functions = called().map((range) => ({ start: range.startOffset, end: range.endOffset }));
console.log(JSON.stringify({ functions, digest: digest.digest('hex') }));
