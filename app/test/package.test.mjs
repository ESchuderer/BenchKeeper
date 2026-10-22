import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { appVersion } from '../src/content.mjs';
import { newer, updateNotice } from '../src/update.mjs';

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

test('the app version is the plugin version; runtime dependencies are exact', () => {
  assert.equal(appVersion, json('../../plugins/benchkeeper/.claude-plugin/plugin.json').version);
  assert.equal(appVersion, json('../../plugins/benchkeeper/.codex-plugin/plugin.json').version);
  const pkg = json('../package.json');
  for (const [name, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) assert.match(v, /^\d+\.\d+\.\d+$/, name);
});

test('update check: shown when newer, silent when off, offline or older', async () => {
  assert.equal(newer('6.1.0', '6.0.9'), true);
  assert.equal(newer('6.0.0', '6.0.0'), false);
  assert.equal(newer('5.9.9', '6.0.0'), false);
  const reply = (version, ok = true) => async () => ({ ok, json: async () => ({ version }) });
  assert.match(await updateNotice('6.0.0', {}, reply('6.1.0')), /benchkeeper 6\.1\.0 is available .*npx benchkeeper@6\.1\.0/);
  assert.equal(await updateNotice('6.0.0', {}, reply('6.0.0')), null);
  assert.equal(await updateNotice('6.0.0', {}, reply('7.0.0', false)), null);
  assert.equal(await updateNotice('6.0.0', {}, reply('7.0.0-rc.1')), null);
  assert.equal(await updateNotice('6.0.0', {}, async () => { throw new Error('offline'); }), null);
  let asked = false;
  assert.equal(await updateNotice('6.0.0', { BENCHKEEPER_NO_UPDATE_CHECK: '1' }, async () => { asked = true; }), null);
  assert.equal(asked, false);
});
