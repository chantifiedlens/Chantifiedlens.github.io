import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SCHEMA_VERSION, normalizeRepository, githubRequest, fetchRepositories,
  validateSnapshot, readSnapshot, refreshSnapshot, decorateRepositories
} from '../lib/repositories.mjs';

const owner = 'Example-Owner';
const api = 'https://api.github.com';
const accountUrl = `${api}/users/${owner}`;
const reposUrl = (kind = 'users') => `${api}/${kind}/${owner}/repos?type=public&per_page=100&sort=updated`;
const rawRepo = (overrides = {}) => ({
  id: 1, name: 'example.repo', private: false, owner: { login: owner },
  description: '  A useful repository  ', topics: ['github-actions', 'microsoft-fabric'],
  language: ' JavaScript ', stargazers_count: 4,
  updated_at: '2026-01-02T03:04:05Z', pushed_at: '2026-01-01T00:00:00Z',
  is_template: true, archived: false, fork: false,
  license: { spdx_id: 'MIT' }, default_branch: ' main ', ...overrides
});
const json = (value, init = {}) => new Response(JSON.stringify(value), {
  ...init, headers: { 'content-type': 'application/json', ...init.headers }
});
const snapshot = (overrides = {}) => ({
  schemaVersion: SCHEMA_VERSION, owner, fetchedAt: '2026-01-03T00:00:00.000Z',
  repositories: [normalizeRepository(rawRepo(), owner)], ...overrides
});
function queuedFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.ok(responses.length, `Unexpected fetch: ${url}`);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(url, options) : next;
  };
  return { fetchImpl, calls, remaining: responses };
}
const account = (type = 'User', login = owner) => json({ type, login });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'chantified-repositories-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, file: join(dir, 'nested', 'repositories.json') };
}
async function seed(file, value = snapshot()) {
  await mkdir(join(file, '..'), { recursive: true });
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(file, content);
  return content;
}
const offline = () => ({
  fetchImpl: async () => { throw new Error('offline'); }, sleep: async () => {}
});

test('normalization retains canonical public metadata and constructs safe GitHub URLs', () => {
  const repo = normalizeRepository(rawRepo({
    html_url: 'javascript:alert(1)', url: 'https://evil.example/repo',
    owner: { login: owner.toLowerCase() },
    topics: [' MICROSOFT-FABRIC ', 'github-actions', 'GitHub-Actions', 'bad_topic', 'bad topic', '', null, 7]
  }), owner);
  assert.deepEqual(repo, {
    id: 1, name: 'example.repo', url: `https://github.com/${owner}/example.repo`,
    description: 'A useful repository', topics: ['github-actions', 'microsoft-fabric'],
    language: 'JavaScript', stars: 4, updatedAt: '2026-01-02T03:04:05.000Z',
    pushedAt: '2026-01-01T00:00:00.000Z', isTemplate: true, archived: false, fork: false,
    license: 'MIT', defaultBranch: 'main'
  });
  assert.equal('html_url' in repo, false);
  assert.equal('owner' in repo, false);
});

test('missing optional metadata uses safe defaults, not fabricated counts or dates', () => {
  const repo = normalizeRepository({ id: 1, name: 'minimal', owner: { login: owner } }, owner);
  assert.deepEqual(repo, {
    id: 1, name: 'minimal', url: `https://github.com/${owner}/minimal`,
    description: 'No description provided yet. Explore the README on GitHub for details.',
    topics: [], language: null, stars: null, updatedAt: null, pushedAt: null,
    isTemplate: false, archived: false, fork: false, license: null, defaultBranch: null
  });
  for (const value of [-1, 1.5, '4', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeRepository(rawRepo({ stargazers_count: value }), owner).stars, null);
  }
  assert.equal(normalizeRepository(rawRepo({ stargazers_count: 0 }), owner).stars, 0);
  for (const value of [undefined, null, '', 'not a date', 123, {}]) {
    const normalized = normalizeRepository(rawRepo({ updated_at: value, pushed_at: value }), owner);
    assert.equal(normalized.updatedAt, null);
    assert.equal(normalized.pushedAt, null);
  }
  assert.equal(normalizeRepository(rawRepo({ license: { spdx_id: 'NOASSERTION' } }), owner).license, null);
  assert.equal(normalizeRepository(rawRepo({ topics: 'microsoft-fabric', description: {}, language: 9 }), owner).language, null);
});

