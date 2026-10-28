import assert from 'node:assert/strict';
import { existsSync, appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { addCase } from '../src/cases.mjs';
import { main } from '../src/cli.mjs';
import { library } from '../src/content.mjs';
import { evalPlan, runEval, triggered } from '../src/eval.mjs';
import { harnessTest } from '../src/harness.mjs';
import { apply, context, preview, runCommand } from '../src/runner.mjs';
import { globalPlan } from '../src/steps/global.mjs';
import { projectPlan } from '../src/steps/project.mjs';

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const PLUGINS = JSON.stringify([{ id: 'benchkeeper@benchkeeper', enabled: true }, { id: 'ponytail@ponytail', enabled: true }]);
const machine = (extra = () => null) => context({ home: tmp('bk-harn-'), run: (argv, o) => extra(argv, o) ?? (argv[0] === 'npm' ? { code: 1, stdout: '', stderr: '' }
  : { code: 0, stdout: argv.join(' ') === 'claude plugin list --json' ? PLUGINS : argv.includes('--json') ? '[]' : '1.0.0', stderr: '' }) });
const byName = (checks) => Object.fromEntries(checks.map((c) => [c.name.replace(/ \(.*/, ''), c]));

test('benchkeeper verify: files match the ledger, plugins enabled, nothing unexpected; each check can fail', () => {
  const ctx = machine();
  apply(preview(globalPlan({ ctx, agents: ['claude'], devcontainerCli: '1.0.0' })), ctx);
  let c = byName(harnessTest(ctx, { agents: ['claude'] }));
  assert.ok(Object.values(c).every((x) => x.ok), JSON.stringify(c));
  appendFileSync(join(ctx.home, '.claude/rules/00-global.md'), 'edited\n');
  mkdirSync(join(ctx.home, '.claude/skills/stray'), { recursive: true });
  c = byName(harnessTest(ctx, { agents: ['claude', 'gemini'] }));
  assert.match(c['installed files match the ledger'].problems[0], /00-global\.md changed since run/);
  assert.match(c['nothing unexpected installed'].problems.join(), /\.claude\/skills\/stray/);
  assert.match(c['each agent has the expected skills'].problems.join(), /Gemini CLI: skill workflow missing/);
});

test('benchkeeper verify: project community skills are in skills-lock.json', async () => {
  const ctx = machine();
  const dir = tmp('bk-harn-proj-');
  const pctx = { ...ctx, roots: [...ctx.roots, dir] };
  apply(preview(projectPlan({ ctx: pctx, dir, answers: { agents: ['claude'], env: 'host', skills: ['accessibility'] } }).changes), pctx, { scope: dir });
  const project = () => harnessTest(ctx, { agents: [], dir }).at(-1);
  assert.deepEqual(project().problems, ['accessibility not in skills-lock.json']);
  writeFileSync(join(dir, 'skills-lock.json'), JSON.stringify({ skills: { accessibility: { source: 'addyosmani/web-quality-skills' } } }));
  assert.equal(project().ok, true);
  writeFileSync(join(dir, 'skills-lock.json'), JSON.stringify({ skills: { accessibility: { source: 'someone/else' } } }));
  assert.deepEqual(project().problems, ['accessibility in skills-lock.json is not from addyosmani/web-quality-skills']);
  writeFileSync(join(dir, 'skills-lock.json'), JSON.stringify({ skills: { accessibility: { source: 'addyosmani/web-quality-skills' } } }));
  let text = '';
  const out = new Writable({ write(c2, _, done) { text += c2; done(); } });
  assert.equal(await main(['verify', dir, '--agents', 'claude'], { out, ctx }), 0, text);
  assert.match(text, /^ok    project skills are installed/m);
});

test('benchkeeper verify: a skills-lock.json that is not a lock file is a problem, not a crash', () => {
  const ctx = machine();
  const dir = tmp('bk-harn-proj-');
  const pctx = { ...ctx, roots: [...ctx.roots, dir] };
  apply(preview(projectPlan({ ctx: pctx, dir, answers: { agents: ['claude'], env: 'host', skills: ['accessibility'] } }).changes), pctx, { scope: dir });
  for (const text of ['{broken', 'null', '[]', '{"skills":"x"}', '{"skills":null}']) {
    writeFileSync(join(dir, 'skills-lock.json'), text);
    const c = harnessTest(ctx, { agents: [], dir }).at(-1);
    assert.equal(c.ok, false, text);
    assert.ok(c.problems.includes('skills-lock.json is not a valid lock file'), text);
  }
});

// A stub agent: loads the skill for prompts that mention a table or a README.
function stubAgent(calls) {
  return (argv, o) => {
    if (argv[0] === 'git') return runCommand(argv, o);
    if (argv[1] === '--version') return { code: 0, stdout: '9.9.9 (Claude Code)\n', stderr: '' };
    if (argv.includes('--help')) return { code: 0, stdout: '', stderr: '' };
    if (argv[0] !== 'claude') return null;
    const q = argv[2];
    calls.push({ q, lib: existsSync(join(o.cwd, '.claude/skills/designing-technical-uis/SKILL.md')) });
    const skill = /table|README/i.test(q) ? (/table/i.test(q) ? 'designing-technical-uis' : 'benchkeeper:workflow') : null;
    const lines = [{ type: 'system' }, skill && { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill } }] } }].filter(Boolean);
    return { code: 0, stdout: lines.map((l) => JSON.stringify(l)).join('\n'), stderr: '' };
  };
}

