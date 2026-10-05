import test from 'node:test';
import assert from 'node:assert/strict';
import { categories, classify, matchesCategory } from '../config/categories.mjs';

const rules = [
  ['fabric-actions', ['microsoft-fabric', 'github-actions']],
  ['fabric-devops', ['microsoft-fabric', 'azure-devops']],
  ['fabric-misc', ['microsoft-fabric']],
  ['synapse-actions', ['azure-synapse-analytics', 'github-actions']],
  ['synapse-devops', ['azure-synapse-analytics', 'azure-devops']],
  ['sql-server-actions', ['sql-server', 'github-actions']],
  ['sql-server-devops', ['sql-server', 'azure-devops']],
  ['azure-sql-actions', ['azure-sql-database', 'github-actions']]
];

test('the catalog defines all eight independent rules and one Other fallback', () => {
  assert.deepEqual(categories.filter(c => !c.fallback).map(c => c.id), rules.map(([id]) => id));
  assert.deepEqual(categories.filter(c => c.fallback).map(c => c.id), ['other']);
  assert.equal(new Set(categories.map(c => c.id)).size, categories.length);
  assert.equal(new Set(categories.map(c => c.path)).size, categories.length);
});

for (const [id, topics] of rules) {
  test(`${id}: exact topics qualify, case and whitespace normalize`, () => {
    assert.deepEqual(classify(topics), [id]);
    assert.deepEqual(classify(topics.map(t => `  ${t.toUpperCase()}  `)), [id]);
    assert.deepEqual(classify([...topics, ...topics, null, 42, {}]), [id]);
    assert.equal(matchesCategory(topics, categories.find(c => c.id === id)), true);
  });
}

test('SQL Server aliases independently qualify on both supported platforms', () => {
  for (const alias of ['sqlserver', 'sql-server']) {
    assert.deepEqual(classify([alias, 'github-actions']), ['sql-server-actions']);
    assert.deepEqual(classify([alias, 'azure-devops']), ['sql-server-devops']);
  }
  assert.deepEqual(classify(['sqlserver', 'sql-server', 'github-actions', 'azure-devops']),
    ['sql-server-actions', 'sql-server-devops']);
});

test('Fabric miscellaneous excludes either delivery platform, including normalized topics', () => {
  assert.deepEqual(classify(['microsoft-fabric', 'unrelated']), ['fabric-misc']);
  assert.deepEqual(classify(['microsoft-fabric', 'github-actions']), ['fabric-actions']);
  assert.deepEqual(classify(['microsoft-fabric', 'azure-devops']), ['fabric-devops']);
  assert.deepEqual(classify([' MICROSOFT-FABRIC ', ' GITHUB-ACTIONS ', ' AZURE-DEVOPS ']),
    ['fabric-actions', 'fabric-devops']);
});

test('cross-technology and cross-platform matches are independent, ordered and unique', () => {
  const topics = ['microsoft-fabric', 'azure-synapse-analytics', 'sqlserver', 'sql-server',
    'azure-sql-database', 'github-actions', 'azure-devops'];
  const expected = rules.map(([id]) => id).filter(id => id !== 'fabric-misc');
  const result = classify([...topics, ...topics, ...topics.map(t => t.toUpperCase())]);
  assert.deepEqual(result, expected);
  assert.equal(new Set(result).size, result.length);
  assert.ok(!result.includes('other'));
});

test('only exact topics match: prefixes, suffixes and descriptive lookalikes do not', () => {
  for (const topics of [
    ['fabric', 'github-actions'], ['microsoft-fabric-example', 'github-actions'],
    ['microsoft_fabric', 'github-actions'], ['azure-synapse', 'github-actions'],
    ['azure-synapse-analytics', 'github-action'], ['azure-sql', 'github-actions'],
    ['sql-server-2022', 'github-actions'], ['sql server', 'github-actions'],
    ['sqlserver', 'azure-devops-pipelines'], ['azure-sql-database', 'azure-devops'],
    ['github-actions'], ['azure-devops'], ['sqlserver'], ['sql-server'],
    ['azure-synapse-analytics'], ['azure-sql-database']
  ]) assert.deepEqual(classify(topics), ['other'], JSON.stringify(topics));
  // A near-match platform does not exclude the genuine Fabric miscellaneous rule.
  assert.deepEqual(classify(['microsoft-fabric', 'github-actions-example']), ['fabric-misc']);
});

test('Other is selected only when no explicit rule matches, even for invalid topic input', () => {
  for (const topics of [undefined, null, {}, 'microsoft-fabric', 0, [], [null, {}, 1], ['', '  ', 'unknown']]) {
    assert.deepEqual(classify(topics), ['other']);
  }
  assert.equal(matchesCategory(['anything'], categories.find(c => c.fallback)), false);
});

test('matching supports all/any/none combinations without mutating topics or definitions', () => {
  const topics = Object.freeze(['required', 'alias']);
  const rule = Object.freeze({ id: 'custom', all: ['required'], any: ['alias', 'alternative'], none: ['excluded'] });
  assert.equal(matchesCategory(topics, rule), true);
  assert.equal(matchesCategory(['alias'], rule), false);
  assert.equal(matchesCategory(['required'], rule), false);
  assert.equal(matchesCategory([...topics, 'excluded'], rule), false);
  assert.equal(matchesCategory([], { all: [], any: [], none: [] }), true);
  assert.deepEqual(classify([' REQUIRED ', ' ALIAS '], [rule, { id: 'fallback', fallback: true }]), ['custom']);
  assert.deepEqual(classify([], [rule, { id: 'fallback', fallback: true }]), ['fallback']);
  assert.deepEqual(classify([], [rule]), []);
});