test('normalization excludes private, foreign and malformed records without mutating input', () => {
  const invalid = [null, undefined, {}, rawRepo({ private: true }), rawRepo({ owner: { login: 'foreign' } }),
    rawRepo({ owner: null }), ...[0, -1, 1.2, '1', Number.MAX_SAFE_INTEGER + 1].map(id => rawRepo({ id })),
    ...['', 'with space', 'slash/name', 'back\\slash', 'https://evil', 'repo?query', 'repo#fragment', 'é'].map(name => rawRepo({ name }))];
  for (const raw of invalid) assert.equal(normalizeRepository(raw, owner), null, JSON.stringify(raw));
  const input = rawRepo();
  const before = structuredClone(input);
  normalizeRepository(input, owner);
  assert.deepEqual(input, before);
});

for (const name of ['.', '..', 123, ['repository']]) {
  test(`security: reject non-identifier repository name ${JSON.stringify(name)}`, () => {
    assert.equal(normalizeRepository(rawRepo({ name }), owner), null,
      'Repository names must be strings and must not be URL dot-segments');
  });
}

for (const [type, kind] of [['User', 'users'], ['Organization', 'orgs']]) {
  test(`ingestion uses public ${kind} endpoint for a ${type}`, async () => {
    const mock = queuedFetch([account(type, owner.toLowerCase()), json([rawRepo()])]);
    const result = await fetchRepositories(owner, { fetchImpl: mock.fetchImpl });
    assert.deepEqual(mock.calls.map(c => c.url), [accountUrl, reposUrl(kind)]);
    assert.equal(result.schemaVersion, SCHEMA_VERSION);
    assert.equal(result.owner, owner);
    assert.ok(Number.isFinite(Date.parse(result.fetchedAt)));
    assert.deepEqual(result.repositories, [normalizeRepository(rawRepo(), owner)]);
    assert.equal(mock.remaining.length, 0);
  });
}

test('Link pagination retrieves more than 100 repositories, deduplicates IDs and sorts metadata', async () => {
  const next = `${reposUrl()}&page=2`;
  const pageOne = Array.from({ length: 100 }, (_, i) => rawRepo({ id: i + 1, name: `repo-${i + 1}` }));
  const pageTwo = [rawRepo({ id: 101, name: 'oldest', updated_at: null }),
    rawRepo({ id: 102, name: 'newest', updated_at: '2026-03-01T00:00:00Z' }),
    rawRepo({ id: 1, name: 'replacement', description: 'Latest duplicate wins' })];
  const mock = queuedFetch([account(), json(pageOne, {
    headers: { link: `<${next}>; rel="next", <${next}>; rel="last"` }
  }), json(pageTwo, { headers: { link: `<${reposUrl()}>; rel="prev"` } })]);
  const result = await fetchRepositories(owner, { fetchImpl: mock.fetchImpl });
  assert.deepEqual(mock.calls.map(c => c.url), [accountUrl, reposUrl(), next]);
  assert.equal(result.repositories.length, 102);
  assert.equal(new Set(result.repositories.map(r => r.id)).size, 102);
  assert.equal(result.repositories[0].name, 'newest');
  assert.equal(result.repositories.at(-1).name, 'oldest');
  assert.equal(result.repositories.find(r => r.id === 1).description, 'Latest duplicate wins');
  const tied = result.repositories.filter(r => r.updatedAt === '2026-01-02T03:04:05.000Z');
  assert.deepEqual(tied.map(r => r.name), tied.map(r => r.name).sort((a, b) => a.localeCompare(b)));
});

