import { resolve } from 'node:path';
import site from '../config/site.mjs';
import { refreshSnapshot } from '../lib/repositories.mjs';

try {
  const { snapshot, cached } = await refreshSnapshot({
    file: resolve('data/repositories.json'), owner: site.owner,
    token: process.env.GITHUB_TOKEN?.trim() || undefined, warn: console.warn
  });
  console.log(`${cached ? 'Cached' : 'Refreshed'} ${snapshot.repositories.length} public repositories for ${site.owner}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}