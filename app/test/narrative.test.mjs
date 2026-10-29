import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { agentAnswer } from '../src/advise.mjs';
import { main } from '../src/cli.mjs';
import { collectInsights, insights } from '../src/insights.mjs';
import { narrativeInput, narrativeKey, narrativePrompt } from '../src/narrative.mjs';
import { context } from '../src/runner.mjs';
import { api } from '../src/server.mjs';
import { jobDone } from './fakes/job.mjs';

const TMP = realpathSync(tmpdir());
const SECRET = 'marker-that-must-not-leak-9c2e';
const status = async (f) => { try { await f(); } catch (e) { return e.status ?? 500; } return 200; };

// A home with the settings of one doctor finding and a fake model command: `claude -p <prompt>` answers with a cost.
function machine() {
  const home = mkdtempSync(join(TMP, 'bk-narrative-'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ env: { DO_NOT_TRACK: SECRET } }));
  const sessions = [];
  const run = (argv) => {
    if (argv[0] === 'claude' && argv[1] === '-p') { sessions.push(argv); return { code: 0, stdout: JSON.stringify({ result: `First: fix the env switch.\n`, total_cost_usd: 0.0123 }), stderr: '' }; }
    if (argv.join(' ') === 'claude --version') return { code: 0, stdout: '2.1.0 (Claude Code)', stderr: '' };
    return { code: argv[0] === 'claude' ? 0 : 1, stdout: argv[0] === 'claude' ? '[]' : '', stderr: '' };
  };
  const ctx = context({ home, run });
  return { home, ctx, sessions, routes: api(ctx) };
}

test('the input is an allowlist of finding fields: a planted marker, a full path and a transcript title never reach it', async () => {
  const home = mkdtempSync(join(TMP, 'bk-narrative-'));
  const dir = join(home, '.claude/projects/-work-friction');
  mkdirSync(dir, { recursive: true });
  const line = (t, extra) => JSON.stringify({ cwd: '/work/friction', sessionId: 'x', timestamp: t, ...extra });
  for (let i = 0; i < 20; i++) {
    const t = `2026-10-${String(1 + i).padStart(2, '0')}T10:00:00.000Z`;
    const bash = { type: 'assistant', message: { id: `m${i}`, content: [{ type: 'tool_use', id: 'k', name: 'Bash', input: { command: 'npm test' } }] } };
    const res = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'k', content: `Exit code 1 ${SECRET}`, is_error: true }] } };
    writeFileSync(join(dir, `f${i}.jsonl`), [line(t, { type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: SECRET } }), line(t, bash), line(t, res)].join('\n') + '\n');
  }
  const ctx = context({ home, run: () => ({ code: 1, stdout: '', stderr: '' }) });
  const found = await collectInsights(ctx, { agents: ['claude'], now: Date.parse('2026-10-26T00:00:00Z') });
  const friction = found.findings.find((f) => f.signal === 'friction');
  assert.ok(friction);
  // A doctor finding names files by path in its message, fix and evidence.
  const doctorFindings = [{ check: 'rules', level: 'warning', message: `rules differ in ${home}/.claude/rules/00-global.md (see "${home}/x/y.md")`, fix: `edit ${'~'}/.claude/rules/00-global.md`, dir: `${home}/.claude`, file: `${home}/.claude/rules/00-global.md`, line: 7, rule: `Bash(${SECRET} *)`, repos: 3 }];
  const mixed = { ...found, findings: [...found.findings, ...insights({ doctorFindings }).findings] };
  const input = narrativeInput(mixed, mixed.findings);
  const { prompt } = narrativePrompt(input);
  assert.ok(!prompt.includes(SECRET) && !prompt.includes(home) && !prompt.includes('/work/friction'), 'no marker, home path or project path');
  const f = input.findings.find((x) => x.signal === 'friction');
  assert.deepEqual(f.evidence, { project: 'friction', sessions: 20, failed: 20, rate: 100, sessionIds: 20 });
  assert.deepEqual(Object.keys(f), ['id', 'signal', 'severity', 'message', 'evidence', 'proposal']);
  const h = input.findings.find((x) => x.message.startsWith('rules differ'));
  assert.match(h.message, /rules differ in 00-global\.md \(see "y\.md"\)/);
  assert.deepEqual(h.evidence, { check: 'rules', repos: 3 });
  assert.equal(h.proposal, 'edit 00-global.md');
  assert.deepEqual(input.window, { days: 90 });
  assert.deepEqual(input.samples, found.samples);
});

