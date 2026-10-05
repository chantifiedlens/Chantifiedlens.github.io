import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import site from '../config/site.mjs';
import { categories, technologies, icons } from '../config/categories.mjs';
import { readSnapshot } from '../lib/repositories.mjs';

const root = resolve('_site');
const prefix = process.env.SITE_PATH_PREFIX || '/';
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : join(directory, entry.name)))).flat();
}
const htmlFiles = (await files(root)).filter(file => file.endsWith('.html'));
assert.equal(htmlFiles.length, categories.length + technologies.filter(t => t.id !== 'other').length + 3, 'Unexpected generated page count');
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  assert.equal((html.match(/<h1\b/g) || []).length, 1, `One h1 required in ${file}`);
  assert.ok(html.includes('<html lang="en">'), `Document language missing: ${file}`);
  assert.ok(!html.includes('{{') && !html.includes('{%'), `Unrendered template: ${file}`);
  assert.equal((html.match(/<img class="brand-logo"[^>]*src="[^"]*\/images\/CLsketch\.png"/g) || []).length, 2, `Header and footer must use the Chantified Lens logo: ${file}`);
  assert.ok(!html.includes('class="brand-mark"'), `Old text logo remains: ${file}`);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size, `Duplicate IDs in ${file}`);
  for (const [, attribute] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const link = attribute.replaceAll('&amp;', '&');
    if (/^(https?:|mailto:)/.test(link)) continue;
    if (link.startsWith('#')) { assert.ok(ids.includes(link.slice(1)), `Missing anchor ${link} in ${file}`); continue; }
    assert.ok(link.startsWith(prefix), `Incorrect Pages base path: ${link} in ${file}`);
    const pathname = link.slice(prefix.length).split(/[?#]/)[0];
    let target = resolve(root, pathname || '.');
    assert.ok(target === root || target.startsWith(root + '\\') || target.startsWith(root + '/'), 'Link escapes output');
    const metadata = await stat(target).catch(() => null);
    assert.ok(metadata, `Broken local link ${link} in ${file}`);
    if (metadata.isDirectory()) target = join(target, 'index.html');
    await stat(target);
    if (link.includes('#')) {
      const destination = await readFile(target, 'utf8');
      assert.ok(destination.includes(`id="${link.split('#')[1]}"`), `Broken destination anchor ${link}`);
    }
  }
}
for (const icon of Object.values(icons)) {
  assert.deepEqual(await readFile(join(root, 'images', icon.file)), await readFile(resolve('images', icon.file)), `Original image changed: ${icon.file}`);
}
assert.deepEqual(await readFile(join(root, 'images', 'CLsketch.png')), await readFile(resolve('images', 'CLsketch.png')), 'Original Chantified Lens logo changed');
const snapshot = await readSnapshot(resolve('data/repositories.json'), site.owner);
const catalog = await readFile(join(root, 'repositories', 'index.html'), 'utf8');
assert.equal((catalog.match(/data-repository\b/g) || []).length, snapshot.repositories.length, 'Global catalog must include each repository once');
for (const category of categories) await stat(join(root, category.path, 'index.html'));
console.log(`Verified ${htmlFiles.length} static pages, local links, anchors, unique catalog cards and byte-for-byte original images.`);