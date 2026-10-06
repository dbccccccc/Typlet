import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as main from '../src/index.js';
import * as mathml from '../src/mathml.js';
import { root } from './helpers.js';

describe('version', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
    expect(main.version).toBe(pkg.version);
  });

  it('is exported by both entry points', () => {
    expect(mathml.version).toBe(main.version);
    expect(mathml.typstVersion).toBe(main.typstVersion);
  });
});
