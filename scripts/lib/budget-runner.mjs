// Typlet original: not ported from Typst.

import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** @typedef {{ kind: 'success', contains?: string } | { kind: 'error', errorKind: string, message?: string }} Expectation */
/** @typedef {{ name: string, source: string, options: object, expect: Expectation, entry?: string, verifyRecovery?: boolean }} BudgetJob */
/** @typedef {{ kind: 'success' } | { kind: 'error', errorKind: string, message: string }} Observation */
/** @typedef {{ type: 'result', samples: number, medianMs: number, observed: Observation }} Reply */

/** @param {unknown} raw @param {Expectation} expected @returns {raw is Reply} */
function validReply(raw, expected) {
  const reply = /** @type {Reply} */ (raw);
  if (!reply || reply.type !== 'result' || reply.samples !== 5 || !Number.isFinite(reply.medianMs) || reply.medianMs < 0) return false;
  const observed = reply.observed;
  if (!observed || observed.kind !== expected.kind) return false;
  return expected.kind === 'success' || (
    observed.kind === 'error' && observed.errorKind === expected.errorKind && typeof observed.message === 'string'
    && (expected.message === undefined || observed.message === expected.message)
  );
}

/**
 * Runs one job in a bounded process. A reply is provisional until normal exit;
 * the deadline also covers startup, warmup and a worker that replies then hangs.
 * workerPath and deadlineMs are injectable only for controlled protocol tests.
 * @param {BudgetJob} job
 * @param {{ workerPath?: string, deadlineMs?: number }} [options]
 */
export function runBudgetCase(job, { workerPath = fileURLToPath(new URL('./budget-worker.mjs', import.meta.url)), deadlineMs = 5000 } = {}) {
  return new Promise((resolve) => {
    let child;
    let reply;
    let failure;
    let stderr = '';
    const fail = (reason) => {
      failure ??= reason;
      child?.kill('SIGKILL');
    };
    const timer = setTimeout(() => fail(`hard deadline exceeded after ${deadlineMs} ms`), deadlineMs);
    try {
      child = fork(workerPath, [], { execArgv: ['--max-old-space-size=128'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    } catch (error) {
      clearTimeout(timer);
      resolve({ ok: false, reason: `worker could not start: ${String(error)}`, exited: true });
      return;
    }
    child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-4096); });
    child.on('error', (error) => fail(`worker error: ${error.message}`));
    child.on('message', (message) => {
      if (reply || failure) return fail('worker sent more than one reply');
      if (!validReply(message, job.expect)) {
        const reason = message && typeof message === 'object' && message.type === 'failure' && typeof message.reason === 'string'
          ? message.reason : 'invalid worker reply or unexpected classification';
        return fail(reason);
      }
      reply = message;
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      child.removeAllListeners('error');
      child.removeAllListeners('message');
      child.stderr.removeAllListeners('data');
      if (code !== 0 || signal !== null) failure ??= `worker exited with code ${code}, signal ${signal}${stderr ? `: ${stderr.trim()}` : ''}`;
      if (!reply) failure ??= 'worker exited without a valid reply';
      resolve({ ok: !failure, ...(failure ? { reason: failure } : reply), pid: child.pid, exited: true, exitCode: code, signal });
    });
    child.send(job, (error) => { if (error) fail(`worker IPC error: ${error.message}`); });
  });
}
