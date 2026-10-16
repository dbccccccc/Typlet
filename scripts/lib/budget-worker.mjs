// Typlet original: not ported from Typst.

/** @typedef {import('./budget-runner.mjs').BudgetJob} BudgetJob */

/** @param {object} reply */
function finish(reply) {
  process.send(reply, () => process.disconnect());
}

// Keep the job listener ready while the built renderer is loading.
process.once('message', async (/** @type {BudgetJob} */ job) => {
  try {
    const { render, renderToString, renderToResult, TypletError } = await import(`../../dist/${job.entry ?? 'index'}.js`);
    const run = () => {
      const start = performance.now();
      let markup;
      let observed;
      try {
        markup = renderToString(job.source, { ...job.options, strict: 'ignore' });
        observed = { kind: 'success' };
      } catch (error) {
        if (!(error instanceof TypletError)) throw new Error(`native exception: ${error instanceof Error ? error.name + ': ' + error.message : String(error)}`);
        observed = { kind: 'error', errorKind: error.kind, message: error.message };
      }
      if (job.expect.kind === 'success') {
        if (observed.kind !== 'success') throw new Error(`expected success, actual error/${observed.errorKind}`);
        if (job.expect.contains !== undefined && !markup.includes(job.expect.contains)) throw new Error('successful markup did not contain the expected result');
      } else if (observed.kind !== 'error' || observed.errorKind !== job.expect.errorKind || (job.expect.message !== undefined && observed.message !== job.expect.message)) {
        throw new Error(`expected error/${job.expect.errorKind}${job.expect.message ? ': ' + job.expect.message : ''}, actual ${observed.kind}${observed.kind === 'error' ? '/' + observed.errorKind + ': ' + observed.message : ''}`);
      }
      return { ms: performance.now() - start, observed };
    };
    run();
    const samples = Array.from({ length: 5 }, run);
    const times = samples.map(({ ms }) => ms).sort((a, b) => a - b);
    if (job.verifyRecovery) {
      const rejected = renderToResult(job.source, { ...job.options, strict: 'ignore', throwOnError: false });
      if (rejected.drawnAs !== 'error' || !rejected.markup.includes('typlet-error')) throw new Error('rejection did not produce controlled error markup');
      const element = { innerHTML: '' };
      render(job.source, element, { ...job.options, strict: 'ignore', throwOnError: false });
      if (!element.innerHTML.includes('typlet-error')) throw new Error('DOM render did not produce controlled error markup');
      if (!renderToString('x + 1', { strict: 'ignore' }).includes('<mn>1</mn>')) throw new Error('fresh render failed after rejection');
    }
    finish({ type: 'result', samples: samples.length, medianMs: times[2], observed: samples[4].observed });
  } catch (error) {
    finish({ type: 'failure', reason: error instanceof Error ? error.message : String(error) });
  }
});
