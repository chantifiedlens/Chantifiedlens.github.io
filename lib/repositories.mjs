import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { classify } from '../config/categories.mjs';

export const SCHEMA_VERSION = 1;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const text = value => typeof value === 'string' ? value.trim() : '';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

export function normalizeRepository(raw, owner) {
  if (!raw || raw.private === true || !Number.isSafeInteger(raw.id) || raw.id <= 0
    || typeof raw.name !== 'string' || ['.', '..'].includes(raw.name)
    || !/^[\w.-]+$/.test(raw.name) || text(raw.owner?.login).toLowerCase() !== owner.toLowerCase()) return null;
  const topics = [...new Set((Array.isArray(raw.topics) ? raw.topics : [])
    .filter(t => typeof t === 'string' && /^[a-z0-9-]+$/i.test(t.trim())).map(t => t.trim().toLowerCase()))].sort();
  // Construct URLs from validated identifiers instead of trusting arbitrary API URLs.
  const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(raw.name)}`;
  return {
    id: raw.id, name: raw.name, url,
    description: text(raw.description) || 'No description provided yet. Explore the README on GitHub for details.',
    topics, language: text(raw.language) || null, stars: count(raw.stargazers_count),
    updatedAt: date(raw.updated_at), pushedAt: date(raw.pushed_at),
    isTemplate: raw.is_template === true, archived: raw.archived === true, fork: raw.fork === true,
    license: text(raw.license?.spdx_id) && raw.license.spdx_id !== 'NOASSERTION' ? text(raw.license.spdx_id) : null,
    defaultBranch: text(raw.default_branch) || null
  };
}

export async function githubRequest(url, { token, fetchImpl = fetch, sleep = delay } = {}) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://api.github.com') throw new Error('Unexpected GitHub API origin.');
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'chantified-lens-static-showcase', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
    } catch {
      if (attempt === 2) throw new Error('GitHub API could not be reached after three attempts.');
      await sleep(500 * 2 ** attempt); continue;
    }
    if (response.ok) return response;
    if (response.status >= 500 && attempt < 2) { await sleep(500 * 2 ** attempt); continue; }
    // Do not print response bodies, request headers or credentials.
    throw new Error(`GitHub API returned HTTP ${response.status}${[403, 429].includes(response.status) ? ' (access or rate limit; try a build-time token)' : ''}.`);
  }
}

export async function fetchRepositories(owner, options = {}) {
  if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(owner)) throw new Error('Invalid GitHub owner.');
  const account = await (await githubRequest(`https://api.github.com/users/${owner}`, options)).json();
  if (!['User', 'Organization'].includes(account.type) || text(account.login).toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Unexpected GitHub account response.');
  }
  let url = `https://api.github.com/${account.type === 'Organization' ? 'orgs' : 'users'}/${owner}/repos?type=public&per_page=100&sort=updated`;
  const seen = new Set(), repositories = new Map();
  let skipped = 0;
  while (url) {
    if (seen.has(url) || seen.size >= 1000) throw new Error('Unexpected GitHub pagination loop.');
    const nextUrl = new URL(url);
    const expectedPath = `/${account.type === 'Organization' ? 'orgs' : 'users'}/${owner}/repos`;
    if (nextUrl.origin !== 'https://api.github.com' || nextUrl.pathname !== expectedPath) throw new Error('Unexpected pagination URL.');
    seen.add(url);
    const response = await githubRequest(url, options);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error('Unexpected GitHub repositories response.');
    for (const raw of page) {
      const repo = normalizeRepository(raw, owner);
      if (repo) repositories.set(repo.id, repo); else skipped++;
    }
    const link = response.headers.get('link') ?? '';
    url = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
  }
  if (skipped) options.warn?.(`${skipped} invalid, private or foreign repository record(s) were ignored.`);
  return { schemaVersion: SCHEMA_VERSION, owner, fetchedAt: new Date().toISOString(),
    repositories: [...repositories.values()].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.name.localeCompare(b.name)) };
}

export function validateSnapshot(value, owner) {
  if (!value || value.schemaVersion !== SCHEMA_VERSION || value.owner !== owner || !date(value.fetchedAt)
    || Date.parse(value.fetchedAt) > Date.now() + 300000 || !Array.isArray(value.repositories)) throw new Error('Invalid or incompatible repository snapshot.');
  const ids = new Set();
  for (const repo of value.repositories) {
    const normalized = normalizeRepository({ id: repo?.id, name: repo?.name, owner: { login: owner },
      description: repo?.description, topics: repo?.topics, language: repo?.language,
      stargazers_count: repo?.stars, updated_at: repo?.updatedAt, pushed_at: repo?.pushedAt,
      is_template: repo?.isTemplate, archived: repo?.archived, fork: repo?.fork,
      license: { spdx_id: repo?.license }, default_branch: repo?.defaultBranch }, owner);
    if (!normalized || Object.keys(normalized).some(key => JSON.stringify(repo[key]) !== JSON.stringify(normalized[key]))
      || ids.has(repo.id)) throw new Error('Invalid cached repository record.');
    ids.add(repo.id);
  }
  return value;
}

export async function readSnapshot(file, owner) {
  return validateSnapshot(JSON.parse(await readFile(file, 'utf8')), owner);
}

export async function refreshSnapshot({ file, owner, ...options }) {
  let snapshot;
  try { snapshot = await fetchRepositories(owner, options); }
  catch (error) {
    try { snapshot = await readSnapshot(file, owner); }
    catch { throw new Error(`${error.message} No valid cached snapshot is available; refusing to publish an empty catalog.`); }
    options.warn?.(`GitHub refresh failed. Using cached public data from ${snapshot.fetchedAt}.`);
    return { snapshot, cached: true };
  }
  validateSnapshot(snapshot, owner);
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n');
  await rename(temporary, file);
  return { snapshot, cached: false };
}

export function decorateRepositories(snapshot) {
  return snapshot.repositories.map(repo => ({ ...repo, categoryIds: classify(repo.topics),
    searchText: [repo.name, repo.description, repo.language, ...repo.topics].join(' ').toLowerCase() }));
}