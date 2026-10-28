import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { appVersion, contentRefusal, contentVersion } from '../src/content.mjs';
import { doctor } from '../src/doctor.mjs';
import { apply, context } from '../src/runner.mjs';
import { installedRefusal } from '../src/steps/global.mjs';
import { STATE, parseState, readState, upToDate } from '../src/steps/project.mjs';
import { status } from '../src/projects.mjs';

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const contentAt = (dir, minApp) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'content.json'), JSON.stringify({ schemaVersion: 1, contentVersion: '9.0.0', minApp })); return dir; };
const stateAt = (state) => { const dir = tmp('bk-state-'); mkdirSync(join(dir, '.benchkeeper')); writeFileSync(join(dir, STATE), JSON.stringify(state)); return dir; };

test('content that needs a newer app is refused with the command to run; older, equal, absent or unreadable requirements are not', () => {
  assert.match(contentRefusal(contentAt(tmp('bk-content-'), '7.0.0'), '6.25.0'), /needs benchkeeper 7\.0\.0 or newer, this is 6\.25\.0.*npx benchkeeper@7/);
  assert.equal(contentRefusal(contentAt(tmp('bk-content-'), '6.25.0'), '6.25.0'), null);
  assert.equal(contentRefusal(contentAt(tmp('bk-content-'), '6.9.0'), '6.25.0'), null);
  assert.equal(contentRefusal(tmp('bk-content-'), '6.25.0'), null);
  assert.equal(contentRefusal(contentAt(tmp('bk-content-'), 'soon'), '6.25.0'), null);
});

test('apply stops before any change when the content needs a newer app; a plan run without the refusal goes on', () => {
  const home = tmp('bk-apply-');
  const target = join(home, 'out.txt');
  const plan = [{ id: 'w', step: 'x', title: 'write', kind: 'write', path: target, after: 'hi\n' }];
  assert.throws(() => apply(plan, context({ home, refuse: () => 'needs a newer benchkeeper' }), { scope: 'global' }), /needs a newer benchkeeper/);
  assert.equal(apply(plan, context({ home, refuse: () => null }), { scope: 'global' }).status, 'done');
});

test('an installed plugin whose content needs a newer app is an error in doctor and a refusal for apply', () => {
  const home = tmp('bk-inst-');
  const dir = contentAt(join(home, 'cache/benchkeeper'), '99.0.0');
  mkdirSync(join(home, '.claude/plugins'), { recursive: true });
  writeFileSync(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'benchkeeper@benchkeeper': [{ scope: 'user', version: '99.0.0', installPath: dir }] } }));
  writeFileSync(join(home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ benchkeeper: {} }));
  const ctx = context({ home, appVersion: '6.25.0', run: () => ({ code: 0, stdout: '[]', stderr: '' }) });
  assert.match(installedRefusal(ctx, ['claude']), /needs benchkeeper 99\.0\.0 or newer/);
  assert.deepEqual(doctor(ctx, { agents: ['claude'] }).filter((i) => i.check === 'content').map((i) => i.level), ['error']);
  assert.equal(installedRefusal({ ...ctx, appVersion: '99.0.0' }, ['claude']), null);
  // An agent without plugins is not read as Codex.
  contentAt(join(home, '.codex/plugins/cache/benchkeeper/benchkeeper/99.0.0'), '99.0.0');
  writeFileSync(join(home, '.codex/config.toml'), '[plugins."benchkeeper@benchkeeper"]\nenabled = true\n');
  assert.match(installedRefusal(ctx, ['codex']), /needs benchkeeper 99\.0\.0 or newer/);
  assert.equal(installedRefusal(ctx, ['gemini']), null);
});

test('an installed plugin is refused when the agent state files are unreadable and the CLI lists it', () => {
  const home = tmp('bk-cli-');
  const dir = contentAt(join(home, 'cache/benchkeeper'), '99.0.0');
  contentAt(join(home, '.codex/plugins/cache/benchkeeper/benchkeeper/99.0.0'), '99.0.0');
  const out = { 'claude plugin list --json': JSON.stringify([{ id: 'benchkeeper@benchkeeper', version: '99.0.0', enabled: true, scope: 'user', installPath: dir }]),
    'codex plugin list --json': JSON.stringify({ installed: [{ pluginId: 'benchkeeper@benchkeeper', version: '99.0.0', enabled: true }] }) };
  const ctx = context({ home, appVersion: '6.25.0', run: (argv) => ({ code: 0, stdout: out[argv.join(' ')] ?? '[]', stderr: '' }) });
  for (const a of ['claude', 'codex']) assert.match(installedRefusal(ctx, [a]), /needs benchkeeper 99\.0\.0 or newer/, a);
});

test('state version 1 is read as version 2 with its setup version as both values; a schemaVersion above 2 is refused', () => {
  const v1 = stateAt({ schemaVersion: 1, setupVersion: '6.20.0', agents: ['claude'] });
  const s = readState(v1);
  assert.deepEqual([s.schemaVersion, s.appVersion, s.contentVersion, 'setupVersion' in s, s.agents], [2, '6.20.0', '6.20.0', false, ['claude']]);
  assert.deepEqual(parseState('{"schemaVersion":2,"appVersion":"7.1.0","contentVersion":"7.0.0"}'), { schemaVersion: 2, appVersion: '7.1.0', contentVersion: '7.0.0' });
  assert.throws(() => readState(stateAt({ schemaVersion: 3, appVersion: '8.0.0', contentVersion: '8.0.0' })), /schemaVersion 3, this benchkeeper reads up to 2.*npx benchkeeper@\d+/);
});

test('a project is behind when either version differs', () => {
  const at = (app, content) => stateAt({ schemaVersion: 2, appVersion: app, contentVersion: content, agents: [] });
  const ctx = context({ home: tmp('bk-behind-'), appVersion });
  const current = (d) => [upToDate(readState(d)), status(ctx, d).current];
  assert.deepEqual(current(at(appVersion, contentVersion)), [true, true]);
  assert.deepEqual(current(at('5.0.0', contentVersion)), [false, false]);
  assert.deepEqual(current(at(appVersion, '5.0.0')), [false, false]);
  assert.deepEqual(current(at('5.0.0', '5.0.0')), [false, false]);
  assert.deepEqual(current(stateAt({ schemaVersion: 1, setupVersion: appVersion })), [appVersion === contentVersion, appVersion === contentVersion]);
  assert.equal(status(ctx, at('5.0.0', appVersion)).setupVersion, appVersion);
  const doc = doctor(ctx, { agents: ['claude'], dir: at(appVersion, '5.0.0') }).filter((i) => i.check === 'project');
  assert.match(doc[0].message, /app .*, content 5\.0\.0/);
});
