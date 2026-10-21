import { describe, expect, it } from 'vitest';
import { HELP, type Io, main } from '../src/cli.js';
import { version } from '../src/index.js';

/** Runs the command with files and standard input in memory. */
async function run(args: string[], files: Record<string, string> = {}, stdin = '') {
  const out = { stdout: '', stderr: '', files: { ...files } };
  const io: Io = {
    stdin: () => stdin,
    stdout: (text) => {
      out.stdout += text;
    },
    stderr: (text) => {
      out.stderr += text;
    },
    readFile: (path) => {
      if (!(path in out.files)) throw new Error(`ENOENT: no such file, open '${path}'`);
      return out.files[path]!;
    },
    writeFile: (path, text) => {
      out.files[path] = text;
    },
  };
  const code = await main(args, io);
  return { code, ...out };
}

describe('the typlet command', () => {
  it('renders the formula in its argument', async () => {
    const { code, stdout } = await run(['x^2']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^<span class="typlet"><span class="typlet-mathml"><math>.*<\/span>\n$/);
  });

  it('renders standard input, without its final newline', async () => {
    const { stdout } = await run(['-F', 'mathml'], {}, 'a + b\n');
    expect(stdout).toContain('<annotation encoding="application/x-typst">a + b</annotation>');
  });

  it('reads and writes files', async () => {
    const { code, files, stdout } = await run(['-d', '-i', 'in.typ', '-o', 'out.html', '--format', 'html'], { 'in.typ': 'sum_i i' });
    expect(code).toBe(0);
    expect(stdout).toBe('');
    expect(files['out.html']).toMatch(/^<span class="typlet-display"><span class="typlet"><span class="typlet-html" role="img" aria-label="sum_i i">/);
  });

  it('takes a preamble', async () => {
    expect((await run(['RR', '-p', '#let RR = $bb(R)$', '-F', 'mathml'])).stdout).toContain('ℝ');
    expect((await run(['RR', '-P', 'pre.typ', '-F', 'mathml'], { 'pre.typ': '#let RR = $bb(R)$' })).stdout).toContain('ℝ');
  });

  it('reports errors with their position and hints', async () => {
    const { code, stderr, stdout } = await run(['x +\n foo']);
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('typlet: eval error at 2:2: unknown variable: foo\n  hint: ');
  });

  it('reports errors in the preamble', async () => {
    const { code, stderr } = await run(['x', '-p', '#let f(x) = x\n#f()']);
    expect(code).toBe(1);
    expect(stderr).toContain('at preamble 2:');
  });

  it('renders errors in place on request', async () => {
    const { code, stdout } = await run(['foo', '-t', '-c', 'blue']);
    expect(code).toBe(0);
    expect(stdout).toContain('color:blue');
  });

  it('draws links only with trust', async () => {
    expect((await run(['#link("https://typst.app")[T]', '-F', 'mathml', '-S', 'ignore'])).stdout).not.toContain('href');
    expect((await run(['#link("https://typst.app")[T]', '-F', 'mathml', '-T'])).stdout).toContain('href="https://typst.app"');
  });

  it('prints warnings to standard error', async () => {
    const { code, stderr } = await run(['#link("https://typst.app")[T]', '-F', 'mathml']);
    expect(code).toBe(0);
    expect(stderr).toMatch(/^typlet: warning: Typlet left out a link/);
  });

  it('applies budgets', async () => {
    const limit = { code: 1, stderr: expect.stringContaining('limit error') };
    expect(await run(['#h(20em)', '--max-size', '10'])).toMatchObject(limit);
    expect(await run(['#f(30)', '-p', '#let f(n) = if n == 0 { 0 } else { f(n - 1) + f(n - 1) }', '--max-calls', '100'])).toMatchObject(limit);
    expect(await run(['#((1,) * 100)', '--max-collection-size', '10'])).toMatchObject(limit);
    expect(await run(['#("x" * 100)', '--max-string-length', '10'])).toMatchObject(limit);
  });

  it('rejects bad options', async () => {
    expect(await run(['x', '-F', 'svg'])).toMatchObject({ code: 2, stderr: expect.stringContaining('unknown format svg') });
    expect(await run(['x', 'y'])).toMatchObject({ code: 2, stderr: expect.stringContaining('at most one formula') });
    expect(await run(['--max-calls', 'many'])).toMatchObject({ code: 2, stderr: expect.stringContaining('--max-calls expects a positive number') });
    expect(await run(['--max-string-length', '0'])).toMatchObject({ code: 2, stderr: expect.stringContaining('--max-string-length expects a positive number') });
    expect(await run(['--unknown'])).toMatchObject({ code: 2, stderr: expect.stringContaining('Usage: typlet') });
    expect(await run(['-i', 'missing.typ'])).toMatchObject({ code: 2, stderr: expect.stringContaining('ENOENT') });
  });

  it('prints its help and version', async () => {
    expect(await run(['--help'])).toMatchObject({ code: 0, stdout: HELP });
    expect(await run(['-V'])).toMatchObject({ code: 0, stdout: `${version}\n` });
  });
});