test('ingestion ignores invalid/private/foreign entries and warns with a count, not raw data', async () => {
  const warnings = [];
  const mock = queuedFetch([account(), json([rawRepo(), null, rawRepo({ id: 2, private: true }),
    rawRepo({ id: 3, owner: { login: 'secret-foreign-owner' } }), rawRepo({ id: 'bad' })])]);
  const result = await fetchRepositories(owner, { fetchImpl: mock.fetchImpl, warn: text => warnings.push(text) });
  assert.equal(result.repositories.length, 1);
  assert.deepEqual(warnings, ['4 invalid, private or foreign repository record(s) were ignored.']);
});

test('classification decoration uses topics only, creates unique memberships and leaves snapshot unchanged', () => {
  const data = snapshot({ repositories: [normalizeRepository(rawRepo({
    name: 'sqlserver-azure-devops', description: 'azure-synapse-analytics github-actions',
    topics: ['microsoft-fabric', 'github-actions', 'github-actions', 'azure-devops']
  }), owner), normalizeRepository(rawRepo({ id: 2, topics: [] }), owner)] });
  const before = structuredClone(data);
  const decorated = decorateRepositories(data);
  assert.deepEqual(decorated[0].categoryIds, ['fabric-actions', 'fabric-devops']);
  assert.deepEqual(decorated[1].categoryIds, ['other']);
  assert.equal(decorated[0].searchText, [data.repositories[0].name, data.repositories[0].description,
    data.repositories[0].language, ...data.repositories[0].topics].join(' ').toLowerCase());
  assert.notEqual(decorated[0], data.repositories[0]);
  assert.deepEqual(data, before);
});

test('requests configure GitHub headers, token, redirect rejection and a timeout signal', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return json([]); };
  await githubRequest(reposUrl(), { token: 'test-only-token', fetchImpl });
  await githubRequest(reposUrl(), { fetchImpl });
  const options = calls[0].options;
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.signal.aborted, false);
  assert.equal(options.headers.Authorization, 'Bearer test-only-token');
  assert.equal(options.headers.Accept, 'application/vnd.github+json');
  assert.equal(options.headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.equal(options.headers['User-Agent'], 'chantified-lens-static-showcase');
  assert.equal('Authorization' in calls[1].options.headers, false);
});

test('timeout and network failures retry three times with exponential backoff and redact credentials', async t => {
  const durations = [];
  t.mock.method(AbortSignal, 'timeout', ms => {
    durations.push(ms);
    return AbortSignal.abort(new DOMException('test-only-token', 'TimeoutError'));
  });
  const sleeps = [];
  let attempts = 0;
  const fetchImpl = async (_url, options) => { attempts++; options.signal.throwIfAborted(); };
  await assert.rejects(githubRequest(reposUrl(), {
    token: 'test-only-token', fetchImpl, sleep: async ms => sleeps.push(ms)
  }), error => {
    assert.equal(error.message, 'GitHub API could not be reached after three attempts.');
    assert.ok(!error.message.includes('test-only-token'));
    return true;
  });
  assert.equal(attempts, 3);
  assert.deepEqual(durations, [15000, 15000, 15000]);
  assert.deepEqual(sleeps, [500, 1000]);
});

test('a transient network failure and server error can recover without real sleeping', async () => {
  const mock = queuedFetch([new Error('network test-only-token'), new Response('server error', { status: 503 }), json({ ok: true })]);
  const sleeps = [];
  const response = await githubRequest(accountUrl, { fetchImpl: mock.fetchImpl, sleep: async ms => sleeps.push(ms) });
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(mock.calls.length, 3);
  assert.deepEqual(sleeps, [500, 1000]);
});

