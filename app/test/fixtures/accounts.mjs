import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { context, runCommand } from '../../src/runner.mjs';

// Dummy values only: no real login, no real browser, no real home. The agents, devcontainer and podman are scripts in a
// temporary folder that the tests put first on the PATH of the app's context; they log what they were called with.
export const win = process.platform === 'win32';
export const CLAUDE_TOKEN = 'sk-ant-oat01-DUMMY0123456789abcdefABCDEFxyz';
export const CODEX_TOKEN = 'dummy.codex.access-token-0123456789abcdef';
export const URL1 = 'https://claude.ai/oauth/authorize?code=true&client_id=dummy&state=abc';

const SCRIPT = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const bin = path.dirname(process.argv[1]);
const me = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const mode = (f) => { try { return fs.readFileSync(path.join(bin, f), 'utf8').trim(); } catch { return ''; } };
fs.appendFileSync(path.join(bin, 'log.jsonl'), JSON.stringify({ me, args, env: process.env }) + '\n');
const dir = process.env.CLAUDE_CONFIG_DIR, home = process.env.CODEX_HOME;
const line = (cb) => { const t = setTimeout(() => process.exit(3), 5000); process.stdin.once('data', (d) => { clearTimeout(t); cb(String(d).trim(), String(d)); }); };
const write = (d, f, o) => { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, f), JSON.stringify(o)); };
const logged = (d, f) => d && fs.existsSync(path.join(d, f));
if (me === 'claude' && args[0] === 'auth' && args[1] === 'status') {
  const ok = logged(dir, '.credentials.json');
  console.log(JSON.stringify({ loggedIn: ok, authMethod: ok ? 'claude.ai' : 'none', configDirectory: dir }));
  process.exit(ok ? 0 : 1);
} else if (me === 'claude' && args[0] === 'auth' && args[1] === 'login') {
  console.log('Opening browser to sign in...');
  console.log('If the browser did not open, visit: ${URL1}');
  if (mode('flow') === 'fail') { console.error('login failed: Bearer ${CLAUDE_TOKEN}'); process.exit(1); }
  if (mode('flow') === 'callback') setTimeout(() => { write(dir, '.credentials.json', { accessToken: 'dummy-oauth-access' }); process.exit(0); }, 100);
  else line((code) => { fs.writeFileSync(path.join(bin, 'pasted'), code); write(dir, '.credentials.json', { accessToken: 'dummy-oauth-access' }); process.exit(0); });
} else if (me === 'claude' && args[0] === 'setup-token') {
  console.log('Visit: ${URL1}');
  line(() => { console.log('Your long-lived token: ${CLAUDE_TOKEN}'); console.log('Store it safely.'); process.exit(mode('flow') === 'fail' ? 1 : 0); });
} else if (me === 'codex' && args[0] === 'login' && args[1] === 'status') {
  const ok = logged(home, 'auth.json');
  console.log(ok ? 'Logged in using ChatGPT' : 'Not logged in');
  process.exit(ok ? 0 : 1);
} else if (me === 'codex' && args[0] === 'login' && args[1] === '--device-auth') {
  console.log('Open https://auth.openai.com/codex/device and enter the code');
  console.log('ABCD-12345');
  setTimeout(() => { write(home, 'auth.json', { tokens: { access: 'dummy-codex-access' } }); process.exit(0); }, 100);
} else if (me === 'codex' && args[0] === 'login' && args[1] === '--with-access-token') {
  line((tok) => { fs.writeFileSync(path.join(bin, 'stdin-token'), tok); write(home, 'auth.json', { tokens: { access: 'from-stdin' } }); console.log('Logged in with ' + tok); process.exit(0); });
} else if (me === 'podman' || me === 'docker') {
  process.exit(mode('engine') === 'none' ? 127 : 0);
} else if (me === 'devcontainer') {
  if (args[0] === 'up') process.exit(0);
  let i = 1;
  while (args[i] && args[i].startsWith('--')) i += 2;
  const rest = args.slice(i);
  if (rest[0] === 'grep') process.exit(mode('mounted') === 'no' ? 1 : 0);
  // The volume is a folder of the machine: cat, rm, mkdir and tee act on it, so the tests read what a container holds.
  const vol = (p) => path.join(bin, 'vol', p);
  if (rest[0] === 'cat') { if (mode('cat') === 'fail') { console.error('devcontainer exec failed'); process.exit(255); } try { process.stdout.write(fs.readFileSync(vol(rest[1]))); process.exit(0); } catch { console.error('cat: ' + rest[1] + ': No such file or directory'); process.exit(1); } }
  if (rest[0] === 'rm') { fs.rmSync(vol(rest[2]), { force: true }); process.exit(0); }
  if (rest[0] === 'mkdir') { fs.mkdirSync(vol(rest[2]), { recursive: true }); process.exit(0); }
  // The token hand-over: the write keeps stdin in the volume file, the launch reads and removes it, then logs the agent
  // it starts with the variable in its environment.
  if (rest[0] === 'sh' && rest[2].includes('cat >')) { let d = ''; process.stdin.on('data', (c) => { d += c; }).on('end', () => { fs.mkdirSync(path.dirname(vol(rest[4])), { recursive: true }); fs.writeFileSync(vol(rest[4]), d, { mode: 0o600 }); process.exit(0); }); return; }
  if (rest[0] === 'sh') {
    let tok; try { tok = fs.readFileSync(vol(rest[4]), 'utf8'); } catch { process.exit(1); }
    fs.rmSync(vol(rest[4]));
    fs.appendFileSync(path.join(bin, 'log.jsonl'), JSON.stringify({ me: 'in-container', args: rest.slice(5), env: { CLAUDE_CODE_OAUTH_TOKEN: tok } }) + '\n');
    process.exit(0);
  }
  if (rest[0] === 'tee') { let d = ''; process.stdin.on('data', (c) => { d += c; }).on('end', () => { fs.writeFileSync(vol(rest[1]), d); process.exit(0); }); return; }
  if (rest[0] === 'claude' && rest[1] === 'auth' && rest[2] === 'status') {
    const ok = mode('container-login') === 'yes';
    console.log(JSON.stringify({ loggedIn: ok, authMethod: ok ? 'claude.ai' : 'none' }));
    process.exit(ok ? 0 : 1);
  }
  if (rest[0] === 'claude' && rest[1] === 'auth' && rest[2] === 'login') { console.log('visit: ${URL1}'); process.exit(0); }
  if (rest[0] === 'codex' && rest[1] === 'login') line((tok) => { fs.writeFileSync(path.join(bin, 'stdin-token'), tok); process.exit(0); });
  else process.exit(0);
} else { process.exit(0); }
`;

// A temporary machine: home, bin folder with the fake programs first on PATH, a fake credential store and browser.
export function machine({ flow = 'code', engine = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bk-acct-'));
  const home = join(root, 'home'), bin = join(root, 'bin');
  mkdirSync(home); mkdirSync(bin);
  for (const n of ['claude', 'codex', 'devcontainer', 'podman', 'docker']) { writeFileSync(join(bin, n), SCRIPT); chmodSync(join(bin, n), 0o755); }
  writeFileSync(join(bin, 'flow'), flow);
  if (!engine) writeFileSync(join(bin, 'engine'), 'none');
  const kept = new Map(), opened = [];
  const credentials = { name: 'fake-store', set: (n, t) => kept.set(n, t), get: (n) => kept.get(n) ?? null, has: (n) => kept.has(n), delete: (n) => kept.delete(n) };
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: home, LANG: 'C', ANTHROPIC_API_KEY: 'dummy-api-key', GH_TOKEN: 'dummy-gh', CODEX_HOME: '/inherited/codex', CLAUDE_CONFIG_DIR: '/inherited/claude', CLAUDE_CODE_OAUTH_TOKEN: 'inherited-oauth-token-dummy' };
  const ctx = { ...context({ home, run: runCommand }), env, credentials, openPrivate: (u) => { opened.push(u); return 'Firefox'; } };
  const calls = () => (existsSync(join(bin, 'log.jsonl')) ? readFileSync(join(bin, 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { root, home, bin, ctx, kept, opened, env, calls, flow: (f) => writeFileSync(join(bin, 'flow'), f), mode: (k, v) => writeFileSync(join(bin, k), v) };
}

// Every file under dir whose bytes contain needle.
export function grep(dir, needle) {
  const hits = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (readFileSync(p).includes(needle)) hits.push(p); } };
  if (existsSync(dir)) walk(dir);
  return hits;
}

