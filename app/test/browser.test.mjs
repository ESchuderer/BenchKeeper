import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findBrowser, openPrivate, signInUrl } from '../src/browser.mjs';

test('sign-in URLs: only https links of the providers\' own hosts, without credentials or odd characters', () => {
  assert.equal(signInUrl('https://claude.ai/oauth/authorize?code=true&state=x'), 'https://claude.ai/oauth/authorize?code=true&state=x');
  assert.ok(signInUrl('https://auth.openai.com/codex/device'));
  for (const bad of ['http://claude.ai/x', 'https://evil.example/claude.ai', 'https://claude.ai.evil.example/x', 'https://user:pw@claude.ai/x', 'https://claude.ai/x y', 'file:///etc/passwd', 'javascript:alert(1)', 'https://claude.ai/x"y', 'not a url']) assert.equal(signInUrl(bad), null, bad);
});

test('findBrowser: the private flag per browser, none without a display or a browser', () => {
  const has = (...names) => (n) => names.includes(n);
  const argv = (opts, url = 'https://claude.ai/x') => findBrowser(opts)?.argv(url);
  assert.deepEqual(argv({ platform: 'linux', env: { DISPLAY: ':0' }, has: has('firefox') }), ['firefox', '--private-window', 'https://claude.ai/x']);
  assert.deepEqual(argv({ platform: 'linux', env: { WAYLAND_DISPLAY: 'w' }, has: has('chromium') }), ['chromium', '--incognito', 'https://claude.ai/x']);
  assert.deepEqual(argv({ platform: 'linux', env: { DISPLAY: ':0' }, has: has('microsoft-edge') }), ['microsoft-edge', '--inprivate', 'https://claude.ai/x']);
  assert.equal(findBrowser({ platform: 'linux', env: {}, has: has('firefox') }), null, 'headless');
  assert.equal(findBrowser({ platform: 'linux', env: { DISPLAY: ':0' }, has: has() }), null, 'no browser');
  assert.deepEqual(argv({ platform: 'darwin', env: {}, has: has('Google Chrome') }), ['open', '-na', 'Google Chrome', '--args', '--incognito', 'https://claude.ai/x']);
  const win = argv({ platform: 'win32', env: { ProgramFiles: 'C:\\P' }, has: (p) => p.endsWith('firefox.exe') });
  assert.match(win[0], /firefox\.exe$/);
  assert.deepEqual(win.slice(1), ['--private-window', 'https://claude.ai/x']);
  assert.equal(findBrowser({ platform: 'freebsd', env: {} }), null);
  // The real lookups, on whatever machine this is: they answer without throwing.
  for (const platform of ['linux', 'darwin', 'win32']) findBrowser({ platform, env: { DISPLAY: ':0', PATH: '/nonexistent' } });
});

test('openPrivate launches the browser detached, and nothing for an unsafe URL or no browser', () => {
  const started = [];
  const start = (cmd, args, o) => { started.push({ cmd, args, o }); return { on() { return this; }, unref() {} }; };
  const find = () => ({ name: 'Firefox', argv: (u) => ['firefox', '--private-window', u] });
  assert.equal(openPrivate('https://claude.ai/x', { find, start }), 'Firefox');
  assert.deepEqual(started[0].args, ['--private-window', 'https://claude.ai/x']);
  assert.equal(started[0].o.detached, true);
  assert.equal(openPrivate('https://evil.example/x', { find, start }), null);
  assert.equal(openPrivate('https://claude.ai/x', { find: () => null, start }), null);
  assert.equal(openPrivate('https://claude.ai/x', { find, start: () => { throw new Error('spawn failed'); } }), null);
  assert.equal(started.length, 1);
});