for (const status of [400, 401, 403, 404, 429, 500, 502, 503]) {
  test(`HTTP ${status} has bounded retries and never exposes credentials or response bodies`, async () => {
    const calls = [];
    const sleeps = [];
    await assert.rejects(githubRequest(accountUrl, {
      token: 'test-only-token',
      fetchImpl: async (...args) => {
        calls.push(args);
        return new Response('test-only-token private response content', { status });
      }, sleep: async ms => sleeps.push(ms)
    }), error => {
      assert.equal(error.message, `GitHub API returned HTTP ${status}${[403, 429].includes(status)
        ? ' (access or rate limit; try a build-time token)' : ''}.`);
      assert.ok(!error.message.includes('test-only-token'));
      assert.ok(!error.message.includes('private response content'));
      return true;
    });
    assert.equal(calls.length, status >= 500 ? 3 : 1);
    assert.deepEqual(sleeps, status >= 500 ? [500, 1000] : []);
  });
}

test('foreign API origins are rejected before fetch can receive an authorization header', async () => {
  let calls = 0;
  for (const url of ['https://evil.example/users/example', 'http://api.github.com/users/example',
    'https://api.github.com.evil.example/', 'https://api.github.com:8443/']) {
    await assert.rejects(githubRequest(url, { token: 'test-only-token', fetchImpl: async () => { calls++; } }),
      /Unexpected GitHub API origin/);
  }
  assert.equal(calls, 0);
});

test('invalid owner names are rejected before any request', async () => {
  let calls = 0;
  for (const invalid of ['', '-owner', 'with space', '../owner', 'owner/repo', 'a'.repeat(40), 'owner?token=secret']) {
    await assert.rejects(fetchRepositories(invalid, { fetchImpl: async () => { calls++; } }), /Invalid GitHub owner/);
  }
  assert.equal(calls, 0);
});

test('account response must match owner and be a public User or Organization account type', async () => {
  for (const value of [{ type: 'Bot', login: owner }, { type: 'User', login: 'foreign' }, {}, { type: 'Organization' }]) {
    const mock = queuedFetch([json(value)]);
    await assert.rejects(fetchRepositories(owner, { fetchImpl: mock.fetchImpl }), /Unexpected GitHub account response/);
    assert.equal(mock.calls.length, 1);
  }
});

for (const [label, next] of [
  ['foreign origin', 'https://evil.example/users/Example-Owner/repos?page=2'],
  ['insecure origin', 'http://api.github.com/users/Example-Owner/repos?page=2'],
  ['lookalike origin', 'https://api.github.com.evil.example/users/Example-Owner/repos'],
  ['foreign owner path', `${api}/users/foreign/repos?page=2`],
  ['private endpoint path', `${api}/user/repos?page=2`],
  ['wrong account endpoint', `${api}/orgs/${owner}/repos?page=2`],
  ['dot-segment escape', `${api}/users/${owner}/repos/../private?page=2`]
]) {
  test(`malicious pagination rejects ${label} without following it`, async () => {
    const mock = queuedFetch([account(), json([rawRepo()], { headers: { link: `<${next}>; rel="next"` } })]);
    await assert.rejects(fetchRepositories(owner, { token: 'test-only-token', fetchImpl: mock.fetchImpl }), /Unexpected pagination URL/);
    assert.equal(mock.calls.length, 2);
  });
}

test('pagination loops fail rather than returning a partial catalog', async () => {
  const mock = queuedFetch([account(), json([rawRepo()], { headers: { link: `<${reposUrl()}>; rel="next"` } })]);
  await assert.rejects(fetchRepositories(owner, { fetchImpl: mock.fetchImpl }), /Unexpected GitHub pagination loop/);
  assert.equal(mock.calls.length, 2);
});

