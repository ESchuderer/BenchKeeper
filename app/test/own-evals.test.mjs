import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { addCase, loadCases } from '../src/cases.mjs';
import { main } from '../src/cli.mjs';
import { evalPlan, runEval } from '../src/eval.mjs';
import { context, runCommand } from '../src/runner.mjs';

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const skill = (base, name, text) => { mkdirSync(join(base, '.claude/skills', name), { recursive: true }); writeFileSync(join(base, '.claude/skills', name, 'SKILL.md'), text); };

// A stub agent that loads a skill when the scratch repository holds it and the prompt names it.
function stubAgent(calls) {
  return (argv, o) => {
    if (argv[0] === 'git') return runCommand(argv, o);
    if (argv[1] === '--version') return { code: 0, stdout: '9.9.9 (Claude Code)\n', stderr: '' };
    if (argv.includes('--help')) return { code: 0, stdout: '', stderr: '' };
    if (argv[0] !== 'claude') return null;
    const name = argv[2].match(/\[(\S+)\]/)?.[1];
    const present = name && existsSync(join(o.cwd, '.claude/skills', name, 'SKILL.md'));
    calls.push({ q: argv[2], present });
    const line = present && { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: name } }] } };
    return { code: 0, stdout: line ? JSON.stringify(line) : '', stderr: '' };
  };
}
// The app's shipped cases are in every plan: the tests look at their own targets only.
const planOf = (ctx, only, o = {}) => evalPlan(ctx, { ...o, only });
const machine = (calls = []) => context({ home: tmp('bk-own-'), run: (argv, o) => stubAgent(calls)(argv, o) ?? { code: 0, stdout: '', stderr: '' } });

test('an own project skill gets cases, an eval run with its scope, and a rerun after its text changes', async () => {
  const calls = [];
  const ctx = machine(calls);
  const project = tmp('bk-own-proj-');
  skill(project, 'own-deploy', '---\nname: own-deploy\ndescription: "Deploys the service"\n---\nStep one.\n');
  const a = addCase(ctx, { target: 'skill:own-deploy', project, expected: 'loads', query: 'Ship it [own-deploy]' });
  addCase(ctx, { target: 'skill:own-deploy', project, expected: 'stays out', should: false, query: 'Explain a closure' });
  assert.match(a.target, /^skill:own-deploy@project-[0-9a-f]{8}$/);
  assert.equal(JSON.parse(readFileSync(a.path, 'utf8')).project, project);

  const plan = planOf(ctx, [a.target]);
  assert.deepEqual(plan.map((p) => [p.target, p.cases.length, p.project]), [[a.target, 2, project]]);
  const [res] = await runEval(ctx, plan);
  assert.deepEqual([res.scope, res.project, res.missRate, res.falseTriggerRate], ['project', project, 0, 0]);
  assert.equal(calls.filter((c) => c.present).length, 1);
  assert.deepEqual(planOf(ctx, [a.target]), []);

  skill(project, 'own-deploy', 'Step one and two.\n');
  assert.deepEqual(planOf(ctx, [a.target]).map((p) => p.target), [a.target]);
  // The skill name alone selects it, as does the full id.
  assert.equal(planOf(ctx, ['skill:own-deploy']).length, 1);
  assert.equal(planOf(ctx, [a.target]).length, 1);
  assert.equal(planOf(ctx, ['skill:other']).length, 0);

  // A skill that is gone has nothing to measure: it leaves the plan, and a plan made before refuses to run.
  rmSync(join(project, '.claude/skills/own-deploy'), { recursive: true });
  assert.deepEqual(planOf(ctx, [a.target]), []);
  await assert.rejects(runEval(ctx, plan), /not in .* any more/);
});

test('an own user skill is found in the home folder and keeps the user scope', async () => {
  const ctx = machine();
  skill(ctx.home, 'own-notes', 'Take notes.\n');
  const { target } = addCase(ctx, { target: 'skill:own-notes', expected: 'loads', query: 'Write it down [own-notes]' });
  assert.equal(target, 'skill:own-notes@user');
  const [res] = await runEval(ctx, planOf(ctx, [target]));
  assert.deepEqual([res.scope, res.project, res.missRate], ['user', undefined, 0]);
  skill(ctx.home, 'own-notes', 'Take better notes.\n');
  assert.equal(planOf(ctx, [target]).length, 1);
});

