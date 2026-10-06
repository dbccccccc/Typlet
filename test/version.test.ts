import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as main from '../src/index.js';
import * as mathml from '../src/mathml.js';
import { root } from './helpers.js';

const read = (file: string) => readFileSync(join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json')) as { version: string };

/** Whether a caret range, such as `^0.1.0`, allows a version, as npm reads it. */
function caretAllows(range: string, version: string): boolean {
  if (!range.startsWith('^')) return false;
  const [a = NaN, b = NaN, c = NaN] = range.slice(1).split('.').map(Number);
  const [x = NaN, y = NaN, z = NaN] = version.split('.').map(Number);
  if (a === 0 && b === 0) return x === 0 && y === 0 && z === c;
  if (a === 0) return x === 0 && y === b && z >= c;
  return x === a && (y > b || (y === b && z >= c));
}

describe('version', () => {
  it('matches package.json', () => {
    expect(main.version).toBe(pkg.version);
  });

  it('is exported by both entry points', () => {
    expect(mathml.version).toBe(main.version);
    expect(mathml.typstVersion).toBe(main.typstVersion);
  });

  // The release workflow publishes the three packages together, so a version
  // left behind anywhere would publish half a release.
  it('is the version of the packages in packages/, which depend on it', () => {
    for (const name of ['rehype-typlet', 'markdown-it-typlet']) {
      const plugin = JSON.parse(read(`packages/${name}/package.json`)) as {
        version: string;
        dependencies: Record<string, string>;
      };
      expect(plugin.version, name).toBe(pkg.version);
      const range = plugin.dependencies.typlet ?? '(nothing)';
      expect(caretAllows(range, pkg.version), `${name} depends on typlet ${range}`).toBe(true);
    }
  });

  it('is in package-lock.json', () => {
    const lock = JSON.parse(read('package-lock.json')) as { version: string; packages: Record<string, { version: string }> };
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages['']?.version).toBe(pkg.version);
  });

  it('is the version the README loads from jsDelivr', () => {
    const links = read('README.md').split('cdn.jsdelivr.net/npm/typlet@').slice(1);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.slice(0, link.indexOf('/'))).toBe(pkg.version);
  });

  it('has a section in CHANGELOG.md', () => {
    const headings = read('CHANGELOG.md').split('\n').map((line) => line.trimEnd());
    expect(headings).toContain(`## ${pkg.version}`);
  });
});
