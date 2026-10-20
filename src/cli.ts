// Typlet original: not ported from Typst.
//
// The `typlet` command: renders a formula to HTML, like KaTeX's CLI. The
// formula comes from the argument, the `--input` file or standard input. In
// batch mode, it renders JSON Lines in one process: a formula per line in, a
// result per line out, as the lines arrive.

import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { type Output, type RenderOptions, type Strictness, TypletError, renderToResult, renderToString, version } from './index.js';

export const HELP = `Usage: typlet [options] [formula]

Renders a Typst formula to HTML and MathML. The formula comes from the
argument, the --input file, or standard input.

Options:
  -d, --display-mode             render a display formula
  -F, --format <format>          htmlAndMathml (the default), html or mathml
  -i, --input <file>             read the formula from a file
  -o, --output <file>            write the result to a file instead of standard output
  -b, --batch                    render JSON Lines: a formula per line in, a result per line out
  -p, --preamble <code>          Typst code before the formula, such as #let and #set
  -P, --preamble-file <file>     read the preamble from a file
  -t, --no-throw-on-error        render an invalid formula's source in the error color
  -c, --error-color <color>      the color of invalid formulas (default: #cc0000)
  -S, --strict <mode>            what warnings do: ignore, warn (the default) or error
  -T, --trust                    draw links
      --max-calls <n>            the most function calls (default: 30000)
      --max-collection-size <n>  the most items in an array or dictionary (default: 10000)
      --max-string-length <n>    the most characters in a string (default: 100000)
      --max-elements <n>         the most content elements (default: 10000)
      --max-size <n>             the largest size, in em (default: 1000)
      --max-output-size <n>      the longest output, in characters (default: 1000000)
  -V, --version                  print the version
  -h, --help                     print this help

In batch mode, each line of standard input, or of the --input file, is a JSON
object with the formula as "source", an "id" to return as is, and render
options such as "displayMode", "output" or "preamble", which override the
flags. Each result is a line of JSON with the "id", the "markup", what it was
"drawnAs", the "warnings" and the equation "number", or an "error" with its
"kind" and "message".
`;

/** Where the command reads and writes, so tests can run it without a process. */
export interface Io {
  readonly stdin: () => string;
  /** Standard input line by line, as it arrives, for batch mode. Without it, `stdin()` is split into lines. */
  readonly stdinLines?: () => AsyncIterable<string>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly readFile: (path: string) => string;
  readonly writeFile: (path: string, text: string) => void;
}

export const processIo: Io = {
  stdin: () => readFileSync(0, 'utf8'),
  stdinLines: () => createInterface({ input: process.stdin, crlfDelay: Infinity }),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, text) => writeFileSync(path, text),
};

const FORMATS: readonly Output[] = ['htmlAndMathml', 'html', 'mathml'];
const STRICTNESS: readonly Strictness[] = ['ignore', 'warn', 'error'];

/** The fields of a batch line besides "source" and "id", and what each takes. */
const LINE_FIELDS: Readonly<Record<string, 'boolean' | 'string' | 'number' | 'count' | readonly string[]>> = {
  displayMode: 'boolean',
  output: FORMATS,
  throwOnError: 'boolean',
  errorColor: 'string',
  strict: STRICTNESS,
  trust: 'boolean',
  preamble: 'string',
  maxCalls: 'number',
  maxCollectionSize: 'number',
  maxStringLength: 'number',
  maxElements: 'number',
  maxSize: 'number',
  maxOutputSize: 'number',
  /** Sets the count of numbered equations before this one, which the following lines continue. */
  equationCounter: 'count',
};

