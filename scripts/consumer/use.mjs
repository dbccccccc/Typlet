// Uses the installed package as an application would: scripts/check-package.mjs
// runs this in a project that has only the packed tarball installed. It
// prints a line per check, and fails if any check fails.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
let failed = false;
async function check(name, run) {
  try {
    console.log(`ok    ${name}: ${await run()}`);
  } catch (error) {
    failed = true;
    console.log(`FAIL  ${name}: ${String(error.message).split('\n')[0]}`);
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

await check('import typlet', async () => {
  const typlet = await import('typlet');
  const html = typlet.renderToString('x^2 + sqrt(y)/2');
  expect(html.includes('typlet-html') && html.includes('<math'), 'no HTML with MathML');
  return `version ${typlet.version}, for Typst ${typlet.typstVersion}`;
});
await check('require typlet', () => {
  const typlet = require('typlet');
  expect(typlet.renderToString('x^2', { displayMode: true }).includes('typlet-display'), 'no display formula');
  return Object.keys(typlet).sort().join(', ');
});
await check('import typlet/mathml', async () => {
  const html = (await import('typlet/mathml')).renderToString('a/b');
  expect(html.includes('<mfrac>') && !html.includes('typlet-html'), 'not MathML alone');
  return `${html.length} characters`;
});
await check('require typlet/mathml', () => `${require('typlet/mathml').renderToString('a/b').length} characters`);
for (const name of ['auto-render', 'copy-typst', 'element']) {
  await check(`import typlet/contrib/${name}`, async () => Object.keys(await import(`typlet/contrib/${name}`)).join(', '));
  await check(`require typlet/contrib/${name}`, () => Object.keys(require(`typlet/contrib/${name}`)).join(', '));
}
await check('errors', async () => {
  const { renderToString, TypletError } = await import('typlet');
  try {
    renderToString('x + foo');
  } catch (error) {
    expect(error instanceof TypletError && error.kind === 'eval', 'not a TypletError of kind eval');
    return error.message;
  }
  throw new Error('an unknown variable rendered');
});
await check('typlet/fonts/typlet.css', () => {
  const css = require.resolve('typlet/fonts/typlet.css');
  const fonts = [...readFileSync(css, 'utf8').matchAll(/url\(([^)]+)\)/g)].map((match) => match[1]);
  const missing = fonts.filter((font) => !existsSync(join(dirname(css), font)));
  expect(fonts.length > 0 && missing.length === 0, `missing fonts: ${missing.join(', ')}`);
  return `${fonts.length} fonts`;
});
await check('typlet/dist/typlet.min.js', () => {
  const file = require.resolve('typlet/dist/typlet.min.js');
  const version = require('typlet/package.json').version;
  expect(readFileSync(file, 'utf8').startsWith(`/*! Typlet ${version} `), 'the banner has another version');
  return `Typlet ${version}`;
});
await check('the typlet command', () => {
  const bin = join(dirname(require.resolve('typlet/package.json')), require('typlet/package.json').bin.typlet);
  const html = execFileSync(process.execPath, [bin, 'x^2', '--display-mode'], { encoding: 'utf8' });
  expect(html.includes('typlet-display'), 'no display formula');
  return `${html.length} characters`;
});

if (failed) process.exit(1);
