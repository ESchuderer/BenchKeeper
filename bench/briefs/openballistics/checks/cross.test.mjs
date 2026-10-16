// Tests of the cross-step checks. Usage: SCORER_PKG=bench/scorer/package.json node --test bench/briefs/openballistics/checks/cross.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.SCORER_PKG ||= new URL('../../../scorer/package.json', import.meta.url).pathname;
const { added, bump, changelog, ciCommands, isInstall } = await import('./cross.mjs');
const repo = (files) => {
  const d = mkdtempSync(join(tmpdir(), 'cross-'));
  for (const [p, t] of Object.entries(files)) mkdirSync(dirname(join(d, p)), { recursive: true }), writeFileSync(join(d, p), t);
  return d;
};

test('CI commands: plain npm and node steps of pull_request workflows, others not checked', () => {
  const wf = `on: [pull_request, push]
jobs:
  test:
    defaults: { run: { working-directory: site } }
    steps:
      - uses: actions/checkout@0000000000000000000000000000000000000000
      - run: npm ci
      - run: |
          npm test
          npm run build
      - run: echo \${{ github.sha }}
  lint:
    steps:
      - run: npm ci && npm run lint
        working-directory: ./site/
`;
  const { plain, skipped } = ciCommands(repo({ '.github/workflows/ci.yml': wf, '.github/workflows/pages.yml': 'on: { push: { branches: [main] } }\njobs: { b: { steps: [{ run: npm run build }] } }\n' }));
  assert.deepEqual(plain.map((c) => [c.cwd, c.parts]), [['site', ['npm ci']], ['site', ['npm test', 'npm run build']], ['site', ['npm ci', 'npm run lint']]]);
  assert.equal(skipped.length, 1);
});

test('changelog: entry lines added since the previous step', () => {
  const prev = repo({ 'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n\n## [0.1.0]\n- first\n' });
  assert.equal(changelog(prev, prev).ok, false);
  const cur = repo({ 'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n- compare two cartridges\n\n## [0.1.0]\n- first\n' });
  assert.equal(changelog(cur, prev).ok, true);
  assert.deepEqual(added('a\nb\na', 'a\nb'), [{ l: 'a', i: 2 }]);
});

test('version: a bump, or the bump the strategy defers to the release', () => {
  const pkg = (v) => JSON.stringify({ version: v });
  const prev = repo({ 'site/package.json': pkg('0.1.0'), 'CHANGELOG.md': '## [Unreleased]\n\n## [0.1.0]\n- first\n' });
  assert.deepEqual(bump(repo({ 'site/package.json': pkg('0.2.0') }), prev, []), { ok: true, detail: 'site/package.json: 0.1.0 to 0.2.0' });
  assert.equal(bump(repo({ 'site/package.json': pkg('0.1.0') }), prev, []).ok, false);
  assert.equal(bump(repo({ 'site/package.json': pkg('0.10.0') }), repo({ 'site/package.json': pkg('0.9.0') }), []).ok, true);
  const rp = { 'site/package.json': pkg('0.1.0'), 'release-please-config.json': '{}' };
  assert.equal(bump(repo(rp), prev, ['feat: compare view']).ok, true);
  assert.equal(bump(repo(rp), prev, ['docs: readme']).ok, false);
  const unreleased = repo({ 'site/package.json': pkg('0.1.0'), 'CHANGELOG.md': '## [Unreleased]\n- compare\n\n## [0.1.0]\n- first\n' });
  assert.equal(bump(unreleased, prev, []).detail, 'CHANGELOG.md: entry under Unreleased');
  const released = repo({ 'site/package.json': pkg('0.1.0'), 'CHANGELOG.md': '## [Unreleased]\n\n## [0.1.0]\n- first\n- compare\n' });
  assert.equal(bump(released, prev, []).ok, false);
});

test('install commands after npm options', () => {
  assert.deepEqual(['npm ci', 'npm ci --prefix site', 'npm --prefix site ci', 'npm --prefix=site install', 'npm --silent i', 'npm test', 'npm run ci', 'node ci.js'].map(isInstall),
    [true, true, true, true, true, false, false, false]);
});
