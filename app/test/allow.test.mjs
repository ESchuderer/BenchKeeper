import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { allowChecks, classify, codexAllows } from '../src/allow.mjs';
import { addProject } from '../src/projects.mjs';
import { context } from '../src/runner.mjs';
import { readSettings } from '../src/settings.mjs';

const TMP = realpathSync(tmpdir());
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

test('classify: every shell and code flag, and why each rule is reported', () => {
  for (const s of ['bash', 'sh', 'zsh', 'fish', 'dash', 'ksh', 'python', 'python3', 'python3.12', 'node', 'npx', 'perl', 'ruby', 'deno', 'bun', 'php', '/usr/bin/bash']) {
    assert.deepEqual(classify(`Bash(${s} *)`), { level: 'warning', why: `${s} runs any code` }, s);
  }
  for (const f of ['-c', '-e', '-p', '-lc', '-ic', '-ec', '--eval', '--command']) assert.deepEqual(classify(`Bash(sh ${f} *)`), { level: 'warning', why: 'sh runs any code' }, f);
  const cases = {
    Bash: { level: 'warning', why: 'every Bash call' },
    ' PowerShell ': { level: 'warning', why: 'every PowerShell call' },
    'Bash( * )': { level: 'warning', why: 'every Bash call' },
    Write: { level: 'info', why: 'every Write call' },
    'WebFetch(*)': { level: 'info', why: 'every WebFetch call' },
    'Bash(* --help)': { level: 'warning', why: 'any program' },
    'Bash(python:* x)': { level: 'warning', why: 'any program' },
    'Bash( python *)': { level: 'warning', why: 'python runs any code' },
    'Bash(python  *)': { level: 'warning', why: 'python runs any code' },
    'Bash(python -c * x)': { level: 'warning', why: 'python runs any code' },
    'Bash(git * main)': { level: 'info', why: 'a wildcard before the rest of the command' },
    'Bash(python3x *)': null,
    'Bash(xpython3 *)': null,
    'Bash(npm:*)': null,
    'Read(*)': null,
    'x Bash': null,
    'Bash(*) x': null,
  };
  for (const [rule, want] of Object.entries(cases)) assert.deepEqual(classify(rule), want, rule);
});

test('codex rules: spacing, a rule without pattern, alternatives and comments inside strings', () => {
  const found = (text) => codexAllows(text).map((r) => [r.line, r.rule, r.why, r.level]);
  assert.deepEqual(found('prefix_rule(pattern=["bash",   "-c"], decision="allow")'), [[1, 'pattern = ["bash", "-c"]', 'bash runs any code', 'warning']]);
  assert.deepEqual(found('prefix_rule(pattern = ["bash", "-c"], decision="prompt")'), []);
  assert.deepEqual(found('prefix_rule(pattern = ["git"])\nprefix_rule (pattern = ["bash", "-c"])'), [[2, 'pattern = ["bash", "-c"]', 'bash runs any code', 'warning']]);
  assert.deepEqual(found('prefix_rule(decision = "allow")'), []);
  assert.deepEqual(found('prefix_rule(pattern = [ ["node", "deno"], "-e"])').map((r) => r[2]), ['node or deno runs any code']);
  assert.deepEqual(found('prefix_rule(pattern = [["git", "node"], "-e"])').map((r) => r[2]), ['git or node runs any code']);
  assert.deepEqual(found('prefix_rule(pattern = [["node", "deno"], "script.js"])'), []);
  assert.deepEqual(found('  # prefix_rule(pattern = ["bash"])'), []);
  assert.deepEqual(found('prefix_rule(pattern = ["bash", "-c"], justification = "#1", decision = "prompt")'), []);
});

test('allow rules: managed settings are not read, Codex user rules and the message and fix name file, line and documentation', () => {
  const home = mkdtempSync(join(TMP, 'bk-allow-'));
  const dir = mkdtempSync(join(TMP, 'bk-allow-proj-'));
  const ctx = Object.assign(context({ home, run: () => ({ code: 0, stdout: '', stderr: '' }) }), { managedRoot: mkdtempSync(join(TMP, 'bk-allow-managed-')) });
  put(readSettings(ctx, 'claude').find((l) => l.layer === 'managed').path, JSON.stringify({ permissions: { allow: ['Bash(sh *)'] } }));
  put(join(home, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash(python *)'] } }));
  put(join(home, '.codex/rules/b.rules'), '\nprefix_rule(pattern = ["bash", "-c"])\n');
  put(join(home, '.codex/rules/a.rules'), 'prefix_rule(pattern = ["sh", "-c"])\n');
  put(join(home, '.codex/rules/notes.txt'), 'prefix_rule(pattern = ["zsh", "-c"])\n');
  put(join(dir, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash(python *)'] } }));
  addProject(ctx, dir);
  const user = allowChecks(ctx);
  assert.deepEqual(user.map((i) => [i.message.split(' ')[0], i.scope, i.file, i.rule, i.line, i.repos]), [
    ['Claude', 'user', join('~', '.claude/settings.json'), 'Bash(python *)', undefined, 1],
    ['Codex', 'user', join('~', '.codex/rules/a.rules'), 'pattern = ["sh", "-c"]', 1, 0],
    ['Codex', 'user', join('~', '.codex/rules/b.rules'), 'pattern = ["bash", "-c"]', 2, 0],
  ]);
  assert.equal(user[0].message, `Claude Code allows Bash(python *) (user, ${join('~', '.claude/settings.json')}): python runs any code; 1 registered repository carries it`);
  assert.equal(user[2].message, `Codex allows pattern = ["bash", "-c"] (user, ${join('~', '.codex/rules/b.rules')}:2): bash runs any code`);
  assert.match(user[0].fix, /\(https:\/\/code\.claude\.com\/docs\/en\/permissions\)$/);
  assert.match(user[1].fix, /\(https:\/\/developers\.openai\.com\/codex\/rules\)$/);
  assert.ok(!('line' in user[0]));
  assert.deepEqual(allowChecks(ctx, { dir }).map((i) => [i.scope, i.rule]), [['project', 'Bash(python *)']]);
});
