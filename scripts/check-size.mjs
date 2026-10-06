// Fails when a built bundle exceeds its brotli size budget
// (scripts/size-budgets.json). Run after `npm run build`.

import { existsSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { brotliSize, checkBudgets } from './lib/size.mjs';

const { budgets, modules = {} } = JSON.parse(readFileSync(new URL('./size-budgets.json', import.meta.url), 'utf8'));
const sizes = Object.fromEntries(
  Object.keys(budgets).map((file) => [file, existsSync(file) ? brotliSize(readFileSync(file)) : null]),
);

// Modules are bundled in memory, the way the entry points are built.
for (const file of Object.keys(modules)) {
  const result = await build({
    entryPoints: [file],
    bundle: true,
    minify: true,
    target: 'es2022',
    format: 'esm',
    write: false,
    logLevel: 'error',
  });
  sizes[file] = brotliSize(Buffer.from(result.outputFiles[0].contents));
}

const results = checkBudgets({ ...budgets, ...modules }, sizes);
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
for (const { file, limit, size, ok } of results) {
  const measured = size === null ? 'missing (run npm run build)' : kb(size);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${file}: ${measured} brotli, budget ${kb(limit)}`);
}
if (results.some((r) => !r.ok)) process.exit(1);