test('a path with one separator is cut to its last segment, and the prompt carries at most 25 findings with the rest counted', () => {
  const finding = (i, message) => ({ id: `f${i}`, signal: 'doctor', severity: 'low', message, evidence: {}, fix: 'edit C:\\.bashrc' });
  const input = narrativeInput({ samples: 0 }, [finding(0, 'DO_NOT_TRACK is set in C:\\.bashrc: and in C:\\Users\\me\\x.ini')]);
  assert.equal(input.findings[0].message, 'DO_NOT_TRACK is set in .bashrc: and in x.ini');
  assert.equal(input.findings[0].proposal, 'edit .bashrc');
  const many = narrativeInput({ samples: 0 }, Array.from({ length: 100 }, (_, i) => finding(i, 'm')));
  assert.equal(many.findings.length, 25);
  assert.equal(many.omitted, 75);
  assert.equal(narrativeInput({ samples: 0 }, [finding(0, 'm')]).omitted, 0);
  assert.notEqual(narrativePrompt(many, 'a').id, narrativePrompt(many, 'b').id, 'a change past the cap changes the key and so the id');
});

test('the key follows the findings set: running counts keep it, a changed evidence set changes it', () => {
  const project = (n, failed) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, agent: 'claude', skills: [], project: '/work/shop', tests: i < failed ? 'fail' : 'pass', prs: [] }));
  const key = (sessions) => narrativeKey(insights({ sessions }).findings);
  assert.equal(key(project(20, 3)), key(project(25, 3)));
  assert.notEqual(key(project(20, 3)), key(project(20, 4)));
});

test('consent comes first; the preview equals the input the fake model command receives; the answer is cached with its cost', async () => {
  const ci = process.env.CI;
  delete process.env.CI;
  try {
    const { ctx, sessions, routes } = machine();
    const first = await routes['GET /api/insights-narrative']();
    assert.equal(first.consented, false);
    assert.deepEqual(first.advisers.map((a) => a.id), ['claude']);
    assert.ok(first.count > 0 && first.narrative === null && first.prompt.length === first.size);
    assert.equal(await status(() => routes['POST /api/insights-narrative']({ agent: 'claude', id: first.id })), 400, 'no consent, no session');
    assert.equal(sessions.length, 0);
    assert.deepEqual(routes['POST /api/insights-narrative-consent'](), { consented: true });
    if (process.platform !== 'win32') assert.equal(statSync(join(ctx.config, 'insights-narrative.json')).mode & 0o077, 0);
    assert.equal(await status(() => routes['POST /api/insights-narrative']({ agent: 'claude', id: 'stale' })), 409, 'an input that was not the one shown');
    assert.equal(await status(() => routes['POST /api/insights-narrative']({ agent: 'codex', id: first.id })), 400);
    assert.equal(sessions.length, 0);
    const { job } = await routes['POST /api/insights-narrative']({ agent: 'claude', id: first.id });
    await jobDone(routes, job);
    // The session got exactly the previewed text, in an empty folder, with no tools.
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0][2], first.prompt);
    assert.equal(sessions[0][sessions[0].indexOf('--tools') + 1], '');
    const second = await routes['GET /api/insights-narrative']();
    assert.equal(second.consented, true);
    assert.deepEqual({ ...second.narrative, at: undefined }, { agent: 'claude', text: 'First: fix the env switch.', cost: { usd: 0.0123 }, at: undefined });
    // Opening the view again starts nothing.
    await routes['GET /api/insights-narrative']();
    assert.equal(sessions.length, 1);
    // Dismissing a finding changes the set: the text is dropped and nothing re-runs by itself.
    const { findings } = await routes['GET /api/insights']();
    routes['POST /api/insights-triage']({ key: findings[0].key, action: 'dismiss' });
    const third = await routes['GET /api/insights-narrative']();
    assert.equal(third.narrative, null);
    assert.equal(sessions.length, 1);
    assert.notEqual(third.id, first.id);
    assert.ok(!existsSync(join(ctx.home, '.cache/benchkeeper/insights-narrative.json')), 'the old text is gone');
  } finally { if (ci !== undefined) process.env.CI = ci; }
});

