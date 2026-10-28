import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract, target } from './github-links.mjs';

test('maps GitHub links to API paths or local files', () => {
  assert.deepEqual(target('https://github.com/obra/superpowers'), { api: '/repos/obra/superpowers' });
  assert.deepEqual(target('https://github.com/a/b.git'), { api: '/repos/a/b' });
  assert.deepEqual(target('https://github.com/a/b/blob/main/docs/x.md'), { api: '/repos/a/b/contents/docs/x.md?ref=main' });
  assert.deepEqual(target('https://github.com/a/b/issues/12'), { api: '/repos/a/b/issues/12' });
  assert.deepEqual(target('https://github.com/a/b/pull/5'), { api: '/repos/a/b/issues/5' });
  assert.deepEqual(target('https://github.com/a/b/issues'), { api: '/repos/a/b/issues?per_page=1' });
  assert.deepEqual(target('https://github.com/a/b/releases/tag/v6.0.0'), { api: '/repos/a/b/releases/tags/v6.0.0' });
  assert.deepEqual(target('https://github.com/ESchuderer/BenchKeeper/blob/main/plugins/benchkeeper/rules/global.md'), { local: 'plugins/benchkeeper/rules/global.md' });
  assert.deepEqual(target('https://github.com/ESchuderer/BenchKeeper/blob/v1/x.md'), { api: '/repos/ESchuderer/BenchKeeper/contents/x.md?ref=v1' });
  assert.deepEqual(target('https://github.com/marketplace/actions/foo'), { unsupported: true });
  assert.deepEqual(target('https://github.com/a/b/wiki/Page'), { unsupported: true });
  assert.deepEqual(target('https://github.com/a/b/blob/main/100%-done.md'), { unsupported: true });
  assert.equal(target('https://github.com/a/b/discussions/7').graphql.variables.n, 7);
});

test('extracts URLs without markdown syntax around them', () => {
  assert.deepEqual(extract('**https://github.com/a/b** | https://github.com/a/c/issues/1#x, (https://github.com/a/d).'),
    ['https://github.com/a/b', 'https://github.com/a/c/issues/1', 'https://github.com/a/d']);
});

test('compare links: checked through the API, except the tag of the release being prepared (its base is still checked)', () => {
  const { version } = JSON.parse(readFileSync(new URL('../../app/package.json', import.meta.url), 'utf8'));
  assert.deepEqual(target('https://github.com/a/b/compare/v1...v2'), { api: '/repos/a/b/compare/v1...v2' });
  assert.deepEqual(target('https://github.com/ESchuderer/BenchKeeper/compare/setup-v6.0.0...setup-v6.0.1'), { api: '/repos/ESchuderer/BenchKeeper/compare/setup-v6.0.0...setup-v6.0.1' });
  assert.deepEqual(target(`https://github.com/ESchuderer/BenchKeeper/compare/setup-v1.0.0...setup-v${version}`), { api: '/repos/ESchuderer/BenchKeeper/commits/setup-v1.0.0' });
  assert.deepEqual(target('https://github.com/a/b/compare/ci/release-please-weekly...main'), { api: '/repos/a/b/compare/ci%2Frelease-please-weekly...main' });
  assert.deepEqual(target('https://github.com/a/b/compare/main'), { unsupported: true });
});
