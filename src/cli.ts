// Typlet original: not ported from Typst.
//
// The `typlet` command: renders a formula to HTML, like KaTeX's CLI. The
// formula comes from the argument, the `--input` file or standard input.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { type Output, type RenderOptions, type Strictness, TypletError, renderToString, version } from './index.js';

export const HELP = `Usage: typlet [options] [formula]

Renders a Typst formula to HTML and MathML. The formula comes from the
argument, the --input file, or standard input.

Options:
  -d, --display-mode           render a display formula
  -F, --format <format>        htmlAndMathml (the default), html or mathml
  -i, --input <file>           read the formula from a file
  -o, --output <file>          write the result to a file instead of standard output
  -p, --preamble <code>        Typst code before the formula, such as #let and #set
  -P, --preamble-file <file>   read the preamble from a file
  -t, --no-throw-on-error      render an invalid formula's source in the error color
  -c, --error-color <color>    the color of invalid formulas (default: #cc0000)
  -S, --strict <mode>          what warnings do: ignore, warn (the default) or error
  -T, --trust                  draw links
      --max-calls <n>          the most function calls (default: 30000)
      --max-elements <n>       the most content elements (default: 10000)
      --max-size <n>           the largest size, in em (default: 1000)
      --max-output-size <n>    the longest output, in characters (default: 1000000)
  -V, --version                print the version
  -h, --help                   print this help
`;

/** Where the command reads and writes, so tests can run it without a process. */
export interface Io {
  readonly stdin: () => string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly readFile: (path: string) => string;
  readonly writeFile: (path: string, text: string) => void;
}

export const processIo: Io = {
  stdin: () => readFileSync(0, 'utf8'),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, text) => writeFileSync(path, text),
};

const FORMATS: readonly Output[] = ['htmlAndMathml', 'html', 'mathml'];
const STRICTNESS: readonly Strictness[] = ['ignore', 'warn', 'error'];

/** A line and column, from 1, of an offset in the source. */
function position(source: string, offset: number): string {
  const before = source.slice(0, offset).split('\n');
  return `${before.length}:${before.at(-1)!.length + 1}`;
}

/** Runs the command with its arguments; returns the exit code. */
export function main(args: readonly string[], io: Io = processIo): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      options: {
        'display-mode': { type: 'boolean', short: 'd' },
        format: { type: 'string', short: 'F' },
        input: { type: 'string', short: 'i' },
        output: { type: 'string', short: 'o' },
        preamble: { type: 'string', short: 'p' },
        'preamble-file': { type: 'string', short: 'P' },
        'no-throw-on-error': { type: 'boolean', short: 't' },
        'error-color': { type: 'string', short: 'c' },
        strict: { type: 'string', short: 'S' },
        trust: { type: 'boolean', short: 'T' },
        'max-calls': { type: 'string' },
        'max-elements': { type: 'string' },
        'max-size': { type: 'string' },
        'max-output-size': { type: 'string' },
        version: { type: 'boolean', short: 'V' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (e) {
    io.stderr(`typlet: ${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(HELP);
    return 0;
  }
  if (values.version) {
    io.stdout(`${version}\n`);
    return 0;
  }

  const fail = (message: string): number => {
    io.stderr(`typlet: ${message}\n`);
    return 2;
  };
  if (positionals.length > 1) return fail('expected at most one formula; quote it, as in typlet "x + y"');
  if (positionals.length === 1 && values.input !== undefined) return fail('give the formula as an argument or with --input, not both');
  const format = values.format ?? 'htmlAndMathml';
  if (!FORMATS.includes(format as Output)) return fail(`unknown format ${format}: expected htmlAndMathml, html or mathml`);
  const strict = values.strict ?? 'warn';
  if (!STRICTNESS.includes(strict as Strictness)) return fail(`unknown strict mode ${strict}: expected ignore, warn or error`);
  if (values.preamble !== undefined && values['preamble-file'] !== undefined) return fail('give the preamble with --preamble or --preamble-file, not both');

  const number = (name: 'max-calls' | 'max-elements' | 'max-size' | 'max-output-size'): number | undefined | null => {
    const value = values[name];
    if (value === undefined) return undefined;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const budgets = {
    maxCalls: number('max-calls'),
    maxElements: number('max-elements'),
    maxSize: number('max-size'),
    maxOutputSize: number('max-output-size'),
  };
  for (const [name, value] of Object.entries(budgets)) {
    if (value === null) return fail(`--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} expects a positive number`);
  }

  let source: string;
  let preamble: string | undefined;
  try {
    source = positionals[0] ?? (values.input !== undefined ? io.readFile(values.input) : io.stdin());
    preamble = values['preamble-file'] !== undefined ? io.readFile(values['preamble-file']) : values.preamble;
  } catch (e) {
    return fail((e as Error).message);
  }
  // A file or standard input usually ends with a newline that isn't part of the formula.
  if (positionals.length === 0) source = source.replace(/\r?\n$/, '');

  const options: RenderOptions = {
    displayMode: values['display-mode'] ?? false,
    output: format as Output,
    throwOnError: !values['no-throw-on-error'],
    strict: strict as Strictness,
    trust: values.trust ?? false,
    ...(values['error-color'] !== undefined ? { errorColor: values['error-color'] } : {}),
    ...(preamble !== undefined ? { preamble } : {}),
    ...Object.fromEntries(Object.entries(budgets).filter(([, v]) => v !== undefined)),
  };

  let html: string;
  const warn = console.warn;
  // Warnings go to standard error, as `typlet: warning: ...`.
  console.warn = (message: unknown) => io.stderr(`typlet: ${String(message).replace(/^Typlet warning: /, 'warning: ')}\n`);
  try {
    html = renderToString(source, options);
  } catch (e) {
    if (!(e instanceof TypletError)) throw e;
    const where = e.diagnostics[0]?.in === 'preamble' ? preamble ?? '' : source;
    const span = e.span;
    const at = span ? ` at ${e.diagnostics[0]?.in === 'preamble' ? 'preamble ' : ''}${position(where, span.start)}` : '';
    io.stderr(`typlet: ${e.kind} error${at}: ${e.message}\n${e.hints.map((hint) => `  hint: ${hint}\n`).join('')}`);
    return 1;
  } finally {
    console.warn = warn;
  }

  if (values.output !== undefined) io.writeFile(values.output, `${html}\n`);
  else io.stdout(`${html}\n`);
  return 0;
}