test('insights --narrative: no run without --yes, the input goes to stderr first, a cached text prints without a session', async () => {
  const ci = process.env.CI;
  delete process.env.CI;
  try {
    const { ctx, sessions } = machine();
    const go = async (args) => {
      let text = '', err = '';
      const out = new Writable({ write(c, _, done) { text += c; done(); } }), errOut = new Writable({ write(c, _, done) { err += c; done(); } });
      return { code: await main(args, { out, err: errOut, ctx }), text, err };
    };
    const base = ['insights', '--agents', 'claude', '--json'];
    assert.equal((await go(base)).text.includes('narrative'), false, 'not without the flag');
    assert.equal((await go([...base, '--narrative'])).code, 2, 'an agent is named');
    const refused = await go([...base, '--narrative', '--agent', 'claude']);
    assert.equal(refused.code, 2);
    assert.match(JSON.parse(refused.text).error, /add --yes/);
    assert.equal(sessions.length, 0);
    const ran = await go([...base, '--narrative', '--agent', 'claude', '--yes']);
    const doc = JSON.parse(ran.text);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0][2] + '\n', ran.err, 'stderr shows what the session received');
    assert.deepEqual({ ...doc.narrative, at: undefined, covers: undefined }, { agent: 'claude', text: 'First: fix the env switch.', cost: { usd: 0.0123 }, at: undefined, covers: undefined, cached: false });
    assert.deepEqual(doc.narrative.covers, doc.findings.map((f) => f.id), 'nothing is dismissed here: all finding ids');
    const again = JSON.parse((await go([...base, '--narrative', '--agent', 'claude'])).text);
    assert.equal(again.narrative.cached, true);
    assert.equal(sessions.length, 1);
    assert.ok(!readFileSync(join(ctx.home, '.cache/benchkeeper/insights-narrative.json'), 'utf8').includes(SECRET));
  } finally { if (ci !== undefined) process.env.CI = ci; }
});

test('a Codex session records its tokens from the events; Claude Code its USD', async () => {
  const events = [{ type: 'thread.started' }, { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 20 } }, { type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 1 } }].map((e) => JSON.stringify(e)).join('\n');
  let argv;
  const ctx = { run: (a) => {
    if (a.includes('--help')) return { code: 1, stdout: '', stderr: '' };
    if (a[1] === 'mcp') return { code: 0, stdout: '[]', stderr: '' };
    argv = a;
    writeFileSync(a[a.indexOf('-o') + 1], 'ordered');
    return { code: 0, stdout: events, stderr: '' };
  } };
  assert.deepEqual(await agentAnswer(ctx, { dir: '/p', agent: 'codex', prompt: 'q', usage: true }), { text: 'ordered', cost: { tokens: 126 } });
  assert.ok(argv.includes('--json'));
  assert.deepEqual(await agentAnswer({ run: () => ({ code: 0, stdout: JSON.stringify({ result: 'x' }), stderr: '' }) }, { dir: '/p', agent: 'claude', prompt: 'q' }), { text: 'x', cost: null });
});

test('insights --narrative shares the cached text with the view, also when a finding is dismissed', async () => {
  const ci = process.env.CI;
  delete process.env.CI;
  try {
    const { ctx, sessions, routes } = machine();
    const { findings } = await routes['GET /api/insights']();
    assert.ok(findings.length > 1, 'one finding stays after a dismissal');
    routes['POST /api/insights-triage']({ key: findings[0].key, action: 'dismiss' });
    routes['POST /api/insights-narrative-consent']();
    const view = await routes['GET /api/insights-narrative']();
    const { job } = await routes['POST /api/insights-narrative']({ agent: 'claude', id: view.id });
    await jobDone(routes, job);
    let text = '';
    const out = new Writable({ write(c, _, done) { text += c; done(); } }), err = new Writable({ write(_c, _, done) { done(); } });
    await main(['insights', '--agents', 'claude', '--json', '--narrative', '--agent', 'claude'], { out, err, ctx });
    const printed = JSON.parse(text).narrative;
    assert.equal(printed.cached, true);
    assert.deepEqual(printed.covers, findings.slice(1).map((f) => f.id), 'the ids the text covers, the dismissed one left out');
    assert.equal(sessions.length, 1);
    assert.equal((await routes['GET /api/insights-narrative']()).narrative.text, 'First: fix the env switch.', 'the view keeps its text');
  } finally { if (ci !== undefined) process.env.CI = ci; }
});
