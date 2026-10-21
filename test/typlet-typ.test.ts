// Checks contrib/typlet.typ with the `typst` command, where one is installed:
// the HTML export carries each formula in the attributes of a `<typlet-math>`
// element, and the same document compiles to pages with the document's
// preamble. Without the command, the tests are skipped.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const typst = spawnSync('typst', ['--version'], { encoding: 'utf8' });

const DOCUMENT = `#import "typlet.typ": typlet-math, typlet-assets
#typlet-assets(preamble: "#let QQQ = $bb(Q)$")

Let #typlet-math(\`QQQ + x\`) hold, and #typlet-math("a < b & c") too. Then
#typlet-math(\`\`\`
a &= b \\
c &= d // comment
\`\`\`, block: true)
and #typlet-math(\`f: QQQ -> QQQ\`, preamble: "#let RR = $bb(R)$") with #typlet-math(" x ") spaces.
`;

describe.skipIf(typst.status !== 0)('contrib/typlet.typ with the typst command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'typlet-typ-'));
  copyFileSync(new URL('../contrib/typlet.typ', import.meta.url), join(dir, 'typlet.typ'));
  writeFileSync(join(dir, 'doc.typ'), DOCUMENT);
  // Typst 0.13 and 0.14 have `target()` only with the feature flag.
  const compile = (args: string[]) => spawnSync('typst', ['compile', '--features', 'html', ...args], { cwd: dir, encoding: 'utf8' });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('writes each formula as an element with its source in an attribute', () => {
    const result = compile(['--format', 'html', 'doc.typ', 'doc.html']);
    expect(result.status, result.stderr).toBe(0);
    const html = readFileSync(join(dir, 'doc.html'), 'utf8');
    // Inline, in its paragraph, carried by a span.
    expect(html).toMatch(/<p>Let.*<span><typlet-math source="QQQ \+ x"><\/typlet-math><\/span>.*hold/);
    expect(html).toContain('<typlet-math source="a < b &amp; c">');
    // Display, with the line break and the comment of the raw block kept.
    expect(html).toContain('<typlet-math source="a &amp;= b \\\nc &amp;= d // comment" display></typlet-math>');
    expect(html).toContain('<typlet-math source="f: QQQ -> QQQ" preamble="#let RR = $bb(R)$">');
    expect(html).toContain('<typlet-math source="x">');
    expect(html).toContain('typletElement.elementOptions.preamble = "#let QQQ = $bb(Q)$";');
  });

  it('compiles the same document to pages, with the document’s preamble', () => {
    const result = compile(['doc.typ', 'doc.pdf']);
    expect(result.status, result.stderr).toBe(0);
  });
});
