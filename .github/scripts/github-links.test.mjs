import { test } from 'node:test';
import assert from 'node:assert/strict';
import { target } from './github-links.mjs';

test('maps GitHub links to API paths or local files', () => {
  assert.deepEqual(target('https://github.com/obra/superpowers'), { api: '/repos/obra/superpowers' });
  assert.deepEqual(target('https://github.com/a/b.git'), { api: '/repos/a/b' });
  assert.deepEqual(target('https://github.com/a/b/blob/main/docs/x.md'), { api: '/repos/a/b/contents/docs/x.md?ref=main' });
  assert.deepEqual(target('https://github.com/a/b/issues/12'), { api: '/repos/a/b/issues/12' });
  assert.deepEqual(target('https://github.com/a/b/pull/5'), { api: '/repos/a/b/issues/5' });
  assert.deepEqual(target('https://github.com/a/b/releases/tag/v6.0.0'), { api: '/repos/a/b/releases/tags/v6.0.0' });
  assert.deepEqual(target('https://gist.github.com/u/abc123'), { api: '/gists/abc123' });
  assert.deepEqual(target('https://github.com/ESchuderer/BenchKeeper/blob/main/rules/global.md'), { local: 'rules/global.md' });
  assert.equal(target('https://github.com/a/b/discussions/7').graphql.variables.n, 7);
});
