import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { apply, context, undo } from '../src/runner.mjs';
import { LOCAL_CLAUDE, projectPlan } from '../src/steps/project.mjs';
import { checkPlan, gate, unit, unitsOf } from '../src/units.mjs';

const TMP = realpathSync(tmpdir());
const skill = (id, files) => unit({ id, kind: 'skill', source: { type: 'library' }, agents: ['claude'], scope: 'project', files, removal: 'files' });

test('a unit names a known kind, source, scope and removal', () => {
  assert.equal(skill('skill:a', ['/p/a']).kind, 'skill');
  assert.throws(() => unit({ id: 'x', kind: 'mcp', source: { type: 'library' }, scope: 'global', removal: 'files' }), /kind must be one of/);
  assert.throws(() => unit({ id: 'x', kind: 'skill', source: { type: 'npm' }, scope: 'global', removal: 'files' }), /source must be one of/);
  assert.throws(() => unit({ id: 'x', kind: 'skill', source: { type: 'library' }, scope: 'machine', removal: 'files' }), /scope must be/);
  assert.throws(() => unit({ id: 'x', kind: 'skill', source: { type: 'library' }, scope: 'global', removal: 'rm' }), /removal must be one of/);
});

test('two units that write the same file, or one inside the other\'s folder, are refused at plan time', () => {
  const a = skill('skill:a', ['/p/.claude/skills/a']);
  const ok = [{ id: '1', installUnit: a }, { id: '2', installUnit: a }, { id: '3' }, { id: '4', installUnit: skill('skill:b', ['/p/.claude/skills/b']) }];
  assert.equal(checkPlan(ok), ok);
  assert.deepEqual(unitsOf(ok).map((u) => u.id), ['skill:a', 'skill:b']);
  assert.throws(() => checkPlan([{ id: '1', installUnit: a }, { id: '2', installUnit: skill('skill:c', ['/p/.claude/skills/a']) }]), /skill:a and skill:c both write \/p\/\.claude\/skills\/a/);
  assert.throws(() => checkPlan([{ id: '1', installUnit: a }, { id: '2', installUnit: skill('skill:d', ['/p/.claude/skills/a/SKILL.md']) }]), /skill:a and skill:d both write/);
});

test('undo of one unit restores its files and leaves the other units of the run', () => {
  const home = mkdtempSync(join(TMP, 'bk-home-'));
  const c = context({ home });
  writeFileSync(join(home, 'b.txt'), 'mine\n');
  const w = (name, u) => ({ id: name, step: 's', title: name, kind: 'write', path: join(home, name), after: `${name}\n`, installUnit: skill(u, [join(home, name)]) });
  const run = apply([w('a.txt', 'skill:a'), w('b.txt', 'skill:b')], c);
  assert.deepEqual(run.units.map((u) => u.id), ['skill:a', 'skill:b']);
  assert.deepEqual(run.entries.map((e) => e.installUnit), ['skill:a', 'skill:b']);
  const back = undo(run.id, c, { unit: 'skill:b' });
  assert.equal(back.status, 'done');
  assert.deepEqual(back.entries.map((e) => e.installUnit), ['skill:b']);
  assert.equal(readFileSync(join(home, 'b.txt'), 'utf8'), 'mine\n');
  assert.equal(readFileSync(join(home, 'a.txt'), 'utf8'), 'a.txt\n');
});

test('a project plan describes its installs as units: undo of the skill unit leaves the project block', () => {
  const dir = mkdtempSync(join(TMP, 'bk-proj-'));
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  const home = mkdtempSync(join(TMP, 'bk-home-'));
  const ctx = context({ home, roots: [home, dir], appVersion: '6.0.0' });
  const { changes } = projectPlan({ ctx, dir, answers: { agents: ['claude'], env: 'host-agent', skills: ['designing-technical-uis'] }, plugins: { claude: [], codex: [] } });
  const units = unitsOf(changes);
  assert.deepEqual(units.map((u) => [u.id, u.kind, u.source.type, u.removal]), [['rules:project', 'rules', 'library', 'block'], ['skill:designing-technical-uis', 'skill', 'library', 'files']]);
  assert.deepEqual(units[1].files, [join(dir, '.claude/skills/designing-technical-uis')]);
  const run = apply(changes, ctx);
  assert.equal(run.status, 'done');
  assert.deepEqual(run.units.map((u) => u.id), units.map((u) => u.id));
  assert.equal(undo(run.id, ctx, { unit: 'skill:designing-technical-uis' }).status, 'done');
  assert.equal(existsSync(join(dir, '.claude/skills/designing-technical-uis/SKILL.md')), false);
  assert.match(readFileSync(join(dir, LOCAL_CLAUDE), 'utf8'), /benchkeeper:project start/);
});

test('the source gate refuses a step that fetches code through npm without the signature check or the cooldown', () => {
  const remove = { title: 'remove skill x', argv: ['npx', '-y', 'skills@npm:skills@1.7.2', 'remove', 'x', '-y'] };
  assert.throws(() => gate(remove), /without the signature check and the 7-day cooldown/);
  assert.throws(() => gate({ ...remove, verify: ['node', 'verify.mjs'] }), /7-day cooldown/);
  assert.throws(() => checkPlan([{ ...remove, argv: ['npm', 'i', '-g', 'x@1.0.0'], env: { npm_config_before: '2026-01-01' } }]), /signature check/);
  const ok = { ...remove, verify: ['node', 'verify.mjs'], env: { npm_config_before: '2026-01-01' } };
  assert.equal(gate(ok), ok);
  assert.equal(gate({ title: 'plugin', argv: ['claude', 'plugin', 'install', 'x@y'] }).title, 'plugin');
});

test('the community skills of a project plan come from git through the gated skills CLI', () => {
  const dir = mkdtempSync(join(TMP, 'bk-proj-'));
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  const ctx = context({ home: mkdtempSync(join(TMP, 'bk-home-')), roots: [dir], appVersion: '6.0.0', run: () => ({ code: 1, stdout: '', stderr: 'offline' }) });
  const { changes } = projectPlan({ ctx, dir, answers: { agents: ['claude', 'codex'], env: 'host-agent', packs: ['frontend'] }, plugins: { claude: [], codex: [] } });
  const fetched = changes.filter((c) => c.argv?.[0] === 'npx');
  assert.ok(fetched.length > 0);
  for (const c of fetched) {
    assert.ok(c.verify && c.env.npm_config_before && c.env.npm_config_registry, c.title);
    assert.deepEqual([c.installUnit.kind, c.installUnit.source.type, c.installUnit.removal], ['skill', 'git', 'skills-cli']);
  }
});
