// Typlet original: not ported from Typst.
// Checks license materials in the built documentation site without fetching external URLs.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fromHtmlIsomorphic as fromHtml } from 'hast-util-from-html-isomorphic';

export const SITE_PAGES = ['index', 'guide', 'code', 'integrations', 'supported', 'gallery', 'playground', 'compare', 'security'].map((name) => name + '.html');

/** Legal material that must survive distribution byte for byte. */
export function licenseFiles(root) {
  const licenses = readdirSync(join(root, 'LICENSES'), { recursive: true })
    .filter((file) => statSync(join(root, 'LICENSES', file)).isFile())
    .map((file) => 'LICENSES/' + file.replaceAll('\\', '/'));
  return ['LICENSE', 'THIRD_PARTY_NOTICES.md', ...licenses.sort(), 'fonts/GUST-FONT-LICENSE.txt', 'fonts/MANIFEST-typlet-newcm-math.txt'];
}

/** Compares actual files, including truncation, rather than only directory entries. */
export function checkLicenseBytes(source, target, files = licenseFiles(source)) {
  for (const file of files) {
    let actual;
    try { actual = readFileSync(join(target, file)); }
    catch (cause) { throw new Error('cannot read license artifact: ' + file, { cause }); }
    if (!actual.equals(readFileSync(join(source, file)))) throw new Error('license bytes differ: ' + file);
  }
  return files.length;
}

/** @param {import('hast').Nodes} root @param {string} tag */
function elements(root, tag) {
  const stack = [root];
  /** @type {import('hast').Element[]} */
  const found = [];
  while (stack.length) {
    const node = stack.pop();
    if (node.type === 'element' && node.tagName === tag) found.push(node);
    if ('children' in node) for (const child of node.children) stack.push(child);
  }
  return found;
}

function checkNoticeReferences(root) {
  const notice = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  for (const file of new Set(notice.match(/LICENSES\/[A-Za-z0-9._/-]+/g) ?? [])) {
    if (!statSync(join(root, file)).isFile()) throw new Error('unavailable notice reference: ' + file);
  }
}

/** Checks root legal files, the bundles' relative notices, and every page footer. */
export function checkSiteLicenses(source, site) {
  site = resolve(site);
  const files = licenseFiles(source);
  let checked = checkLicenseBytes(source, site, files);
  checked += checkLicenseBytes(source, join(site, 'js'), files.filter((file) => !file.startsWith('fonts/')));
  checked += checkLicenseBytes(join(source, 'node_modules/katex'), join(site, 'katex'), ['LICENSE']);
  checkNoticeReferences(site);
  checkNoticeReferences(join(site, 'js'));
  const pages = readdirSync(site, { recursive: true }).filter((file) => file.endsWith('.html')).map((file) => file.replaceAll('\\', '/'));
  for (const page of SITE_PAGES) if (!pages.includes(page)) throw new Error('missing site page: ' + page);
  for (const page of pages) {
    const tree = fromHtml(readFileSync(join(site, page), 'utf8'));
    const footers = elements(tree, 'footer');
    if (!footers.length) throw new Error(page + ': missing legal footer');
    const links = new Set();
    for (const footer of footers) {
      for (const anchor of elements(footer, 'a')) {
        const href = String(anchor.properties.href ?? '');
        if (!href) continue;
        const url = new URL(href, pathToFileURL(join(site, page)));
        if (url.protocol !== 'file:') continue;
        const target = fileURLToPath(url);
        const file = relative(site, target);
        if (isAbsolute(file) || file === '..' || file.startsWith('..' + sep)) throw new Error(page + ': legal href leaves the site: ' + href);
        if (!statSync(target).isFile()) throw new Error(page + ': unavailable legal href: ' + href);
        links.add(file.replaceAll('\\', '/'));
      }
    }
    for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
      if (!links.has(file)) throw new Error(page + ': missing legal footer link to ' + file);
    }
  }
  return { files: checked, pages: pages.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '..');
  const result = checkSiteLicenses(root, resolve(process.argv[2] ?? join(root, 'site')));
  console.log('License artifacts ok (' + result.files + ' files, ' + result.pages + ' pages).');
}
