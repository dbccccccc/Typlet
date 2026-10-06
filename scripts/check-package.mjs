// Checks the package as npm would publish it. Packs it, installs the tarball
// alone in a new project, uses every entry point there
// (scripts/consumer/use.mjs), and type-checks programs that import and
// require it under each of TypeScript's module resolutions. Run after
// `npm run build`.

import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const consumer = join(root, 'scripts/consumer');

function npm(args, cwd) {
  const options = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] };
  // Under `npm run`, npm says where its script is. Otherwise a shell finds it.
  const script = process.env.npm_execpath;
  if (script?.endsWith('.js')) return execFileSync(process.execPath, [script, ...args], options);
  return execSync(`npm ${args.map((arg) => JSON.stringify(arg)).join(' ')}`, options);
}

// What the tarball may hold, and what it must.
const ALLOWED = /^(dist\/|fonts\/|LICENSES\/|LICENSE$|README\.md$|THIRD_PARTY_NOTICES\.md$|package\.json$)/;
const REQUIRED = [
  'LICENSE',
  'LICENSES/Apache-2.0.txt',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'dist/index.js',
  'dist/index.cjs',
  'dist/index.d.ts',
  'dist/cjs/index.d.ts',
  'dist/cjs/package.json',
  'dist/mathml.js',
  'dist/typlet.min.js',
  'dist/cli.js',
  'fonts/typlet.css',
  'fonts/GUST-FONT-LICENSE.txt',
];

const project = mkdtempSync(join(tmpdir(), 'typlet-package-'));
try {
  const [packed] = JSON.parse(npm(['pack', '--json', '--pack-destination', project], root));
  const files = packed.files.map((file) => file.path);
  const unexpected = files.filter((file) => !ALLOWED.test(file));
  const missing = REQUIRED.filter((file) => !files.includes(file));
  if (unexpected.length > 0) throw new Error(`the tarball holds files it shouldn't: ${unexpected.join(', ')}`);
  if (missing.length > 0) throw new Error(`the tarball lacks ${missing.join(', ')}`);
  const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  console.log(`${packed.filename}: ${files.length} files, ${mb(packed.size)} packed, ${mb(packed.unpackedSize)} unpacked`);

  // The package has no dependencies, so it installs without the registry.
  writeFileSync(join(project, 'package.json'), '{ "name": "typlet-consumer", "private": true, "type": "module" }\n');
  npm(['install', '--offline', '--no-audit', '--no-fund', '--ignore-scripts', `./${packed.filename}`], project);

  for (const file of ['use.mjs', 'esm.ts', 'cjs.cts']) copyFileSync(join(consumer, file), join(project, file));
  execFileSync(process.execPath, ['use.mjs'], { cwd: project, stdio: 'inherit' });

  // The declarations, as each kind of TypeScript project resolves them. A
  // bundler's project has no CommonJS modules.
  const tsPackage = createRequire(import.meta.url).resolve('typescript/package.json');
  const tsc = join(dirname(tsPackage), JSON.parse(readFileSync(tsPackage, 'utf8')).bin.tsc);
  const projects = [
    ['nodenext', 'nodenext', ['esm.ts', 'cjs.cts']],
    ['node16', 'node16', ['esm.ts', 'cjs.cts']],
    ['esnext', 'bundler', ['esm.ts']],
  ];
  for (const [module, moduleResolution, sources] of projects) {
    const flags = ['--noEmit', '--strict', '--target', 'es2022', '--lib', 'es2022,dom', '--skipLibCheck', 'false'];
    execFileSync(process.execPath, [tsc, ...flags, '--module', module, '--moduleResolution', moduleResolution, ...sources], { cwd: project, stdio: 'inherit' });
    console.log(`ok    types with moduleResolution ${moduleResolution}: ${sources.join(', ')}`);
  }
} finally {
  rmSync(project, { recursive: true, force: true });
}
