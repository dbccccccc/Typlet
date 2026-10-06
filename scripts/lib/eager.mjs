// Marks functions of a bundle so that V8 compiles them with the script.
//
// V8 compiles a function when it is first called, unless the function is an
// expression in parentheses: V8 takes that as a sign that the function is
// called soon, and compiles it while it compiles the script. A page's first
// formula calls several hundred functions, and compiling them one call at a
// time took most of its time (docs/DESIGN.md §7). So the build finds
// the functions that typical formulas call (scripts/lib/profile-formulas.mjs)
// and this module puts them in parentheses:
// - a top-level function declaration becomes `var f = (function() {...});` at
//   the top of the bundle, where it is defined before any other code runs,
//   as a hoisted declaration is;
// - a function expression or an arrow function gets parentheses where it is.
// Methods, accessors and constructors have no such form, and stay as they are.
//
// The bundle must be esbuild's unminified ESM output, which starts every
// top-level statement on a line of its own. esbuild's minifier keeps the
// parentheses.

import { decodeMappings, encodeMappings } from './sourcemap.mjs';

// How esbuild prints the head of a named function.
const NAMED_FUNCTION = /^(async )?function(\*?) ([\w$]+)(?=\()/;
const FUNCTION = /^(async )?function\b/;
const ARROW = /^(async )?\(/;
// What comes before a function expression on its line: an operator, an
// opening bracket, or a keyword that takes an expression.
const BEFORE_EXPRESSION = /(^\s*|[=([,:?!&|+\-*/%~^<>]\s*|\b(return|yield|await|new|typeof|void|throw|delete|in|of|case)\s+)$/;

/**
 * Marks the functions at `ranges` of `code`, the `{ start, end }` offsets
 * V8's coverage reports for them. Ranges of functions that can't be marked
 * are left alone. Returns the new code, the source map `map` updated to
 * match it (or `null`), and how many functions were marked in each way.
 */
export function markEager(code, map, ranges) {
  const lineStarts = [0];
  for (let i = code.indexOf('\n'); i !== -1; i = code.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  const lineOf = (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  // Edits replace `remove` characters at `at` with `insert`, and never add or
  // remove a line. Moves take whole lines to the top of the bundle.
  const edits = [];
  const moves = [];
  const counts = { declarations: 0, expressions: 0, unmarked: 0 };
  for (const { start, end } of [...ranges].sort((a, b) => a.start - b.start)) {
    const text = code.slice(start, end);
    const line = lineOf(start);
    const before = code.slice(lineStarts[line], start);
    const named = NAMED_FUNCTION.exec(text);
    const alone = end === code.length || code[end] === '\n';
    if (named && before === '' && alone) {
      const [head, async = '', star, name] = named;
      edits.push({ at: start, remove: head.length - name.length, insert: 'var ' });
      edits.push({ at: start + head.length, remove: 0, insert: ` = (${async}function${star}` });
      edits.push({ at: end, remove: 0, insert: ');' });
      moves.push([line, lineOf(end)]);
      counts.declarations++;
    } else if (FUNCTION.test(text) ? BEFORE_EXPRESSION.test(before) && !(named && before.trim() === '') : ARROW.test(text)) {
      edits.push({ at: start, remove: 0, insert: '(' });
      edits.push({ at: end, remove: 0, insert: ')' });
      counts.expressions++;
    } else {
      counts.unmarked++;
    }
  }
  // Stable, so that edits at one offset stay in the order they were made.
  edits.sort((a, b) => a.at - b.at);

  let edited = '';
  let from = 0;
  for (const { at, remove, insert } of edits) {
    edited += code.slice(from, at) + insert;
    from = at + remove;
  }
  edited += code.slice(from);

  const moved = new Set();
  const order = [];
  for (const [first, last] of moves) {
    for (let line = first; line <= last; line++) {
      moved.add(line);
      order.push(line);
    }
  }
  for (let line = 0; line < lineStarts.length; line++) if (!moved.has(line)) order.push(line);
  const lines = edited.split('\n');
  const marked = order.map((line) => lines[line]).join('\n');
  if (!map) return { code: marked, map: null, counts };

  // The source map: shift the columns after each edit, drop the segments of
  // removed text, and move the lines.
  const mappings = decodeMappings(map.mappings);
  while (mappings.length < lineStarts.length) mappings.push([]);
  const editsOf = new Map();
  for (const edit of edits) {
    const line = lineOf(edit.at);
    if (!editsOf.has(line)) editsOf.set(line, []);
    editsOf.get(line).push({ ...edit, column: edit.at - lineStarts[line] });
  }
  for (const [line, lineEdits] of editsOf) {
    mappings[line] = mappings[line].flatMap((segment) => {
      let column = segment[0];
      for (const edit of lineEdits) {
        if (segment[0] > edit.column && segment[0] < edit.column + edit.remove) return [];
        if (segment[0] >= edit.column + edit.remove) column += edit.insert.length - edit.remove;
      }
      return [[column, ...segment.slice(1)]];
    });
  }
  return { code: marked, map: { ...map, mappings: encodeMappings(order.map((line) => mappings[line])) }, counts };
}
