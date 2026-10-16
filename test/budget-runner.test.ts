import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runBudgetCase } from '../scripts/lib/budget-runner.mjs';

const workerPath = fileURLToPath(new URL('./support/budget-worker-fixture.mjs', import.meta.url));
const job = (source: string) => ({ name: `controlled ${source}`, source, options: {}, expect: { kind: 'success' as const } });

function expectExited(result: { pid?: number; exited: boolean }) {
  expect(result.exited).toBe(true);
  expect(result.pid).toBeTypeOf('number');
  expect(() => process.kill(result.pid!, 0)).toThrow();
}

describe('isolated budget runner', () => {
  it('accepts five samples only after a normal child exit', async () => {
    const result = await runBudgetCase(job('normal'), { workerPath });
    expect(result).toMatchObject({ ok: true, samples: 5, medianMs: 1, observed: { kind: 'success' }, exitCode: 0 });
    expectExited(result);
  });

  it.each([
    ['native', 'worker exited with code 1'],
    ['nonzero', 'worker exited with code 3'],
    ['invalid', 'invalid worker reply'],
    ['no-reply', 'worker exited without a valid reply'],
    ['wrong-classification', 'unexpected classification'],
    ['wrong-samples', 'invalid worker reply'],
    ['bad-time', 'invalid worker reply'],
    ['reply-then-nonzero', 'worker exited with code 4'],
  ])('rejects the %s fixture and waits for exit', async (mode, reason) => {
    const result = await runBudgetCase(job(mode!), { workerPath });
    expect(result).toMatchObject({ ok: false });
    expect(result.reason).toContain(reason);
    expectExited(result);
  });

  it.each(['block', 'reply-then-block'])('kills a %s child at the hard deadline', async (mode) => {
    const start = performance.now();
    const result = await runBudgetCase(job(mode), { workerPath, deadlineMs: 500 });
    expect(result).toMatchObject({ ok: false, reason: 'hard deadline exceeded after 500 ms' });
    expect(performance.now() - start).toBeGreaterThanOrEqual(500);
    expect(performance.now() - start).toBeLessThan(3000);
    expectExited(result);
  });
});
