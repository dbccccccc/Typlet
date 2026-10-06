// Fails when a source file breaks the header rules in scripts/lib/headers.mjs.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { checkHeaders } from './lib/headers.mjs';

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const typstVersion = /typstVersion = '([^']+)'/.exec(readFileSync('src/version.ts', 'utf8'))[1];
const files = walk('src').map((path) => ({
  path: relative('.', path).split(sep).join('/'),
  text: readFileSync(path, 'utf8'),
}));
const problems = checkHeaders(files, readFileSync('docs/UPSTREAM.md', 'utf8'), typstVersion);

for (const problem of problems) console.error(problem);
console.log(problems.length === 0 ? `Headers ok (${files.length} files).` : `${problems.length} header problem(s).`);
if (problems.length > 0) process.exit(1);