test('malformed repository responses and invalid JSON fail instead of becoming empty results', async () => {
  for (const page of [json({ message: 'not an array' }), json(null), json('unexpected'), new Response('{invalid')]) {
    const mock = queuedFetch([account(), page]);
    await assert.rejects(fetchRepositories(owner, { fetchImpl: mock.fetchImpl }));
    assert.equal(mock.calls.length, 2);
  }
  const mock = queuedFetch([new Response('{invalid')]);
  await assert.rejects(fetchRepositories(owner, { fetchImpl: mock.fetchImpl }));
  assert.equal(mock.calls.length, 1);
});

test('snapshot validation accepts canonical data, including a successful empty catalog', () => {
  const value = snapshot();
  assert.equal(validateSnapshot(value, owner), value);
  const empty = snapshot({ repositories: [] });
  assert.equal(validateSnapshot(empty, owner), empty);
});

test('snapshot validation rejects incompatible account/schema/time/container metadata', () => {
  for (const value of [null, {}, snapshot({ schemaVersion: SCHEMA_VERSION + 1 }), snapshot({ owner: 'foreign' }),
    snapshot({ owner: owner.toLowerCase() }), snapshot({ fetchedAt: 'invalid' }),
    snapshot({ fetchedAt: new Date(Date.now() + 600000).toISOString() }),
    snapshot({ repositories: {} })]) {
    assert.throws(() => validateSnapshot(value, owner), /Invalid or incompatible repository snapshot/);
  }
});

test('snapshot validation rejects duplicate IDs, malformed records, unsafe URLs and noncanonical topics', () => {
  const repo = snapshot().repositories[0];
  for (const repositories of [[repo, repo], [null], [{ ...repo, id: 0 }],
    [{ ...repo, url: 'javascript:alert(1)' }], [{ ...repo, url: 'https://evil.example/' }],
    [{ ...repo, topics: 'github-actions' }], [{ ...repo, topics: ['GITHUB-ACTIONS'] }],
    [{ ...repo, topics: ['microsoft-fabric', 'github-actions'] }],
    [{ ...repo, topics: ['github-actions', 'github-actions'] }]]) {
    assert.throws(() => validateSnapshot(snapshot({ repositories }), owner), /Invalid cached repository record/);
  }
});

test('snapshot reading uses native files and rejects malformed JSON', async t => {
  const { file } = await fixture(t);
  const value = snapshot();
  await seed(file, value);
  assert.deepEqual(await readSnapshot(file, owner), value);
  await writeFile(file, '{malformed');
  await assert.rejects(readSnapshot(file, owner), SyntaxError);
});

test('failed refresh falls back to validated cache without rewriting it or leaking credentials', async t => {
  const { file } = await fixture(t);
  const bytes = await seed(file);
  const warnings = [];
  const result = await refreshSnapshot({ file, owner, token: 'test-only-token',
    fetchImpl: async () => { throw new Error('test-only-token'); }, sleep: async () => {},
    warn: message => warnings.push(message) });
  assert.equal(result.cached, true);
  assert.deepEqual(result.snapshot, snapshot());
  assert.equal(await readFile(file, 'utf8'), bytes);
  assert.deepEqual(warnings, [`GitHub refresh failed. Using cached public data from ${snapshot().fetchedAt}.`]);
  assert.ok(!warnings.join(' ').includes('test-only-token'));
});

for (const [label, value] of [
  ['account mismatch', snapshot({ owner: 'foreign' })],
  ['schema mismatch', snapshot({ schemaVersion: SCHEMA_VERSION + 1 })],
  ['unsafe cached URL', snapshot({ repositories: [{ ...snapshot().repositories[0], url: 'https://evil.example' }] })]
]) {
  test(`failed refresh rejects ${label} cache and preserves its existing bytes`, async t => {
    const { file } = await fixture(t);
    const bytes = await seed(file, value);
    await assert.rejects(refreshSnapshot({ file, owner, ...offline() }), /No valid cached snapshot is available/);
    assert.equal(await readFile(file, 'utf8'), bytes);
  });
}