test('a library skill keeps its name unless the scope is named; own and library cases never mix', () => {
  const ctx = machine();
  const project = tmp('bk-own-proj-');
  skill(project, 'workflow', 'Mine.\n');
  const lib = addCase(ctx, { target: 'skill:workflow', project, expected: 'loads', query: 'q1' });
  const own = addCase(ctx, { target: 'skill:workflow', scope: 'project', project, expected: 'loads', query: 'q2' });
  assert.equal(lib.target, 'skill:workflow');
  assert.match(own.target, /^skill:workflow@project-/);
  assert.notEqual(lib.path, own.path);
  const all = loadCases(ctx);
  assert.deepEqual(all[lib.target].filter((c) => c.file === own.path), []);
  assert.deepEqual(all[own.target].map((c) => c.query), ['q2']);
  // skill:workflow selects the library target only, the full id the own one.
  assert.deepEqual(planOf(ctx, ['skill:workflow']).map((p) => p.target), ['skill:workflow']);
  assert.deepEqual(planOf(ctx, [own.target]).map((p) => p.target), [own.target]);
});

test('a scope that does not fit is an error; no scope and no own skill keeps the name', () => {
  const ctx = machine();
  const project = tmp('bk-own-proj-');
  const add = (o) => addCase(ctx, { expected: 'e', query: 'q', ...o });
  assert.throws(() => add({ target: 'skill:nope', scope: 'both' }), /scope: project or user/);
  assert.throws(() => add({ target: 'rule:global', scope: 'user' }), /only skills/);
  assert.throws(() => add({ target: 'skill:nope', scope: 'project' }), /--project/);
  assert.throws(() => add({ target: 'skill:nope', scope: 'project', project }), /no project skill nope/);
  assert.throws(() => add({ target: 'skill:nope', scope: 'user' }), /no user skill nope/);
  assert.throws(() => add({ target: 'skill:nope@user' }), /target/);
  assert.equal(add({ target: 'skill:nope', project }).target, 'skill:nope');
});

test('an eval set that names a project must name an absolute one that its target id belongs to', () => {
  const ctx = machine();
  const project = tmp('bk-own-proj-');
  skill(project, 'own-x', 'x\n');
  const { path } = addCase(ctx, { target: 'skill:own-x', project, expected: 'e', query: 'q' });
  const set = JSON.parse(readFileSync(path, 'utf8'));
  for (const bad of [{ project: undefined }, { project: 'relative/dir' }, { project: `${project}-other` }, { target: 'skill:own-x@user' }, { target: 'skill:own-x@project-zzzzzzzz' }, { target: 'skill:own-x@a/b' }]) {
    writeFileSync(path, JSON.stringify({ ...set, ...bad }));
    assert.throws(() => loadCases(ctx), /outside letters/, JSON.stringify(bad));
  }
  writeFileSync(path, JSON.stringify({ ...set, target: 'skill:own-x@user', project: undefined }));
  assert.ok(loadCases(ctx)['skill:own-x@user']);
  writeFileSync(path, JSON.stringify({ ...set, target: 'skill:library-one', project }));
  assert.throws(() => loadCases(ctx), /outside letters/);
});

test('case add --scope and eval --target take an own skill on the command line', async () => {
  const ctx = machine();
  const project = tmp('bk-own-proj-');
  skill(project, 'own-cli', 'cli\n');
  let text = '';
  const out = new Writable({ write(c, _, done) { text += c; done(); } });
  assert.equal(await main(['case', 'add', '--target', 'skill:own-cli', '--project', project, '--scope', 'project', '--expected', 'loads', '--query', 'Go [own-cli]'], { out, ctx }), 0);
  assert.match(text, /^case \S+ for skill:own-cli@project-[0-9a-f]{8} in /);
  text = '';
  // eval refuses under CI, which this test runs in.
  const ci = process.env.CI;
  delete process.env.CI;
  try { assert.equal(await main(['eval', '--target', 'skill:own-cli', '--yes'], { out, ctx }), 0); } finally { if (ci !== undefined) process.env.CI = ci; }
  assert.match(text, new RegExp(`skill:own-cli@project-[0-9a-f]{8}  claude  1 cases  \\(project ${project}\\)\\n`));
  assert.match(text, /miss 0%/);
});

test('an own skill installed as a link is hashed and copied by its text', { skip: process.platform === 'win32' }, async () => {
  const ctx = machine();
  const project = tmp('bk-own-proj-');
  const store = tmp('bk-own-store-');
  skill(store, 'own-linked', 'v1\n');
  mkdirSync(join(project, '.claude/skills'), { recursive: true });
  symlinkSync(join(store, '.claude/skills/own-linked'), join(project, '.claude/skills/own-linked'), 'dir');
  const { target } = addCase(ctx, { target: 'skill:own-linked', project, expected: 'loads', query: 'Go [own-linked]' });
  const [res] = await runEval(ctx, planOf(ctx, [target]));
  assert.equal(res.missRate, 0);
  assert.deepEqual(planOf(ctx, [target]), []);
  skill(store, 'own-linked', 'v2\n');
  assert.equal(planOf(ctx, [target]).length, 1);
});
