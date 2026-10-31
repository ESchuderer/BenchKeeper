import assert from 'node:assert/strict';
import { existsSync, appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { addCase } from '../src/cases.mjs';
import { main } from '../src/cli.mjs';
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

test('benchkeeper verify: files match the ledger, plugins enabled; each check can fail; the user\'s own skills pass', () => {
  const ctx = machine();
  apply(preview(globalPlan({ ctx, agents: ['claude'], devcontainerCli: '1.0.0' })), ctx);
  let c = byName(harnessTest(ctx, { agents: ['claude'] }));
  assert.ok(Object.values(c).every((x) => x.ok), JSON.stringify(c));
  appendFileSync(join(ctx.home, '.claude/rules/00-global.md'), 'edited\n');
  mkdirSync(join(ctx.home, '.claude/skills/stray'), { recursive: true });
  c = byName(harnessTest(ctx, { agents: ['claude', 'gemini'] }));
  assert.match(c['installed files match the ledger'].problems[0], /00-global\.md changed since run/);
  assert.ok(!JSON.stringify(c).includes('stray'), 'a global skill of the user is no problem');
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
  assert.deepEqual(plan.map((p) => p.target).sort(), ['skill:designing-technical-uis', 'skill:operating-benchkeeper', 'skill:workflow']);
  const res = await runEval(ctx, plan);
  const ui = res.find((r) => r.target === 'skill:designing-technical-uis');
  assert.deepEqual([ui.agentVersion, ui.model, ui.cases], ['9.9.9 (Claude Code)', 'sonnet', 12]);
  assert.equal(ui.missRate, 4 / 6);
  assert.equal(ui.falseTriggerRate, 0);
  assert.equal(res.find((r) => r.target === 'skill:workflow').missRate, 5 / 8);
  // The library skill is copied into the scratch repository for its own cases only.
  assert.equal(calls.filter((c) => c.lib).length, 12);
  assert.deepEqual(evalPlan(ctx, { model: 'sonnet' }), []);
  // A cut-off line that does not parse is skipped, not a SyntaxError.
  appendFileSync(join(ctx.config, 'evals/results.jsonl'), '{"target":"skill:wo');
  assert.deepEqual(evalPlan(ctx, { model: 'sonnet' }), []);
  assert.equal(evalPlan(ctx, { model: 'sonnet', all: true }).length, 3);
  assert.equal(evalPlan(ctx, { model: 'opus' }).length, 3);
  addCase(ctx, { target: 'skill:workflow', expected: 'loads', query: 'Rename the CLI flag --out to --output.' });
  assert.deepEqual(evalPlan(ctx, { model: 'sonnet' }).map((p) => p.target), ['skill:workflow']);
  // The result appended after the cut-off line is read back.
  await runEval(ctx, evalPlan(ctx, { model: 'sonnet' }));
  assert.deepEqual(evalPlan(ctx, { model: 'sonnet' }), []);
});

test('triggered counts a skill call or a read of its SKILL.md, not a listed path', () => {
  const stream = (...events) => events.map((e) => JSON.stringify(e)).join('\n');
  const use = (name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
  const cmd = (command, output = '', code = 0) => ({ type: 'item.completed', item: { type: 'command_execution', command, aggregated_output: output, exit_code: code } });
  // Claude: a Glob whose result lists the path is no load.
  const listed = stream(use('Glob', { pattern: '**/*.md' }), { type: 'user', message: { content: [{ type: 'tool_result', content: 'README.md\n.claude/skills/workflow/SKILL.md' }] } });
  assert.equal(triggered(listed, 'workflow'), false);
  assert.equal(triggered(stream(use('Read', { file_path: '/tmp/bk-eval-x/.claude/skills/workflow/SKILL.md' })), 'workflow'), true);
  assert.equal(triggered(stream(use('Read', { file_path: '/tmp/bk-eval-x/.claude/skills/other/SKILL.md' })), 'workflow'), false);
  assert.equal(triggered(stream(use('Skill', { skill: 'benchkeeper:workflow' })), 'workflow'), true);
  // Codex: the command reads the file; a listing that prints the path in its output does not.
  assert.equal(triggered(stream(cmd(['bash', '-lc', 'cat .agents/skills/workflow/SKILL.md'])), 'workflow'), true);
  assert.equal(triggered(stream(cmd('bash -lc "ls -R .agents/skills"', '.agents/skills/workflow/SKILL.md')), 'workflow'), false);
  assert.equal(triggered(stream(cmd(['bash', '-lc', "sed -n '1,200p' .agents/skills/workflow/SKILL.md"])), 'workflow'), true);
  // Naming the path is no read: a listing of the file, or a read that failed.
  assert.equal(triggered(stream(cmd(['bash', '-lc', 'ls -l .agents/skills/workflow/SKILL.md'])), 'workflow'), false);
  assert.equal(triggered(stream(cmd(['bash', '-lc', 'cat .agents/skills/workflow/SKILL.md'], 'No such file or directory', 1)), 'workflow'), false);
  assert.equal(triggered('Read /h/.agents/skills/workflow/SKILL.md', 'workflow'), false);
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
    assert.match(text, /Start 14 agent sessions\? \[y\/N\]/);
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

test('evals plan stops on a user eval set that does not parse and names its path', async () => {
  const ctx = machine(stubAgent([]));
  const file = join(ctx.config, 'evals', 'skill-x.json');
  mkdirSync(join(ctx.config, 'evals'), { recursive: true });
  writeFileSync(file, '{"kind":"benchkeeper-evals", "schemaVersion":1,');
  await assert.rejects(main(['evals', 'plan', '--target', 'skill:workflow'], { ctx }), (e) => e.message.startsWith(`${file}: not JSON (`));
  let json = '';
  const code = await main(['evals', 'plan', '--target', 'skill:workflow', '--json'], { out: new Writable({ write(c, _, done) { json += c; done(); } }), err: new Writable({ write(_c, _e, done) { done(); } }), ctx });
  assert.deepEqual([code, JSON.parse(json).error.startsWith(`${file}: not JSON (`)], [2, true]);
});

test('evals plan trims the agent names', async () => {
  const ctx = machine(stubAgent([]));
  let text = '';
  const out = new Writable({ write(c, _, done) { text += c; done(); } });
  assert.equal(await main(['evals', 'plan', '--target', 'skill:workflow', '--agents', 'claude, codex'], { out, ctx }), 0);
  assert.match(text, /skill:workflow\s+claude\s+\d+ cases/);
  assert.match(text, /skill:workflow\s+codex\s+\d+ cases/);
});

test('evals plan and run refuse an agent evals cannot run, before planning', async () => {
  const calls = [];
  const ctx = machine(stubAgent(calls));
  for (const [args, named] of [[['evals', 'plan', '--agents', 'gemini'], 'gemini'], [['evals', 'run', '--agents', 'claud', '--yes'], 'claud'], [['evals', 'plan', '--agents', 'claude,'], '(empty)'], [['evals', 'plan', '--agents', 'claude, '], '(empty)']]) {
    let text = '';
    const out = new Writable({ write(c, _, done) { text += c; done(); } });
    assert.equal(await main(args, { out, ctx }), 2);
    assert.equal(text, `evals runs claude and codex only, not ${named}\n`);
    let json = '';
    const code = await main([...args, '--json'], { out: new Writable({ write(c, _, done) { json += c; done(); } }), err: new Writable({ write(_c, _e, done) { done(); } }), ctx });
    assert.deepEqual([code, JSON.parse(json).error], [2, text.trim()]);
  }
  assert.equal(calls.length, 0);
});

test('evals --json: the plan starts nothing, run needs --yes and prints the plan and its results, no case text leaks', async () => {
  const calls = [];
  const ctx = machine(stubAgent(calls));
  const secret = 'case-text-that-must-not-leak-41d7';
  addCase(ctx, { target: 'skill:workflow', expected: secret, query: `Write a README for ${secret}.` });
  const json = async (args) => {
    let text = '';
    const code = await main([...args, '--json'], { out: new Writable({ write(c, _, done) { text += c; done(); } }), err: new Writable({ write(_c, _e, done) { done(); } }), ctx });
    assert.ok(!text.includes(secret), `${args.join(' ')} leaks the case text`);
    return { code, doc: JSON.parse(text) };
  };
  const ci = process.env.CI;
  try {
    delete process.env.CI;
    const plan = await json(['evals', 'plan', '--target', 'skill:workflow']);
    assert.deepEqual([plan.code, plan.doc.command, Object.keys(plan.doc).slice(2)], [0, 'evals plan', ['plan']]);
    assert.deepEqual(plan.doc.plan.map((p) => [p.target, p.agent, p.model]), [['skill:workflow', 'claude', null]]);
    assert.ok(plan.doc.plan[0].cases.length > 1 && plan.doc.plan[0].cases.every((c) => typeof c === 'string'));
    const asked = await json(['evals', 'run', '--target', 'skill:workflow']);
    assert.deepEqual([asked.code, Object.keys(asked.doc).slice(2)], [2, ['plan', 'error']]);
    assert.match(asked.doc.error, /add --yes/);
    assert.equal(calls.length, 0);
    const ran = await json(['evals', 'run', '--target', 'skill:workflow', '--yes']);
    assert.deepEqual([ran.code, ran.doc.command, Object.keys(ran.doc).slice(2)], [0, 'evals run', ['plan', 'results']]);
    assert.equal(calls.length, plan.doc.plan[0].cases.length);
    const [r] = ran.doc.results;
    assert.deepEqual([r.target, r.agent, r.cases, typeof r.missRate], ['skill:workflow', 'claude', calls.length, 'number']);
    assert.ok(r.details.every((d) => d.id && !('expected' in d)));
    assert.deepEqual((await json(['evals', 'plan', '--target', 'skill:workflow'])).doc.plan, [], 'the run stored its result');
    process.env.CI = 'true';
    const started = calls.length;
    assert.equal((await json(['evals', 'run', '--all', '--yes'])).code, 2);
    assert.equal(calls.length, started, 'no session in CI');
  } finally { if (ci === undefined) delete process.env.CI; else process.env.CI = ci; }
});
