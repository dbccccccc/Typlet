// Locates crate sources in the cargo registry, via the oracle's dependency graph.

import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
let metadata = null;

/** The directory of a crate that the oracle depends on, such as `typst-library`. */
export function cratePath(name) {
  metadata ??= JSON.parse(
    execFileSync('cargo', ['metadata', '--format-version', '1', '--manifest-path', join(root, 'oracle/Cargo.toml')], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
  const pkg = metadata.packages.find((p) => p.name === name);
  if (!pkg) throw new Error(`crate ${name} is not in the oracle's dependency graph`);
  return dirname(pkg.manifest_path);
}