describe('the typlet command in batch mode', () => {
  /** JSON Lines of objects, or of lines given as text. */
  const lines = (...items: unknown[]) => `${items.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n')}\n`;
  const results = (output: string): Record<string, any>[] =>
    output
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line));

  it('renders a result per line, with the ids and the options of the lines', async () => {
    const input = lines({ id: 1, source: 'x^2' }, '', { id: 'b', source: 'sum_i i', displayMode: true, output: 'html' });
    const { code, stdout, stderr } = await run(['--batch', '-F', 'mathml'], {}, input);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const [first, second] = results(stdout);
    expect(results(stdout)).toHaveLength(2);
    expect(first).toMatchObject({ id: 1, drawnAs: 'mathml', warnings: [], number: null });
    expect(first!.markup).toMatch(/^<span class="typlet"><math>/);
    expect(second).toMatchObject({ id: 'b', drawnAs: 'html' });
    expect(second!.markup).toMatch(/^<span class="typlet-display"><span class="typlet"><span class="typlet-html"/);
  });

  it('reports a formula that fails as an error, and exits with 1', async () => {
    const input = lines({ id: 1, source: 'foo' }, { id: 2, source: 'foo', throwOnError: false }, { source: 'x', preamble: '#f()' });
    const { code, stdout } = await run(['-b'], {}, input);
    expect(code).toBe(1);
    const [first, second, third] = results(stdout);
    expect(first).toEqual({
      id: 1,
      error: { kind: 'eval', message: 'unknown variable: foo', hints: expect.any(Array), span: { start: 0, end: 3 }, in: 'formula', diagnostics: expect.any(Array) },
    });
    expect(second).toMatchObject({ id: 2, drawnAs: 'error' });
    expect(second!.markup).toContain('typlet-error');
    expect(third).toMatchObject({ id: null, error: { kind: 'eval', in: 'preamble' } });
  });

  it('reports the lines it cannot read, and exits with 2', async () => {
    const input = lines('{', { id: 'a' }, { source: 1 }, { source: 'x', display: true }, { source: 'x', output: 'svg' }, { source: 'x', maxCalls: -1 }, [1]);
    const { code, stdout } = await run(['-b'], {}, input);
    expect(code).toBe(2);
    expect(results(stdout).map((r) => [r.id, r.error.kind, r.error.message])).toEqual([
      [null, 'input', expect.stringMatching(/^line 1: not JSON: /)],
      ['a', 'input', 'line 2: missing "source"'],
      [null, 'input', 'line 3: "source" must be a string'],
      [null, 'input', expect.stringMatching(/^line 4: unknown field "display"; the fields are "source", "id", "displayMode", /)],
      [null, 'input', 'line 5: "output" must be htmlAndMathml, html or mathml'],
      [null, 'input', 'line 6: "maxCalls" must be a positive number'],
      [null, 'input', 'line 7: expected a JSON object'],
    ]);
  });

  it('puts warnings in the results, and makes them errors on request', async () => {
    const link = { source: '#link("https://typst.app")[T]', output: 'mathml' };
    const { code, stdout, stderr } = await run(['-b'], {}, lines(link, { ...link, strict: 'error' }));
    expect(code).toBe(1);
    expect(stderr).toBe('');
    const [warned, failed] = results(stdout);
    expect(warned!.warnings).toEqual([expect.objectContaining({ kind: 'other', message: expect.stringMatching(/^Typlet left out a link/) })]);
    expect(failed!.error).toMatchObject({ kind: 'eval', message: expect.stringMatching(/^Typlet left out a link/) });
    expect((await run(['-b', '--strict', 'error'], {}, lines(link))).code).toBe(1);
  });

  it('numbers equations across the lines, from a count a line can set', async () => {
    const equation = { source: 'x', displayMode: true, output: 'html' };
    const input = lines(equation, equation, { ...equation, equationCounter: 0 }, equation);
    const { stdout } = await run(['-b', '-p', '#set math.equation(numbering: "(1)")'], {}, input);
    expect(results(stdout).map((r) => r.number)).toEqual(['(1)', '(2)', '(1)', '(2)']);
  });

  it('reads and writes files', async () => {
    const { code, files, stdout } = await run(['-b', '-i', 'in.jsonl', '-o', 'out.jsonl'], { 'in.jsonl': lines({ source: 'x' }, { source: 'y' }) });
    expect(code).toBe(0);
    expect(stdout).toBe('');
    expect(results(files['out.jsonl']!).map((r) => r.drawnAs)).toEqual(['html', 'html']);
  });

  it('writes the output file as the results arrive, and closes it', async () => {
    const written: string[] = [];
    let closed = false;
    const io: Io = {
      stdin: () => lines({ source: 'x' }, { source: 'y' }),
      stdout: () => {},
      stderr: () => {},
      readFile: () => '',
      writeFile: () => {
        throw new Error('not expected');
      },
      createWriter: (path) => {
        expect(path).toBe('out.jsonl');
        return {
          write: (text) => {
            expect(closed).toBe(false);
            written.push(text);
          },
          close: () => {
            closed = true;
          },
        };
      },
    };
    expect(await main(['-b', '-o', 'out.jsonl'], io)).toBe(0);
    expect(written).toHaveLength(2);
    expect(closed).toBe(true);
  });

  it('skips a byte order mark, and rejects counts beyond safe integers', async () => {
    const input = `﻿${lines({ source: 'x', output: 'mathml' }, { source: 'x', equationCounter: 1e300 })}`;
    const { code, stdout } = await run(['-b'], {}, input);
    expect(code).toBe(2);
    const [first, second] = results(stdout);
    expect(first).toMatchObject({ drawnAs: 'mathml' });
    expect(second!.error).toEqual({ kind: 'input', message: 'line 2: "equationCounter" must be a whole number' });
  });

  it('writes each result as its line arrives', async () => {
    let stdout = '';
    const seen: number[] = [];
    async function* input() {
      yield JSON.stringify({ source: 'x' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      seen.push(results(stdout).length);
      yield JSON.stringify({ source: 'y' });
    }
    const io: Io = {
      stdin: () => '',
      stdinLines: input,
      stdout: (text) => {
        stdout += text;
      },
      stderr: () => {},
      readFile: () => '',
      writeFile: () => {},
    };
    expect(await main(['-b'], io)).toBe(0);
    expect(seen).toEqual([1]);
    expect(results(stdout)).toHaveLength(2);
  });

  it('takes no formula argument', async () => {
    expect(await run(['-b', 'x'])).toMatchObject({ code: 2, stderr: expect.stringContaining('batch mode') });
  });
});
