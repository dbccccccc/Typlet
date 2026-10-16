import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLicenseBytes, checkSiteLicenses, licenseFiles, SITE_PAGES } from '../scripts/check-licenses.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const created: string[] = [];
const PAGE = '<!doctype html><html><body><footer><a href="LICENSE">License</a><a href="THIRD_PARTY_NOTICES.md">Notices</a></footer></body></html>';

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'typlet-license-test-'));
  created.push(directory);
  const site = join(directory, 'site');
  for (const target of [site, join(site, 'js')]) {
    for (const file of licenseFiles(ROOT)) {
      if (target !== site && file.startsWith('fonts/')) continue;
      mkdirSync(dirname(join(target, file)), { recursive: true });
      copyFileSync(join(ROOT, file), join(target, file));
    }
  }
  mkdirSync(join(site, 'katex'), { recursive: true });
  copyFileSync(join(ROOT, 'node_modules/katex/LICENSE'), join(site, 'katex/LICENSE'));
  for (const page of SITE_PAGES) writeFileSync(join(site, page), PAGE);
  return site;
}

afterEach(() => {
  for (const directory of created.splice(0)) {
    const absolute = resolve(directory);
    if (!absolute.startsWith(resolve(tmpdir()) + sep) || !basename(absolute).startsWith('typlet-license-test-')) throw new Error('unsafe fixture cleanup path');
    rmSync(absolute, { recursive: true, force: true });
  }
});

describe('license distribution artifacts', () => {
  it('accepts complete matching files and legal links without a built site', () => {
    const site = fixture();
    expect(checkSiteLicenses(ROOT, site)).toEqual({ files: 11, pages: 9 });
    expect(checkLicenseBytes(ROOT, site)).toBe(6);
    expect(licenseFiles(ROOT)).toContain('LICENSES/W3C-2023.txt');
  });

  it.each(['LICENSES/W3C-2023.txt', 'js/THIRD_PARTY_NOTICES.md', 'fonts/GUST-FONT-LICENSE.txt', 'fonts/MANIFEST-typlet-newcm-math.txt', 'katex/LICENSE'])('rejects a missing %s', (file) => {
    const site = fixture();
    rmSync(join(site, file));
    expect(() => checkSiteLicenses(ROOT, site)).toThrow(basename(file));
  });

  it.each(['LICENSE', 'LICENSES/W3C-2023.txt', 'js/LICENSES/Apache-2.0.txt', 'fonts/GUST-FONT-LICENSE.txt', 'katex/LICENSE'])('rejects truncated bytes in %s', (file) => {
    const site = fixture();
    const path = join(site, file);
    const bytes = readFileSync(path);
    writeFileSync(path, bytes.subarray(0, bytes.length - 1));
    expect(() => checkSiteLicenses(ROOT, site)).toThrow('license bytes differ');
  });

  it('rejects a wrong but existing legal target', () => {
    const site = fixture();
    writeFileSync(join(site, 'guide.html'), PAGE.replace('href="LICENSE"', 'href="LICENSES/W3C-2023.txt"'));
    expect(() => checkSiteLicenses(ROOT, site)).toThrow('guide.html: missing legal footer link to LICENSE');
  });

  it('rejects an unavailable legal href', () => {
    const site = fixture();
    writeFileSync(join(site, 'index.html'), PAGE.replace('href="LICENSE"', 'href="missing-license.txt"'));
    expect(() => checkSiteLicenses(ROOT, site)).toThrow('missing-license.txt');
  });

  it('rejects a legal href outside the site directory', () => {
    const site = fixture();
    writeFileSync(join(site, 'index.html'), PAGE.replace('href="LICENSE"', 'href="../LICENSE"'));
    expect(() => checkSiteLicenses(ROOT, site)).toThrow('legal href leaves the site');
  });

  it('does not accept external legal links instead of the distributed material', () => {
    const site = fixture();
    writeFileSync(join(site, 'index.html'), PAGE.replace('href="LICENSE"', 'href="https://example.invalid/LICENSE"'));
    expect(() => checkSiteLicenses(ROOT, site)).toThrow('missing legal footer link to LICENSE');
  });

  it('requires footer links rather than links elsewhere in the page', () => {
    const site = fixture();
    writeFileSync(join(site, 'index.html'), PAGE.replaceAll('footer', 'main'));
    expect(() => checkSiteLicenses(ROOT, site)).toThrow('missing legal footer');
  });

  it('requires every expected page', () => {
    const site = fixture();
    rmSync(join(site, 'security.html'));
    expect(() => checkSiteLicenses(ROOT, site)).toThrow('missing site page: security.html');
  });

  it('checks legal links on extra HTML pages too', () => {
    const site = fixture();
    writeFileSync(join(site, 'extra.html'), '<p>Missing legal footer</p>');
    expect(() => checkSiteLicenses(ROOT, site)).toThrow('extra.html: missing legal footer');
  });

  it('exits nonzero when a built artifact is corrupted', () => {
    const site = fixture();
    const script = join(ROOT, 'scripts/check-licenses.mjs');
    const good = spawnSync(process.execPath, [script, site], { encoding: 'utf8' });
    expect(good.status).toBe(0);
    expect(good.stdout).toContain('11 files, 9 pages');
    writeFileSync(join(site, 'LICENSES/W3C-2023.txt'), 'truncated');
    const bad = spawnSync(process.execPath, [script, site], { encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('license bytes differ: LICENSES/W3C-2023.txt');
  });
});
