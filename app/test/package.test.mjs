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
  const old = '2020-01-01T00:00:00Z', fresh = new Date(Date.now() - 864e5).toISOString();
  const reply = (version, ok = true, at = old) => async () => ({ ok, json: async () => ({ time: { '6.0.0': old, [version]: at }, versions: { '6.0.0': {}, [version]: {} } }) });
  assert.match(await updateNotice('6.0.0', {}, reply('6.1.0')), /benchkeeper 6\.1\.0 is available .*npx benchkeeper@6\.1\.0/);
  assert.equal(await updateNotice('6.0.0', {}, reply('6.0.0')), null);
  assert.equal(await updateNotice('6.0.0', {}, reply('7.0.0', false)), null);
  assert.equal(await updateNotice('6.0.0', {}, reply('7.0.0-rc.1')), null);
  // The 7-day cooldown of the host tools applies to the notice too, and a time that is no string never counts.
  assert.equal(await updateNotice('6.0.0', {}, reply('6.1.0', true, fresh)), null);
  assert.equal(await updateNotice('6.0.0', {}, reply('6.1.0', true, 5)), null);
  assert.equal(await updateNotice('6.0.0', {}, async () => { throw new Error('offline'); }), null);
  let asked = false;
  assert.equal(await updateNotice('6.0.0', { BENCHKEEPER_NO_UPDATE_CHECK: '1' }, async () => { asked = true; }), null);
  assert.equal(asked, false);
});
