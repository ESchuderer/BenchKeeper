import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { rehearse } from '../src/prerun.mjs';
import { context } from '../src/runner.mjs';
import { pick, registryHosts } from '../src/sandbox.mjs';

const has = (...bins) => (b) => bins.includes(b);
const ALL = ['bwrap', 'socat', 'rg', 'sandbox-exec'];
const facts = (platform, bins = ALL, node = '22.22.0') => ({ platform, has: has(...bins), node });

test('sandbox: srt where its programs and Node are there, the platform tool alone where they are not, none otherwise', () => {
  assert.deepEqual(pick(facts('linux')), { tool: 'srt' });
  assert.deepEqual(pick(facts('darwin')), { tool: 'srt' });
  assert.deepEqual(pick(facts('linux', ['bwrap', 'socat', 'rg'], '22.12.0')), { tool: 'srt' });
  // Linux needs socat and rg for srt; macOS only rg. Without them the platform tool confines writes and the note says why.
  assert.match(pick(facts('linux', ['bwrap', 'rg'])).note, /^socat missing, so the network is not limited \(install bubblewrap, socat and ripgrep/);
  assert.equal(pick(facts('linux', ['bwrap'])).note.split(',')[0], 'socat and rg missing');
  assert.equal(pick(facts('linux', ['bwrap', 'socat', 'rg'], '22.11.9')).tool, 'bwrap');
  assert.match(pick(facts('linux', ['bwrap', 'socat', 'rg'], '22.11.9')).note, /^Node 22\.11\.9 is older than 22\.12/);
  assert.deepEqual(pick(facts('darwin', ['sandbox-exec'])), { tool: 'sandbox-exec', fix: 'install ripgrep', note: 'rg missing, so the network is not limited (install ripgrep)' });
  assert.equal(pick(facts('linux', ALL, '22.11.0')).fix, 'use Node 22.12 or newer');
  // Nothing to build on: a message that names the cause.
  assert.match(pick(facts('linux', [])).why, /^bwrap is missing: install bubblewrap, socat and ripgrep \(Debian, Ubuntu, WSL2: apt install/);
  assert.match(pick(facts('darwin', [])).why, /^sandbox-exec is missing/);
  assert.equal(pick(facts('win32')).why, 'Windows has no sandbox the app can use (unsupported)');
  assert.equal(pick(facts('freebsd')).why, 'freebsd has no sandbox the app can use (unsupported)');
  // The real machine answers too, from its PATH.
  assert.ok(['srt', 'bwrap', 'sandbox-exec', null].includes(pick().tool));
});

test('sandbox: the registry hosts of the npm settings and of the registry variable join the allow list', () => {
  const rc = 'registry=https://npm.example/a/\n@acme:registry = https://scoped.example:8443/x\n  registry=not a url\n//npm.example/:_authToken=x\n';
  assert.deepEqual(registryHosts(rc, { NPM_CONFIG_REGISTRY: 'https://env.example/', npm_config_cache: '/x' }), ['npm.example', 'scoped.example', 'env.example']);
  assert.deepEqual(registryHosts(null, {}), []);
});

// The real sandbox, where the dev container provides it (bubblewrap, socat, ripgrep, an unmasked /proc, the registry): the
// command goes through the function the preview uses.
test('sandbox: srt confines a real command to its scratch folder and to the allowed hosts', { skip: process.env.BENCHKEEPER_SANDBOX_TEST !== '1' && 'needs bubblewrap, socat and ripgrep (the dev container)' }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'bk-sandbox-home-'));
  const outside = join(tmpdir(), `bk-sandbox-outside-${process.pid}.txt`);
  t.after(() => { rmSync(home, { recursive: true, force: true }); rmSync(outside, { force: true }); });
  // Each probe records what happened in result.json below the scratch folder; the hostile arguments come back as they went in.
  const probe = `
    const fs = require('fs'), { spawnSync } = require('child_process');
    const out = { argv: process.argv.slice(1) };
    try { fs.writeFileSync(process.argv[1], 'x'); out.outside = 'wrote'; } catch (e) { out.outside = e.code; }
    const npm = (...a) => spawnSync('npm', ['view', 'skills@1.7.2', 'version', ...a], { encoding: 'utf8' }).status;
    out.allowed = npm();
    out.refused = npm('--registry', 'https://registry.yarnpkg.com/');
    fs.writeFileSync('result.json', JSON.stringify(out));`;
  const hostile = [outside, 'a b', '$(touch bk-inject)', '; touch bk-inject2', "it's", '', '*', '--', '-s', '`id`'];
  const ctx = context({ home });
  const r = await rehearse(ctx, { kind: 'command', argv: ['node', '-e', probe, ...hostile] });
  assert.equal(r.error, null, r.error);
  assert.equal(r.sandbox, 'srt');
  const added = r.files.find((f) => f.path.endsWith('result.json')).diff.split('\n').find((l) => l.startsWith('+{')).slice(1);
  const out = JSON.parse(added);
  assert.deepEqual(out.argv, hostile, 'the argv reaches the command as it went in, through the shell srt starts');
  assert.equal(out.outside, 'EROFS', 'a write outside the scratch folder fails');
  assert.ok(!existsSync(outside));
  assert.equal(out.allowed, 0, 'the registry answers');
  assert.notEqual(out.refused, 0, 'another registry host is refused');
  assert.deepEqual(r.files.map((f) => f.path.replace(/^.*[\\/]/, '')), ['result.json'], 'nothing was injected');
});
