import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { typstVersion } from '../src/version.js';

export const root = resolve(import.meta.dirname, '..');
export const corpusDir = join(root, 'test/corpus');
export const fixtureDir = join(root, `test/fixtures/typst-${typstVersion}`);

export function readJsonl<T = Record<string, unknown>>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T);
}

/** The committed corpus files, by name without the `.jsonl` extension. */
export function corpusNames(): string[] {
  return readdirSync(corpusDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.replace(/\.jsonl$/, ''))
    .sort();
}

export interface Formula {
  id: string;
  src: string;
  display: boolean;
  preamble?: string;
}

export interface Expression {
  id: string;
  expr: string;
}