test('failed refresh without a cache refuses to publish an empty catalog', async t => {
  const { dir, file } = await fixture(t);
  await assert.rejects(refreshSnapshot({ file, owner, ...offline() }),
    /GitHub API could not be reached after three attempts.*No valid cached snapshot is available/);
  assert.deepEqual(await readdir(dir), []);
});

test('successful empty API response replaces old cache and is not treated as failure', async t => {
  const { file } = await fixture(t);
  await seed(file);
  const mock = queuedFetch([account(), json([])]);
  const result = await refreshSnapshot({ file, owner, fetchImpl: mock.fetchImpl });
  assert.equal(result.cached, false);
  assert.deepEqual(result.snapshot.repositories, []);
  assert.deepEqual(await readSnapshot(file, owner), result.snapshot);
  assert.deepEqual(await readdir(join(file, '..')), ['repositories.json']);
});

test('successful refresh creates missing directories, publishes complete JSON and removes temporary path', async t => {
  const { file } = await fixture(t);
  const mock = queuedFetch([account(), json([rawRepo(), rawRepo({ id: 2, name: 'second' })])]);
  const result = await refreshSnapshot({ file, owner, fetchImpl: mock.fetchImpl });
  assert.equal(result.cached, false);
  assert.equal(result.snapshot.repositories.length, 2);
  assert.deepEqual(await readSnapshot(file, owner), result.snapshot);
  assert.equal(await readFile(file, 'utf8'), `${JSON.stringify(result.snapshot, null, 2)}\n`);
  assert.deepEqual(await readdir(join(file, '..')), ['repositories.json']);
});

test('an in-progress paginated refresh leaves the old catalog intact until complete publication', async t => {
  const { file } = await fixture(t);
  const bytes = await seed(file);
  const next = `${reposUrl()}&page=2`;
  let release;
  let announce;
  const reachedSecondPage = new Promise(resolve => { announce = resolve; });
  const mock = queuedFetch([account(), json([rawRepo({ id: 2, name: 'first-page' })], {
    headers: { link: `<${next}>; rel="next"` }
  }), async () => {
    announce();
    return new Promise(resolve => { release = resolve; });
  }]);
  const pending = refreshSnapshot({ file, owner, fetchImpl: mock.fetchImpl });
  // Release even if the filesystem assertion fails, so no task is left hanging.
  await reachedSecondPage;
  try { assert.equal(await readFile(file, 'utf8'), bytes); }
  finally { release(json([rawRepo({ id: 3, name: 'second-page' })])); }
  const result = await pending;
  assert.deepEqual(result.snapshot.repositories.map(r => r.id), [2, 3]);
  assert.deepEqual(await readSnapshot(file, owner), result.snapshot);
});

test('a malformed later page falls back to the old cache, never overwriting it with partial data', async t => {
  const { file } = await fixture(t);
  const bytes = await seed(file);
  const next = `${reposUrl()}&page=2`;
  const mock = queuedFetch([account(), json([rawRepo({ id: 2 })], {
    headers: { link: `<${next}>; rel="next"` }
  }), json({ error: 'bad second page' })]);
  const result = await refreshSnapshot({ file, owner, fetchImpl: mock.fetchImpl });
  assert.equal(result.cached, true);
  assert.deepEqual(result.snapshot, snapshot());
  assert.equal(await readFile(file, 'utf8'), bytes);
  assert.deepEqual(await readdir(join(file, '..')), ['repositories.json']);
});

test('a temporary-file write failure does not partially overwrite the published cache', async t => {
  const { file } = await fixture(t);
  const bytes = await seed(file);
  // A directory at the staging filename produces a portable native-fs write failure.
  await mkdir(`${file}.tmp`);
  const mock = queuedFetch([account(), json([rawRepo({ id: 2 })])]);
  await assert.rejects(refreshSnapshot({ file, owner, fetchImpl: mock.fetchImpl }));
  assert.equal(await readFile(file, 'utf8'), bytes);
  assert.deepEqual(await readSnapshot(file, owner), snapshot());
});