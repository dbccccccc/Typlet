// Rules for source-file headers (docs/DESIGN.md §8).
//
// Typlet is MIT-licensed, but parts of it are ported from Typst, which is
// Apache-2.0. Apache-2.0 requires modified files to say that they were changed,
// so every ported file starts with this header:
//
//   // Ported from Typst 0.15.1: crates/typst-syntax/src/lexer.rs
//   // Copyright The Typst Project Developers. Licensed under Apache-2.0.
//   // Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// Files in the ported directories that are not ports say so instead:
//
//   // Typlet original: not ported from Typst.
//
// A module that ports several small upstream files names them all, separated
// by ", ". Code ported from the Typst project's other crates with the same
// authors and license, codex (symbols) and typst-assets (data), names that
// crate instead, with a path inside it:
//
//   // Ported from codex 0.3.0: src/styling.rs
//   // Ported from typst-assets 0.15.1: src/mathml.rs
//
// Every upstream path named in a header must also be listed in
// docs/UPSTREAM.md, which maps Typlet modules to the files they port.

/** Directories whose files must declare whether they are ported. */
export const PORTED_DIRS = ['src/syntax/', 'src/eval/', 'src/elements/', 'src/ir/', 'src/layout/', 'src/mathml/'];

export const ORIGINAL_MARKER = '// Typlet original: not ported from Typst.';

const UPSTREAM_PATH = String.raw`(?:crates|src)\/[\w./-]+\.rs`;
const PORTED_LINE_1 = new RegExp(
  String.raw`^\/\/ Ported from (Typst|codex|typst-assets) (\d+\.\d+\.\d+): (${UPSTREAM_PATH}(?:, ${UPSTREAM_PATH})*)$`,
);
const PORTED_LINE_2 = '// Copyright The Typst Project Developers. Licensed under Apache-2.0.';
const PORTED_LINE_3 = '// Modified for Typlet. See THIRD_PARTY_NOTICES.md.';

/**
 * Parses a file's header. Returns `{ kind: 'ported', project, version, upstream: [paths] }`,
 * `{ kind: 'original' }` or `null`.
 */
export function parseHeader(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/, 3);
  if (lines[0] === ORIGINAL_MARKER) return { kind: 'original' };
  const match = PORTED_LINE_1.exec(lines[0] ?? '');
  if (match && lines[1] === PORTED_LINE_2 && lines[2] === PORTED_LINE_3) {
    return { kind: 'ported', project: match[1], version: match[2], upstream: match[3].split(', ') };
  }
  return null;
}

/**
 * Checks source files against the header rules.
 *
 * @param files `{ path, text }` with paths relative to the repository root, using `/`.
 * @param upstreamDoc The text of docs/UPSTREAM.md.
 * @param typstVersion The Typst version ports must name.
 * @param codexVersion The codex version that Typst version uses.
 * @returns A list of human-readable problems; empty when everything passes.
 */
export function checkHeaders(files, upstreamDoc, typstVersion, codexVersion = '0.3.0') {
  const problems = [];
  for (const { path, text } of files) {
    if (!/\.(ts|mts|js|mjs)$/.test(path) || /\.test\.ts$/.test(path)) continue;
    const header = parseHeader(text);
    const mentionsPort = /^\/\/ Ported from /m.test(text.slice(0, 400));

    if (header?.kind === 'ported') {
      // typst-assets is released with Typst and shares its version.
      const expected = header.project === 'codex' ? codexVersion : typstVersion;
      const prefix = header.project === 'Typst' ? 'crates/' : 'src/';
      if (header.version !== expected) {
        problems.push(`${path}: ported from ${header.project} ${header.version}, but Typlet targets ${expected}`);
      }
      for (const upstream of header.upstream) {
        if (!upstream.startsWith(prefix)) {
          problems.push(`${path}: ${header.project} paths start with ${prefix}, found ${upstream}`);
        } else if (!upstreamDoc.includes(upstream)) {
          problems.push(`${path}: upstream file ${upstream} is not listed in docs/UPSTREAM.md`);
        }
      }
    } else if (mentionsPort) {
      problems.push(`${path}: malformed "Ported from" header (see scripts/lib/headers.mjs)`);
    } else if (header === null && PORTED_DIRS.some((dir) => path.startsWith(dir))) {
      problems.push(`${path}: missing header; add the ported-file header or "${ORIGINAL_MARKER}"`);
    }
  }
  return problems;
}
