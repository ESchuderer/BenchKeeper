import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { registry } from '../src/agents.mjs';
import { fill, genericDir, load } from '../src/automations.mjs';
import { context } from '../src/runner.mjs';

const template = () => load(context({ home: mkdtempSync(join(tmpdir(), 'bk-pc-')) }), [['generic', genericDir]]).templates.find((t) => t.id === 'provider-changelog');
const sh = { skip: process.platform === 'win32' && 'sh precheck' };

// The precheck with a fake --version output per agent bin (missing: the agent fails, as if not installed) and the
// report text (null: no report yet).
function precheck(values, versions, report = null) {
  const bin = mkdtempSync(join(tmpdir(), 'bk-pc-bin-'));
  for (const a of registry) writeFileSync(join(bin, a.bin), versions[a.bin] ? `#!/bin/sh\necho '${versions[a.bin]}'\n` : '#!/bin/sh\nexit 127\n', { mode: 0o755 });
  if (report !== null) writeFileSync(join(bin, 'report.md'), report);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const r = spawnSync('sh', ['-c', fill(template(), { file: join(bin, 'report.md'), ...values }).precheck], { cwd: genericDir, env, encoding: 'utf8' });
  return { code: r.status, stderr: r.stderr };
}

test('provider-changelog: parameters file and sources, the official release notes by default, report only', () => {
  const t = template();
  assert.deepEqual(Object.keys(t.parameters), ['file', 'sources']);
  assert.equal(t.mode, 'report');
  assert.equal(fill(t, { file: 'r.md' }).values.sources.split(',').length, registry.length, 'one source per agent');
  assert.doesNotMatch(t.prompt, /\bgh (pr|issue|release) (create|comment|edit|close|reopen|merge|review)\b|\bgh api\b|\bgit push\b/);
});

test('provider-changelog: versions.sh asks every agent of the registry', () => {
  const helper = readFileSync(join(genericDir, 'provider-changelog/versions.sh'), 'utf8');
  assert.equal(/for a in ([^;]+);/.exec(helper)[1], registry.map((a) => a.bin).join(' '));
});

test('provider-changelog precheck: runs without a report or for a version the last report does not name', sh, () => {
  const v = { claude: '2.1.3 (Claude Code)', codex: 'codex-cli 0.50.0' };
  assert.equal(precheck({}, {}).code, 1, 'no agent installed');
  assert.equal(precheck({}, v).code, 0, 'no report yet');
  const report = 'claude 2.1.3\ncodex 0.50.0\n\n## claude\n';
  assert.equal(precheck({}, v, report).code, 1, 'every version covered');
  assert.equal(precheck({}, { ...v, codex: 'codex-cli 0.51.0' }, report).code, 0, 'a newer codex');
  assert.equal(precheck({}, { ...v, gemini: '0.9.0' }, report).code, 0, 'a newly installed agent');
  assert.equal(precheck({}, v, 'claude 2.1.30\ncodex 0.50.0\n').code, 0, 'a version is matched as a whole line');
});

test('provider-changelog: install and the precheck both refuse a source that is not an official provider page', sh, () => {
  const t = template(), v = { claude: '2.1.3' };
  for (const s of ['example.com/claude-code/CHANGELOG.md', 'github.com/someone/claude-code/releases', 'github.com/anthropics/claude-code/../../evil/x', 'github.com/anthropics', 'github.com/openai/codex/releases,reddit.com/r/codex', '']) {
    assert.throws(() => fill(t, { file: 'r.md', sources: s }), /does not start with/, s);
    // The precheck called as installed, with the value fill refused.
    const r = spawnSync('sh', ['provider-changelog/precheck.sh', 'r.md', s], { cwd: genericDir, encoding: 'utf8' });
    assert.equal(r.status, 2, s);
  }
  for (const s of ['developers.openai.com/codex/changelog,docs.github.com/en/copilot/whats-new', t.parameters.sources.allow.map((a) => `${a}x`).join(',')]) {
    assert.equal(fill(t, { file: 'r.md', sources: s }).values.sources, s);
    assert.equal(precheck({ sources: s }, v).code, 0, s);
  }
});
