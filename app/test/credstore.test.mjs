import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StoreError, credentialStore } from '../src/credstore.mjs';

const TOKEN = 'dummy-token-0123456789-abcdefghij';
const recorder = (reply = {}) => {
  const calls = [];
  const run = (argv, o = {}) => { calls.push({ argv, input: o.input, env: o.env }); return { code: 0, stdout: '', stderr: '', ...(reply[argv[1]] ?? {}) }; };
  return { calls, run };
};

test('libsecret: the token goes to secret-tool on stdin, never on the command line', () => {
  const { calls, run } = recorder({ lookup: { stdout: `${TOKEN}\n` } });
  const s = credentialStore(run, { platform: 'linux', env: { PATH: '/bin', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/x', GH_TOKEN: 'other-secret', ANTHROPIC_API_KEY: 'k' } });
  s.set('work', TOKEN);
  assert.equal(calls[0].input, TOKEN);
  assert.ok(!calls[0].argv.join(' ').includes(TOKEN));
  assert.deepEqual(calls[0].argv.slice(0, 2), ['secret-tool', 'store']);
  // The bus address reaches the tool; no other credential does.
  assert.equal(calls[0].env.DBUS_SESSION_BUS_ADDRESS, 'unix:path=/x');
  assert.deepEqual(Object.keys(calls[0].env).filter((k) => /token|key/i.test(k)), []);
  assert.equal(s.get('work'), TOKEN);
  assert.equal(s.has('work'), true);
  s.delete('work');
  assert.deepEqual(calls.at(-1).argv.slice(0, 2), ['secret-tool', 'clear']);
});

test('libsecret: a missing program or an unlocked-keyring failure refuses with the reason, a missing token is null', () => {
  const missing = credentialStore(() => ({ code: 127, stdout: '', stderr: 'spawn secret-tool ENOENT' }), { platform: 'linux', env: {} });
  assert.throws(() => missing.set('work', TOKEN), /secret-tool is not installed.*libsecret-tools/);
  const noService = credentialStore(() => ({ code: 1, stdout: '', stderr: 'Cannot autolaunch D-Bus' }), { platform: 'linux', env: {} });
  assert.throws(() => noService.set('work', TOKEN), (e) => e instanceof StoreError && /keyring/.test(e.message) && !e.message.includes('D-Bus'));
  assert.equal(noService.get('work'), null);
  assert.equal(noService.has('work'), false);
});

test('names and token shapes are checked before anything runs', () => {
  const { calls, run } = recorder();
  const s = credentialStore(run, { platform: 'linux', env: {} });
  assert.throws(() => s.set('a b', TOKEN), /invalid account name/);
  assert.throws(() => s.set('work', 'short'), /unexpected shape/);
  assert.throws(() => s.set('work', `${TOKEN}"; rm -rf /`), /unexpected shape/);
  assert.equal(calls.length, 0);
});

test('keychain: security reads its commands from stdin, so the token is not in the argument list', () => {
  const { calls, run } = recorder({ 'find-generic-password': { stdout: `${TOKEN}\n` } });
  const s = credentialStore(run, { platform: 'darwin', env: {} });
  s.set('work', TOKEN);
  assert.deepEqual(calls[0].argv, ['security', '-i']);
  assert.match(calls[0].input, /^add-generic-password -U -s benchkeeper -a "work" -w "dummy-token/);
  assert.equal(s.get('work'), TOKEN);
  s.delete('work');
  assert.ok(calls.every((c) => !c.argv.join(' ').includes(TOKEN)));
});

test('other systems refuse every call and keep no file', () => {
  const s = credentialStore(() => { throw new Error('nothing runs'); }, { platform: 'win32', env: {} });
  for (const f of [() => s.set('work', TOKEN), () => s.get('work'), () => s.has('work'), () => s.delete('work')]) assert.throws(f, /no credential store is supported on win32/);
});
