import { readFileSync, writeFileSync } from 'node:fs';

export function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

/** Writes records one per line, with keys in a stable order for clean diffs. */
export function writeJsonl(path, records) {
  const text = records.map((record) => JSON.stringify(sortKeys(record))).join('\n');
  writeFileSync(path, text === '' ? '' : `${text}\n`);
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}
