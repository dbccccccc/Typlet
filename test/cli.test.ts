import { describe, expect, it } from 'vitest';
import { HELP, type Io, main } from '../src/cli.js';
import { version } from '../src/index.js';

/** Runs the command with files and standard input in memory. */
function run(args: string[], files: Record<string, string> = {}, stdin = '') {
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
  return { code: main(args, io), ...out };
}

describe('the typlet command', () => {
  it('renders the formula in its argument', () => {
    const { code, stdout } = run(['x^2']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^<span class="typlet"><span class="typlet-mathml"><math>.*<\/span>\n$/);
  });

  it('renders standard input, without its final newline', () => {
    const { stdout } = run(['-F', 'mathml'], {}, 'a + b\n');
    expect(stdout).toContain('<annotation encoding="application/x-typst">a + b</annotation>');
  });

  it('reads and writes files', () => {
    const { code, files, stdout } = run(['-d', '-i', 'in.typ', '-o', 'out.html', '--format', 'html'], { 'in.typ': 'sum_i i' });
    expect(code).toBe(0);
    expect(stdout).toBe('');
    expect(files['out.html']).toMatch(/^<span class="typlet-display"><span class="typlet"><span class="typlet-html" role="img" aria-label="sum_i i">/);
  });

  it('takes a preamble', () => {
    expect(run(['RR', '-p', '#let RR = $bb(R)$', '-F', 'mathml']).stdout).toContain('ℝ');
    expect(run(['RR', '-P', 'pre.typ', '-F', 'mathml'], { 'pre.typ': '#let RR = $bb(R)$' }).stdout).toContain('ℝ');
  });

  it('reports errors with their position and hints', () => {
    const { code, stderr, stdout } = run(['x +\n foo']);
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('typlet: eval error at 2:2: unknown variable: foo\n  hint: ');
  });

  it('reports errors in the preamble', () => {
    const { code, stderr } = run(['x', '-p', '#let f(x) = x\n#f()']);
    expect(code).toBe(1);
    expect(stderr).toContain('at preamble 2:');
  });

  it('renders errors in place on request', () => {
    const { code, stdout } = run(['foo', '-t', '-c', 'blue']);
    expect(code).toBe(0);
    expect(stdout).toContain('color:blue');
  });

  it('draws links only with trust', () => {
    expect(run(['#link("https://typst.app")[T]', '-F', 'mathml', '-S', 'ignore']).stdout).not.toContain('href');
    expect(run(['#link("https://typst.app")[T]', '-F', 'mathml', '-T']).stdout).toContain('href="https://typst.app"');
  });

  it('prints warnings to standard error', () => {
    const { code, stderr } = run(['#link("https://typst.app")[T]', '-F', 'mathml']);
    expect(code).toBe(0);
    expect(stderr).toMatch(/^typlet: warning: Typlet left out a link/);
  });

  it('applies budgets', () => {
    const { code, stderr } = run(['#h(20em)', '--max-size', '10']);
    expect(code).toBe(1);
    expect(stderr).toContain('limit error');
  });

  it('rejects bad options', () => {
    expect(run(['x', '-F', 'svg'])).toMatchObject({ code: 2, stderr: expect.stringContaining('unknown format svg') });
    expect(run(['x', 'y'])).toMatchObject({ code: 2, stderr: expect.stringContaining('at most one formula') });
    expect(run(['--max-calls', 'many'])).toMatchObject({ code: 2, stderr: expect.stringContaining('--max-calls expects a positive number') });
    expect(run(['--unknown'])).toMatchObject({ code: 2, stderr: expect.stringContaining('Usage: typlet') });
    expect(run(['-i', 'missing.typ'])).toMatchObject({ code: 2, stderr: expect.stringContaining('ENOENT') });
  });

  it('prints its help and version', () => {
    expect(run(['--help'])).toMatchObject({ code: 0, stdout: HELP });
    expect(run(['-V'])).toMatchObject({ code: 0, stdout: `${version}\n` });
  });
});
