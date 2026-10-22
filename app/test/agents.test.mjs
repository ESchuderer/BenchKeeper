import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { agent, detect, forAgent, registry, renderJsonSettings, renderRules, renderSubagent, skillDirs, subagentFile } from '../src/agents.mjs';
import { setToml } from '../src/merge.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const sub = { name: 'reviewer', description: 'Reviews diffs: correctness only.', prompt: 'Read the diff.\nReport gaps.', tools: ['Read', 'Grep'] };

test('registry: four agents, each with global and project paths', () => {
  assert.deepEqual(registry.map((a) => a.id), ['claude', 'codex', 'gemini', 'copilot']);
  for (const a of registry) for (const scope of ['global', 'project']) assert.ok(a[scope].rules && a[scope].skills, `${a.id} ${scope}`);
  assert.deepEqual(registry.filter((a) => a.tested).map((a) => a.id), ['claude', 'codex']);
});

test('detection reports versions and missing agents', () => {
  const run = (argv) => (argv[0] === 'claude' ? { code: 0, stdout: '2.1.310 (Claude Code)\n' } : argv[0] === 'codex' ? { code: 0, stdout: 'codex-cli 0.163.0\n' } : { code: 127, stdout: '' });
  assert.deepEqual(detect({ run }).map((a) => [a.id, a.installed, a.version]), [['claude', true, '2.1.310'], ['codex', true, '0.163.0'], ['gemini', false, null], ['copilot', false, null]]);
});

test('agents reading one skill folder share it', () => {
  assert.deepEqual(skillDirs(['claude', 'codex', 'gemini', 'copilot'], 'project', '/p'), [
    { dir: '/p/.claude/skills', agents: ['claude'] },
    { dir: '/p/.agents/skills', agents: ['codex', 'gemini', 'copilot'] },
  ]);
  assert.equal(skillDirs(['gemini', 'copilot'], 'global', '/h').length, 2);
});

test('rules renderers', () => {
  assert.equal(renderRules('file', 'old', 'new'), 'new');
  assert.equal(renderRules('block', '# Mine\n', 'R'), fixture('rules-block.md'));
  assert.equal(renderRules('import', null, ''), '@AGENTS.md\n');
  assert.equal(renderRules('import', '@AGENTS.md\n\nextra\n', ''), '@AGENTS.md\n\nextra\n');
  assert.equal(forAgent('load `benchkeeper:workflow`', 'gemini'), 'load `workflow`');
  assert.equal(forAgent('load `benchkeeper:workflow`', 'claude'), 'load `benchkeeper:workflow`');
});

test('subagent renderers match the fixtures byte for byte', () => {
  for (const id of ['claude', 'codex', 'gemini', 'copilot']) {
    const { format } = agent(id).project.subagents;
    assert.equal(renderSubagent(format, sub), fixture(`subagent.${id}`), id);
  }
  assert.equal(subagentFile('copilot-agent', 'x'), 'x.agent.md');
  assert.equal(subagentFile('toml', 'x'), 'x.toml');
});

test('settings renderers: JSON, JSONC with comments, TOML', () => {
  assert.equal(renderJsonSettings('{\n  "model": "opus"\n}\n', [{ path: ['advisorModel'], value: 'opus' }]), fixture('settings.json'));
  assert.equal(renderJsonSettings('{\n  // mine\n  "theme": "dark"\n}\n', [{ path: ['trusted_folders'], append: ['/p'] }]), fixture('settings.jsonc'));
  assert.equal(setToml('[analytics]\nenabled = true\n', '', 'model_reasoning_effort', 'high'), fixture('config.toml'));
});
