import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { appVersion, contentRefusal } from '../src/content.mjs';
import { newer, updateNotice } from '../src/update.mjs';

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

test('runtime dependencies are exact', () => {
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

test('content.json: content version is the plugin version, minApp is not above the app, skill and automation text names the major', () => {
  const c = json('../../plugins/benchkeeper/content.json');
  assert.equal(c.schemaVersion, 1);
  for (const agent of ['claude', 'codex']) assert.equal(c.contentVersion, json(`../../plugins/benchkeeper/.${agent}-plugin/plugin.json`).version);
  const root = new URL('../../plugins/benchkeeper/', import.meta.url);
  // App and content release separately: an app patch release leaves the content version behind and still fits.
  const [major, minor, patch] = appVersion.split('.').map(Number);
  assert.match(c.minApp, /^\d+\.\d+\.\d+$/);
  for (const v of [appVersion, `${major}.${minor}.${patch + 1}`]) assert.equal(contentRefusal(fileURLToPath(root), v), null, v);
  // The major the text names: the coming release's while release-please-config.json sets release-as for the app (a major
  // release changes the text before release-please changes the version files), else the app's own.
  const releaseAs = json('../../release-please-config.json').packages.app['release-as'];
  const expected = (releaseAs || appVersion).split('.')[0];
  for (const dir of ['skills', 'library', 'automations']) {
    for (const f of readdirSync(new URL(`${dir}/`, root), { recursive: true }).filter((x) => x.endsWith('.md'))) {
      for (const [, pin] of readFileSync(new URL(`${dir}/${f}`, root), 'utf8').matchAll(/npx (?:-y )?benchkeeper@(\S+?)[\s`)]/g)) assert.equal(pin, expected, `${dir}/${f}`);
    }
  }
});
