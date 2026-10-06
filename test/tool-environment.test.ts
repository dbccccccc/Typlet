import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fontPython } from '../tools/lib/font-python.mjs';
import { root } from './helpers.js';

describe('generation environment', () => {
  it('rejects unknown corpus names instead of succeeding without generating them', () => {
    const result = spawnSync(process.execPath, ['tools/corpus/build.mjs', '--only', 'nonexistent'], { cwd: root, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unknown corpus: nonexistent');
  });

  it('fails on unavailable upstream sources and preserves the existing corpus', () => {
    const file = join(root, 'test/corpus/typst-docs.jsonl');
    const before = readFileSync(file);
    const result = spawnSync(process.execPath, ['tools/corpus/build.mjs', '--only', 'typst-docs'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: '', Path: '' },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('cargo');
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it('does not substitute a system Python when the repository environment is absent', () => {
    const directory = mkdtempSync(join(tmpdir(), 'typlet-font-env-'));
    try {
      expect(() => fontPython(directory)).toThrow("The repository's Python environment is missing");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
