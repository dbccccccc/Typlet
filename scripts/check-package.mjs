// Checks the package as npm would publish it. Packs it, installs the tarball
// alone in a new project, uses every entry point there
// (scripts/consumer/use.mjs), and type-checks programs that import and
// require it under each of TypeScript's module resolutions. Then packs the
// markdown-it plugin and type-checks a program that uses it against the
// types of markdown-it 14 and 15. Run after `npm run build`.

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
  'LICENSES/W3C-2023.txt',
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
  'fonts/MANIFEST-typlet-newcm-math.txt',
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

  // The markdown-it plugin's declaration, against the types markdown-it 14
  // gets from DefinitelyTyped and markdown-it 15's own, which export the
  // class as a type only. The plugin's dependency on typlet is installed.
  const [plugin] = JSON.parse(npm(['pack', '--json', '--pack-destination', project], join(root, 'packages/markdown-it-typlet')));
  npm(['install', '--offline', '--no-audit', '--no-fund', '--ignore-scripts', '--legacy-peer-deps', `./${plugin.filename}`], project);
  copyFileSync(join(consumer, 'markdown-it.mts'), join(project, 'markdown-it.mts'));
  const markdownIt = JSON.parse(readFileSync(join(root, 'node_modules/markdown-it/package.json'), 'utf8'));
  const peers = [
    ['14', join(root, 'node_modules/@types/markdown-it/index.d.ts')],
    ['15', join(root, 'node_modules/markdown-it', markdownIt.exports['.'].import.types)],
  ];
  for (const [version, types] of peers) {
    for (const moduleResolution of ['nodenext', 'bundler']) {
      const config = `markdown-it-${version}-${moduleResolution}.json`;
      const compilerOptions = {
        noEmit: true, strict: true, target: 'es2022', lib: ['es2022', 'dom'], skipLibCheck: false,
        module: moduleResolution === 'bundler' ? 'esnext' : 'nodenext', moduleResolution,
        // markdown-it 14's types use linkify-it 5's from DefinitelyTyped; version 15 brings its own.
        paths: { 'markdown-it': [types], ...(version === '14' ? { 'linkify-it': [join(root, 'node_modules/@types/linkify-it/index.d.ts')] } : {}) },
      };
      writeFileSync(join(project, config), JSON.stringify({ compilerOptions, files: ['markdown-it.mts'] }));
      execFileSync(process.execPath, [tsc, '-p', config], { cwd: project, stdio: 'inherit' });
      console.log(`ok    markdown-it-typlet types with markdown-it ${version}, ${moduleResolution}`);
    }
  }
} finally {
  rmSync(project, { recursive: true, force: true });
}
