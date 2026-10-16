// Typlet original: not ported from Typst.

process.once('message', (job) => {
  const reply = { type: 'result', samples: 5, medianMs: 1, observed: { kind: 'success' } };
  const send = (value, after = () => process.disconnect()) => process.send(value, after);
  switch (job.source) {
    case 'normal': return send(reply);
    case 'native': throw new RangeError('controlled native failure');
    case 'nonzero': return process.exit(3);
    case 'invalid': return send({ unexpected: true });
    case 'no-reply': return process.disconnect();
    case 'wrong-classification': return send({ ...reply, observed: { kind: 'error', errorKind: 'limit', message: 'controlled error' } });
    case 'wrong-samples': return send({ ...reply, samples: 4 });
    case 'bad-time': return send({ ...reply, medianMs: -1 });
    case 'reply-then-nonzero': return send(reply, () => process.exit(4));
    case 'reply-then-block': return send(reply, () => { while (true) {} });
    case 'block': while (true) {}
    default: throw new Error('unknown controlled fixture mode');
  }
});
