// Runs the Rust oracle (oracle/) as a child process.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const exe = process.platform === 'win32' ? 'typlet-oracle.exe' : 'typlet-oracle';
export const oraclePath = `${root}oracle/target/release/${exe}`;

export function ensureOracle() {
  if (!existsSync(oraclePath)) {
    throw new Error(`The oracle is not built. Run \`npm run oracle:build\` first (expected ${oraclePath}).`);
  }
}

/**
 * Runs an oracle command. `records` are written to stdin as JSON Lines; the
 * output lines are parsed and returned.
 */
export function runOracle(args, records = []) {
  ensureOracle();
  const input = records.map((r) => JSON.stringify(r)).join('\n');
  const result = spawnSync(oraclePath, args, {
    input,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`oracle ${args.join(' ')} failed with status ${result.status}:\n${result.stderr}`);
  }
  return result.stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

/** The Typst version the oracle was built against. */
export function oracleVersion() {
  ensureOracle();
  const result = spawnSync(oraclePath, ['version'], { encoding: 'utf8' });
  if (result.error) throw result.error;
  return result.stdout.trim();
}
