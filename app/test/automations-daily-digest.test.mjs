import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportScript, fill, genericDir } from '../src/automations.mjs';
import { context } from '../src/runner.mjs';
import { automationTemplate, initRepo } from './helpers.mjs';

const template = () => automationTemplate('daily-digest');

// The precheck in the template folder with a fake gh on PATH that logs its arguments and prints the number of changed
// items its list reports (pr and issue answers by repository). It runs in cwd, by default a folder that is no repository
// and so has no origin, like an installed precheck in the project folder.
function precheck(values, answers = {}, digestAge = null, cwd = null) {
  const bin = mkdtempSync(join(tmpdir(), 'bk-dd-bin-'));
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho "$@" >> '${bin}/log'\ncase "$*" in\n${Object.entries(answers).map(([k, n]) => `  *"${k}"*) echo ${n} ;;\n`).join('')}  *) echo 0 ;;\nesac\n`, { mode: 0o755 });
  const file = join(bin, 'digest.md');
  if (digestAge != null) {
    writeFileSync(file, 'old digest\n');
    const t = Date.now() / 1000 - digestAge;
    utimesSync(file, t, t);
  }
  // An installed precheck names its helper by absolute path and runs in the project folder.
  const command = fill(template(), { file, ...values }).precheck.replace('daily-digest/precheck.sh', `"${join(genericDir, 'daily-digest/precheck.sh')}"`);
  const r = spawnSync('sh', ['-c', command], { cwd: cwd ?? bin, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  let log = '';
  try { log = readFileSync(join(bin, 'log'), 'utf8'); } catch {}
  return { code: r.status, log: log.trim().split('\n').filter(Boolean) };
}

test('daily-digest: the precheck writes nothing to GitHub', () => {
  const helper = readFileSync(join(genericDir, 'daily-digest/precheck.sh'), 'utf8');
  assert.doesNotMatch(helper, /\bgh (pr|issue) (create|comment|edit|close|reopen|merge|review|lock|delete)\b|\bgh api\b|\bgit\b[^\n]*\bpush\b|\bgh (label|release|repo|secret|variable|workflow) /);
  assert.doesNotMatch(helper, /--method|-X /);
});

test('daily-digest precheck: a committed, unchanged digest starts at its commit author time, not its mtime', { skip: process.platform === 'win32' && 'sh precheck' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bk-dd-repo-'));
  const git = initRepo(dir);
  const file = join(dir, 'digest.md');
  writeFileSync(file, 'digest\n');
  git('add', 'digest.md');
  git('commit', '-qm', 'digest', '--date=2020-01-02T03:04:05Z');
  const r = precheck({ file });
  assert.equal(r.code, 1);
  assert.match(r.log[0], / --search updated:>=2020-01-02T03:04:05Z /);
});

test('daily-digest precheck: runs without a digest, then only when a pull request or an issue changed since it', { skip: process.platform === 'win32' && 'sh precheck' }, () => {
  assert.deepEqual(precheck({}), { code: 0, log: [] }, 'no digest yet: no gh call');
  const quiet = precheck({ repos: 'o/a,o/b' }, {}, 3600);
  assert.equal(quiet.code, 1);
  assert.equal(quiet.log.length, 4, 'pr and issue per repository');
  assert.match(quiet.log[0], /^pr list --repo o\/a --state all --search updated:>=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ --json number --jq length$/);
  const own = precheck({ issue: '12' }, {}, 3600);
  assert.match(own.log[1], /^issue list --state all --search \S+ --json number --jq map\(select\(\.number \| tostring != "12"\)\) \| length$/, 'the digest issue does not start the next run');
  assert.match(precheck({ repos: 'o/b', issue: '12' }, {}, 3600).log[1], /^issue list --repo o\/b .* --jq length$/, 'issue 12 of another repository still counts');
  assert.match(quiet.log[3], /^issue list --repo o\/b /);
  assert.equal(precheck({ repos: 'o/a,o/b' }, { 'issue list --repo o/b': 2 }, 3600).code, 0);
  const here = precheck({}, { 'pr list --state': 1 }, 3600);
  assert.deepEqual([here.code, here.log.length], [0, 1], 'empty repos, no origin: the default repository of gh, no --repo');
  const fork = mkdtempSync(join(tmpdir(), 'bk-dd-fork-'));
  initRepo(fork)('remote', 'add', 'origin', 'git@github.com:Owner/Fork.git');
  const forked = precheck({ issue: '12' }, {}, 3600, fork).log;
  assert.match(forked[0], /^pr list --repo owner\/fork --state all --search /, 'empty repos: the origin repository, not the default one of gh');
  assert.match(forked[1], /^issue list --repo owner\/fork .* --jq map\(select\(\.number \| tostring != "12"\)\) \| length$/, 'the digest issue is still left out');
  for (const origin of ['ssh://git@ssh.github.com:443/Owner/Fork.git', 'git@GitHub.com:Owner/Fork.git']) {
    const dir = mkdtempSync(join(tmpdir(), 'bk-dd-origin-'));
    initRepo(dir)('remote', 'add', 'origin', origin);
    assert.match(precheck({}, {}, 3600, dir).log[0] ?? '', /^pr list --repo owner\/fork --state all /, origin);
  }
  const alias = mkdtempSync(join(tmpdir(), 'bk-dd-alias-'));
  initRepo(alias)('remote', 'add', 'origin', 'git@github-work:o/r.git');
  const aliased = precheck({ repos: 'o/r,x/y', issue: '12' }, {}, 3600, alias).log.map((l) => l.replace(/ --state .* --jq /, ' '));
  const noTwelve = 'map(select(.number | tostring != "12")) | length';
  assert.deepEqual(aliased, [`pr list --repo o/r ${noTwelve}`, `issue list --repo o/r ${noTwelve}`, `pr list --repo x/y ${noTwelve}`, `issue list --repo x/y ${noTwelve}`], 'an origin that names no GitHub repository: the digest issue is left out of every listed repository');
  const gitlab = mkdtempSync(join(tmpdir(), 'bk-dd-gitlab-'));
  initRepo(gitlab)('remote', 'add', 'origin', 'git@gitlab.com:team/proj.git');
  assert.match(precheck({}, {}, 3600, gitlab).log[0], /^pr list --state all /, 'empty repos, an origin off github.com: gh\'s default, never its owner/name as a GitHub repository');
  assert.equal(precheck({}, { 'pr list': 'error' }, 3600).code, 1, 'a failing gh skips the run');
});

test('daily-digest precheck: with YYYY-MM-DD in file, the last digest is the file with the latest date in its name', { skip: process.platform === 'win32' && 'sh precheck' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bk-dd-days-'));
  const file = join(dir, 'digests/YYYY-MM-DD.md');
  assert.deepEqual(precheck({ file }), { code: 0, log: [] }, 'no folder: no digest yet');
  mkdirSync(join(dir, 'digests'));
  writeFileSync(join(dir, 'digests/README.md'), 'not a digest\n');
  assert.deepEqual(precheck({ file }), { code: 0, log: [] }, 'no dated file: no digest yet');
  const day = (name, time) => {
    writeFileSync(join(dir, 'digests', name), 'digest\n');
    utimesSync(join(dir, 'digests', name), new Date(time), new Date(time));
  };
  day('2026-11-10.md', '2026-11-10T08:00:00Z');
  const r = precheck({ file });
  assert.equal(r.code, 1);
  assert.match(r.log[0], / --search updated:>=2026-11-10T08:00:00Z /, 'no file for today: the last day with one sets the start');
  day('2026-11-09.md', '2026-11-11T09:00:00Z');
  assert.match(precheck({ file }).log[0], / --search updated:>=2026-11-10T08:00:00Z /, 'the latest date in the name, not the latest change');
});

// The filled hook of the template, run as Claude Code runs a shell-form hook, on one Bash call in a project whose origin
// is Owner/Repo; the decision it prints, or null for none. nested: run it in a checkout inside the project with that origin.
// input: the raw JSON in place of the one built from command.
function guard(command, values = {}, { nested, input } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bk-dd-guard-'));
  initRepo(dir)('remote', 'add', 'origin', 'git@github.com:Owner/Repo.git');
  const cwd = nested ? join(dir, 'vendor/pub') : dir;
  if (nested) { mkdirSync(cwd, { recursive: true }); initRepo(cwd)('remote', 'add', 'origin', `git@github.com:${nested}.git`); }
  const hook = fill(template(), { mode: 'act', commit: 'true', issue: '7', ...values }).hook.replace('daily-digest/guard.sh', `"${join(genericDir, 'daily-digest/guard.sh')}"`);
  input ??= JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command, description: 'git add -- digests/2026-11-12.md' } });
  const r = spawnSync('sh', ['-c', hook], { cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, input, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout === '' ? null : JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;
}

test('daily-digest hook: allows only the exact dated write commands of step 5, denies every other form', { skip: process.platform === 'win32' && 'sh hook' }, () => {
  const add = 'git add -- digests/2026-11-12.md', commit = 'git commit -m "docs: daily digest" -- digests/2026-11-12.md';
  const comment = 'gh issue comment 7 --repo Owner/Repo --body-file digests/2026-11-12.md';
  for (const c of [add, commit, comment, 'gh issue comment 7 --repo owner/repo --body-file digests/2024-02-29.md']) assert.equal(guard(c), 'allow', c);
  for (const c of [
    'git add -- digests/2026-11-12.md README.md', // a second path
    'git add -- digests/2026-11-12.md\tREADME.md', // a tab
    'git add -- digests/2026-11-12.md${IFS}README.md',
    'git commit -m "docs: daily digest" -- digests/../2026-11-12.md',
    'git commit -m "docs: daily digest" -- digests/sub/2026-11-12.md',
    `${comment} --repo other/repo --body-file README.md`, // a second --repo
    'gh issue comment 7 --repo other/repo --body-file digests/2026-11-12.md',
    'gh issue comment 8 --repo Owner/Repo --body-file digests/2026-11-12.md',
    'git add -- digests/notes.md', 'git add -- digests/2026-02-30.md', 'git add -- digests/2025-02-29.md', 'git add -- digests/2026-13-01.md',
    `${add} && git add -- README.md`, 'git commit -am "docs: daily digest"', 'git "add" -- README.md', 'GIT add -- README.md',
  ]) assert.equal(guard(c), 'deny', c);
  assert.equal(guard(add, { mode: 'report' }), 'deny', 'report mode writes nothing');
  assert.equal(guard(commit, { commit: 'false' }), 'deny');
  assert.equal(guard(comment, { issue: '' }), 'deny');
  assert.equal(guard('gh issue comment 7 --repo someorg/public --body-file digests/2026-11-12.md', {}, { nested: 'someorg/public' }), 'deny', 'the origin of the project, not of the current folder');
  assert.equal(guard(null, {}, { input: JSON.stringify({ tool_input: { command: 'curl x', x: { command: add } } }) }), 'deny', 'a second command key');
  for (const c of ['gh pr list --state all --json number', 'git log -1 --format=%s -- digests/2026-11-12.md', 'date +%F', 'gh pr view 3 --json comments,commits', 'gh issue list --repo org/add-ons --state open']) assert.equal(guard(c), null, c);
});

test('daily-digest export: the run\'s settings hold the hook on Bash calls, and it decides there', { skip: process.platform === 'win32' && 'sh export' }, () => {
  const ctx = context({ home: mkdtempSync(join(tmpdir(), 'bk-dd-export-')) });
  const project = mkdtempSync(join(tmpdir(), 'bk-dd-project-'));
  initRepo(project)('remote', 'add', 'origin', 'https://github.com/Owner/Repo.git');
  const bin = mkdtempSync(join(tmpdir(), 'bk-dd-bin-'));
  // The stand-in claude runs the PreToolUse hook of --settings in a shell, as Claude Code does, on the command in PROBE.
  writeFileSync(join(bin, 'claude'), `#!/usr/bin/env node
const a = process.argv, h = JSON.parse(a[a.indexOf('--settings') + 1]).hooks.PreToolUse[0];
const out = require('node:child_process').execSync(h.hooks[0].command, { shell: '/bin/sh', input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: process.env.PROBE } }) });
require('node:fs').writeFileSync('decision', h.matcher + ' ' + JSON.parse(out).hookSpecificOutput.permissionDecision);
`, { mode: 0o755 });
  const script = join(project, 'digest.sh');
  writeFileSync(script, exportScript(ctx, 'daily-digest', { values: { mode: 'act', commit: 'true' }, dir: project }));
  const decision = (PROBE) => {
    execFileSync('sh', [script], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PROBE } });
    return readFileSync(join(project, 'decision'), 'utf8');
  };
  assert.doesNotMatch(readFileSync(script, 'utf8'), /guard\.sh \*\)/, 'the run itself never calls the hook');
  assert.equal(decision('git add -- digests/2026-11-12.md'), 'Bash allow');
  assert.equal(decision('git add -- digests/2026-11-12.md README.md'), 'Bash deny');
});