/** "a, b or c". */
const either = (items: readonly string[]): string => `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;

/** A line and column, from 1, of an offset in the source. */
function position(source: string, offset: number): string {
  const before = source.slice(0, offset).split('\n');
  return `${before.length}:${before.at(-1)!.length + 1}`;
}

type Line = { id: unknown; source: string; fields: Record<string, unknown> } | { id: unknown; invalid: string };

/** A batch line's formula, id and fields, or why the line can't be read. */
function parseLine(text: string): Line {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { id: null, invalid: `not JSON: ${(e as Error).message}` };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { id: null, invalid: 'expected a JSON object' };
  const { id = null, source, ...fields } = value as Record<string, unknown>;
  if (typeof source !== 'string') return { id, invalid: source === undefined ? 'missing "source"' : '"source" must be a string' };
  for (const [name, field] of Object.entries(fields)) {
    const takes = LINE_FIELDS[name];
    if (takes === undefined) {
      return { id, invalid: `unknown field ${JSON.stringify(name)}; the fields are ${either(['source', 'id', ...Object.keys(LINE_FIELDS)].map((f) => JSON.stringify(f)))}` };
    }
    let ok: boolean;
    let expected: string;
    if (typeof takes !== 'string') {
      ok = typeof field === 'string' && takes.includes(field);
      expected = either(takes);
    } else if (takes === 'number') {
      ok = typeof field === 'number' && Number.isFinite(field) && field > 0;
      expected = 'a positive number';
    } else if (takes === 'count') {
      ok = typeof field === 'number' && Number.isInteger(field) && field >= 0;
      expected = 'a whole number';
    } else {
      ok = typeof field === takes;
      expected = `a ${takes}`;
    }
    if (!ok) return { id, invalid: `${JSON.stringify(name)} must be ${expected}` };
  }
  return { id, source, fields };
}

/**
 * Renders JSON Lines, a result per line, as the lines arrive. Returns the exit
 * code: 1 if a formula failed, 2 if a line couldn't be read.
 */
async function batch(lines: AsyncIterable<string> | Iterable<string>, flags: RenderOptions, emit: (line: string) => void): Promise<number> {
  // Warnings are part of each result; `strict: "error"` makes them errors.
  const counter = { value: 0 };
  const defaults: RenderOptions = { ...flags, strict: flags.strict === 'error' ? 'error' : 'ignore', equationCounter: counter };
  let code = 0;
  let n = 0;
  for await (const text of lines) {
    n++;
    if (text.trim() === '') continue;
    const line = parseLine(text);
    let result: Record<string, unknown>;
    if ('invalid' in line) {
      code = 2;
      result = { id: line.id, error: { kind: 'input', message: `line ${n}: ${line.invalid}` } };
    } else {
      const { equationCounter, strict, ...fields } = line.fields;
      if (equationCounter !== undefined) counter.value = equationCounter as number;
      let options = defaults;
      if (Object.keys(fields).length > 0 || strict !== undefined) {
        options = { ...defaults, ...fields };
        if (strict !== undefined) options.strict = strict === 'error' ? 'error' : 'ignore';
      }
      try {
        result = { id: line.id, ...renderToResult(line.source, options) };
      } catch (e) {
        if (!(e instanceof TypletError)) throw e;
        code = Math.max(code, 1);
        const where = e.diagnostics[0]?.in ?? 'formula';
        result = { id: line.id, error: { kind: e.kind, message: e.message, hints: e.hints, span: e.span, in: where, diagnostics: e.diagnostics } };
      }
    }
    emit(`${JSON.stringify(result)}\n`);
  }
  return code;
}

/** Runs the command with its arguments; returns the exit code. */
export async function main(args: readonly string[], io: Io = processIo): Promise<number> {
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
        batch: { type: 'boolean', short: 'b' },
        preamble: { type: 'string', short: 'p' },
        'preamble-file': { type: 'string', short: 'P' },
        'no-throw-on-error': { type: 'boolean', short: 't' },
        'error-color': { type: 'string', short: 'c' },
        strict: { type: 'string', short: 'S' },
        trust: { type: 'boolean', short: 'T' },
        'max-calls': { type: 'string' },
        'max-collection-size': { type: 'string' },
        'max-string-length': { type: 'string' },
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
  if (positionals.length === 1 && values.batch) return fail('batch mode reads its formulas from JSON Lines, not from an argument');
  const format = values.format ?? 'htmlAndMathml';
  if (!FORMATS.includes(format as Output)) return fail(`unknown format ${format}: expected htmlAndMathml, html or mathml`);
  const strict = values.strict ?? 'warn';
  if (!STRICTNESS.includes(strict as Strictness)) return fail(`unknown strict mode ${strict}: expected ignore, warn or error`);
  if (values.preamble !== undefined && values['preamble-file'] !== undefined) return fail('give the preamble with --preamble or --preamble-file, not both');

  const number = (
    name: 'max-calls' | 'max-collection-size' | 'max-string-length' | 'max-elements' | 'max-size' | 'max-output-size',
  ): number | undefined | null => {
    const value = values[name];
    if (value === undefined) return undefined;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const budgets = {
    maxCalls: number('max-calls'),
    maxCollectionSize: number('max-collection-size'),
    maxStringLength: number('max-string-length'),
    maxElements: number('max-elements'),
    maxSize: number('max-size'),
    maxOutputSize: number('max-output-size'),
  };
  for (const [name, value] of Object.entries(budgets)) {
    if (value === null) return fail(`--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} expects a positive number`);
  }

  let preamble: string | undefined;
  try {
    preamble = values['preamble-file'] !== undefined ? io.readFile(values['preamble-file']) : values.preamble;
  } catch (e) {
    return fail((e as Error).message);
  }

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

  if (values.batch) {
    let lines: AsyncIterable<string> | Iterable<string>;
    try {
      lines = values.input !== undefined ? io.readFile(values.input).split(/\r?\n/) : (io.stdinLines?.() ?? io.stdin().split(/\r?\n/));
    } catch (e) {
      return fail((e as Error).message);
    }
    if (values.output === undefined) return batch(lines, options, io.stdout);
    let results = '';
    const code = await batch(lines, options, (line) => {
      results += line;
    });
    io.writeFile(values.output, results);
    return code;
  }

  let source: string;
  try {
    source = positionals[0] ?? (values.input !== undefined ? io.readFile(values.input) : io.stdin());
  } catch (e) {
    return fail((e as Error).message);
  }
  // A file or standard input usually ends with a newline that isn't part of the formula.
  if (positionals.length === 0) source = source.replace(/\r?\n$/, '');

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
