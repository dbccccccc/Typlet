// Builds the npm package into dist/:
// - ESM and CJS bundles for each entry point (`typlet`, `typlet/mathml`);
// - a minified browser bundle exposing the global `typlet`, like katex.min.js;
// - the extensions in contrib/, as ESM and CJS modules that import `typlet`,
//   and as browser bundles that use the global `typlet`, like KaTeX's;
// - the `typlet` command, which imports the ESM bundle;
// - type declarations, for ES modules and, in dist/cjs/, for CommonJS.
//
// The entry points are built in two passes. The first bundles the sources,
// unminified. The functions typical formulas call are then marked so that V8
// compiles them along with the bundle, not one by one during the first
// formula (scripts/lib/eager.mjs), and the second pass minifies the result
// into each format. `--no-eager` leaves the marking out, to compare.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { markEager } from './lib/eager.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const banner = {
  js: `/*! Typlet ${pkg.version} | MIT License | Third-party notices: THIRD_PARTY_NOTICES.md */`,
};

const eager = !process.argv.includes('--no-eager');
const sources = { index: 'src/index.ts', mathml: 'src/mathml.ts' };
const common = {
  bundle: true,
  minify: true,
  sourcemap: true,
  // ES2022 keeps class fields native: lowering them to helper calls slows
  // rendering by a quarter. MathML Core browsers all support ES2022.
  target: 'es2022',
  banner,
  logLevel: 'warning',
};

// The extensions, with the globals their browser bundles define: auto-render's
// is the function itself, as in KaTeX.
const contrib = {
  'auto-render': { globalName: 'renderMathInElement', footer: 'renderMathInElement=renderMathInElement.default;' },
  'copy-typst': { globalName: 'typletCopyTypst' },
  element: { globalName: 'typletElement' },
};

/** Resolves `typlet` to the global the browser bundle defines. */
const typletGlobal = {
  name: 'typlet-global',
  setup(b) {
    b.onResolve({ filter: /^typlet$/ }, () => ({ path: 'typlet', namespace: 'typlet-global' }));
    b.onLoad({ filter: /.*/, namespace: 'typlet-global' }, () => ({ contents: 'module.exports = globalThis.typlet;' }));
  },
};

/** Keeps the command's import of the package's entry point, instead of bundling it again. */
const cliImport = {
  name: 'cli-import',
  setup(b) {
    b.onResolve({ filter: /^\.\/index\.js$/ }, (args) => (args.importer.endsWith('cli.ts') ? { path: './index.js', external: true } : undefined));
  },
};

/** Renders the typical formulas with a bundle, and reports the functions that called and a digest of the output. */
function profile(bundle) {
  const worker = fileURLToPath(new URL('./lib/profile-formulas.mjs', import.meta.url));
  return JSON.parse(execFileSync(process.execPath, [worker, bundle], { encoding: 'utf8', maxBuffer: 1 << 26 }));
}

/**
 * The first pass: bundles an entry point into `<name>.mjs` in the work
 * directory, with its source map, and marks the functions typical formulas
 * call. Returns the file, and the digest of what the formulas rendered to.
 */
async function bundleEntry(name, source) {
  const file = join(work, `${name}.mjs`);
  const result = await build({
    entryPoints: [source],
    bundle: true,
    format: 'esm',
    target: common.target,
    sourcemap: 'external',
    outfile: file,
    write: false,
    logLevel: 'warning',
  });
  let code = result.outputFiles.find((f) => f.path.endsWith('.mjs')).text;
  let map = JSON.parse(result.outputFiles.find((f) => f.path.endsWith('.map')).text);
  writeFileSync(file, code);
  const { functions, digest } = profile(file);
  if (eager) {
    const marked = markEager(code, map, functions);
    ({ code, map } = marked);
    const { declarations, expressions, unmarked } = marked.counts;
    console.log(`${name}: ${declarations + expressions} of the ${functions.length} functions typical formulas call are compiled eagerly (${unmarked} are methods).`);
  }
  writeFileSync(file, `${code}\n//# sourceMappingURL=${name}.mjs.map\n`);
  writeFileSync(`${file}.map`, JSON.stringify(map));
  return { file, digest };
}

rmSync('dist', { recursive: true, force: true });
// The first pass's bundles, outside dist/ so that they are never published.
const work = resolve('node_modules/.cache/typlet-build');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const bundles = Object.fromEntries(
  await Promise.all(Object.entries(sources).map(async ([name, source]) => [name, await bundleEntry(name, source)])),
);
const entryPoints = Object.fromEntries(Object.entries(bundles).map(([name, { file }]) => [name, file]));

await Promise.all([
  build({ ...common, entryPoints, outdir: 'dist', format: 'esm' }),
  build({ ...common, entryPoints, outdir: 'dist', format: 'cjs', outExtension: { '.js': '.cjs' } }),
  build({
    ...common,
    entryPoints: [entryPoints.index],
    outfile: 'dist/typlet.min.js',
    format: 'iife',
    globalName: 'typlet',
  }),
  ...Object.entries(contrib).flatMap(([name, { globalName, footer }]) => [
    build({ ...common, entryPoints: [`contrib/${name}.ts`], outfile: `dist/contrib/${name}.js`, format: 'esm', external: ['typlet'] }),
    build({ ...common, entryPoints: [`contrib/${name}.ts`], outfile: `dist/contrib/${name}.cjs`, format: 'cjs', external: ['typlet'] }),
    build({
      ...common,
      entryPoints: [`contrib/${name}.ts`],
      outfile: `dist/contrib/${name}.min.js`,
      format: 'iife',
      globalName,
      plugins: [typletGlobal],
      ...(footer ? { footer: { js: footer } } : {}),
    }),
  ]),
  build({
    ...common,
    entryPoints: ['src/bin.ts'],
    outfile: 'dist/cli.js',
    format: 'esm',
    platform: 'node',
    plugins: [cliImport],
    banner: { js: `#!/usr/bin/env node\n${banner.js}` },
  }),
]);

// The built entry points must render the typical formulas as the first
// pass's bundles did, before any function was marked.
for (const [name, { digest }] of Object.entries(bundles)) {
  if (profile(resolve(`dist/${name}.js`)).digest !== digest) throw new Error(`dist/${name}.js renders the typical formulas differently from its sources`);
}
rmSync(work, { recursive: true, force: true });

// Type declarations. Runs the TypeScript compiler from node_modules directly so
// the build works the same on every platform. TypeScript 7 doesn't export its
// CLI path, so find it through the package's `bin` field. The extensions'
// declarations come second: they import the package's.
const tsPackage = createRequire(import.meta.url).resolve('typescript/package.json');
const tsc = join(dirname(tsPackage), JSON.parse(readFileSync(tsPackage, 'utf8')).bin.tsc);
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.contrib.json'], { stdio: 'inherit' });

// The declarations again, for CommonJS programs. TypeScript reads a `.d.ts`
// file of this package, whose `type` is `module`, as an ES module, and its
// `node16` resolution refuses to `require` one. dist/cjs/ holds the same
// files under a package.json that says they are CommonJS, and the `require`
// conditions of package.json's `exports` point there.
for (const file of readdirSync('dist', { recursive: true })) {
  if (!file.endsWith('.d.ts')) continue;
  mkdirSync(dirname(join('dist/cjs', file)), { recursive: true });
  copyFileSync(join('dist', file), join('dist/cjs', file));
}
writeFileSync('dist/cjs/package.json', '{ "type": "commonjs" }\n');

console.log('Built dist/.');