test('benchkeeper evals: rates per target, results stored, unchanged targets skipped, new cases rerun', async () => {
  const calls = [];
  const ctx = machine(stubAgent(calls));
  const plan = evalPlan(ctx, { model: 'sonnet' });
  assert.deepEqual(plan.map((p) => p.target).sort(), ['skill:designing-technical-uis', 'skill:maintaining-repos', 'skill:operating-benchkeeper', 'skill:workflow']);
  const res = await runEval(ctx, plan);
  const ui = res.find((r) => r.target === 'skill:designing-technical-uis');
  assert.deepEqual([ui.agentVersion, ui.model, ui.cases], ['9.9.9 (Claude Code)', 'sonnet', 12]);
  assert.equal(ui.missRate, 4 / 6);
  assert.equal(ui.falseTriggerRate, 0);
  assert.equal(res.find((r) => r.target === 'skill:workflow').missRate, 4 / 7);
  // The library skill is copied into the scratch repository for its own cases only.
  assert.equal(calls.filter((c) => c.lib).length, 12);
  assert.deepEqual(evalPlan(ctx, { model: 'sonnet' }), []);
  assert.equal(evalPlan(ctx, { model: 'sonnet', all: true }).length, 4);
  assert.equal(evalPlan(ctx, { model: 'opus' }).length, 4);
  addCase(ctx, { target: 'skill:workflow', expected: 'loads', query: 'Rename the CLI flag --out to --output.' });
  assert.deepEqual(evalPlan(ctx, { model: 'sonnet' }).map((p) => p.target), ['skill:workflow']);
  assert.equal(triggered('{"type":"x"}\nRead /h/.agents/skills/workflow/SKILL.md', 'workflow'), true);
});

test('eval asks before starting sessions and refuses in CI', async () => {
  const calls = [];
  const ctx = machine(stubAgent(calls));
  let text = '';
  const out = new Writable({ write(c, _, done) { text += c; done(); } });
  // The test itself may run in CI: set and restore the variable for each half.
  const ci = process.env.CI;
  try {
    delete process.env.CI;
    assert.equal(await main(['evals', 'run', '--target', 'skill:workflow'], { out, ctx, input: Readable.from(['n\n']) }), 1);
    assert.match(text, /Start 13 agent sessions\? \[y\/N\]/);
    process.env.CI = 'true';
    assert.equal(await main(['evals', 'run', '--yes'], { out, ctx }), 2);
  } finally { if (ci === undefined) delete process.env.CI; else process.env.CI = ci; }
  assert.equal(calls.length, 0);
});

test('evals plan lists the targets and starts no session, in CI too', async () => {
  const calls = [];
  const ctx = machine(stubAgent(calls));
  let text = '';
  const out = new Writable({ write(c, _, done) { text += c; done(); } });
  const ci = process.env.CI;
  try {
    process.env.CI = 'true';
    assert.equal(await main(['evals', 'plan', '--target', 'skill:workflow'], { out, ctx }), 0);
  } finally { if (ci === undefined) delete process.env.CI; else process.env.CI = ci; }
  assert.match(text, /skill:workflow\s+claude\s+\d+ cases/);
  assert.doesNotMatch(text, /Start \d+ agent sessions/);
  assert.equal(calls.length, 0);
  assert.equal(await main(['evals'], { out, ctx }), 2);
});
