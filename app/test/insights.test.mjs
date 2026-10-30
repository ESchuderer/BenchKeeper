import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { MIN_SAMPLES, collectInsights, insights } from '../src/insights.mjs';
import { narrativeInput } from '../src/narrative.mjs';
import { addProject } from '../src/projects.mjs';
import { context } from '../src/runner.mjs';
import { writeFrictionSessions, writeSessions } from './fixtures/sessions.mjs';

const TMP = realpathSync(tmpdir());
const SECRET = 'marker-that-must-not-leak-4d1f';
const sessions = (n, skills = [], agent = 'claude') => Array.from({ length: n }, (_, i) => ({ agent, id: `s${i}`, skills }));
const skill = (name, tokens = 40) => ({ name, scope: 'global', tokens });
const ids = (r) => r.findings.map((f) => f.id);

test('unused skills: reported from the sample threshold, with the descriptions cost', () => {
  const state = { sessions: sessions(MIN_SAMPLES, ['tdd']), skills: [skill('tdd'), skill('old', 30), skill('older', 12)] };
  const r = insights(state);
  assert.deepEqual(ids(r), ['unused-skills']);
  const [f] = r.findings;
  assert.deepEqual(f.evidence, { sessions: MIN_SAMPLES, skills: [skill('old', 30), skill('older', 12)], descriptionTokens: 42 });
  assert.equal(f.severity, 'info');
  assert.match(f.message, /2 installed skills were not used in any of the last 20 sessions.*about 42 tokens/);
  assert.deepEqual(r.samples, { sessions: 20, minSamples: 20 });
  assert.match(insights({ sessions: sessions(MIN_SAMPLES), skills: [skill('one')] }).findings[0].message, /^1 installed skill was not used/);
});

test('unused skills: nothing below the threshold, for another agent or when every skill was used', () => {
  assert.deepEqual(insights({ sessions: sessions(MIN_SAMPLES - 1), skills: [skill('old')] }).findings, []);
  assert.deepEqual(insights({ sessions: sessions(MIN_SAMPLES, [], 'codex'), skills: [skill('old')] }).findings, []);
  assert.deepEqual(insights({ sessions: sessions(MIN_SAMPLES, ['old']), skills: [skill('old')] }).findings, []);
  assert.deepEqual(insights({ sessions: sessions(3), skills: [skill('old')] }, { minSamples: 3 }).findings.map((f) => f.id), ['unused-skills']);
});

// n sessions of one project folder; `over` sets the fields of each by index.
const project = (n, over = () => ({}), cwd = '/work/shop') => Array.from({ length: n }, (_, i) => ({ agent: i % 2 ? 'codex' : 'claude', id: `p${i}`, skills: [], project: cwd, tests: 'pass', prs: [], pattern: 'single', tier: { last: 'standard' }, title: SECRET, ...over(i) }));

test('friction: a project from the sample threshold, with the failed sessions without a pull request, counts and folder name only', () => {
  const failing = (i) => (i < 3 ? { tests: 'fail' } : i === 3 ? { tests: 'fail', prs: [{ url: 'u', state: 'merged' }] } : {});
  const r = insights({ sessions: project(MIN_SAMPLES, failing) });
  assert.deepEqual(ids(r), [r.findings[0].id]);
  const [f] = r.findings;
  assert.match(f.id, /^friction:[0-9a-f]{8}$/);
  assert.equal(f.signal, 'friction');
  assert.deepEqual(f.evidence, { project: 'shop', sessions: 20, failed: 3, rate: 15, sessionIds: ['p0', 'p1', 'p2'] });
  assert.match(f.message, /^3 of 20 sessions in shop \(15%\)/);
  const other = insights({ sessions: project(MIN_SAMPLES, failing, '/clients/acme/shop') }).findings[0];
  assert.equal(other.evidence.project, 'shop');
  assert.notEqual(other.id, f.id, 'the path decides, not the folder name');
  assert.ok(!JSON.stringify(r).includes(SECRET));
  assert.ok(!JSON.stringify(r).includes('/work'));
});

test('friction: nothing below the threshold, without a failed last run, for Orca workers and research sessions, one finding per project', () => {
  const failing = () => ({ tests: 'fail' });
  assert.deepEqual(insights({ sessions: project(MIN_SAMPLES - 1, failing) }).findings, []);
  assert.deepEqual(insights({ sessions: project(MIN_SAMPLES) }).findings, []);
  // 19 eligible sessions plus an Orca worker and a research session that would make 21.
  const mixed = [...project(MIN_SAMPLES - 1, failing), ...project(1, () => ({ tests: 'fail', pattern: 'Orca worker' })), ...project(1, () => ({ tests: 'fail', tier: { last: 'research' } }))];
  assert.deepEqual(insights({ sessions: mixed }).findings, []);
  assert.equal(insights({ sessions: [...mixed, ...project(1, failing)] }).findings[0].evidence.sessions, 20);
  const two = insights({ sessions: [...project(MIN_SAMPLES, failing), ...project(MIN_SAMPLES, failing, '/work/blog'), { id: 'x', project: null, tests: 'fail', prs: [] }] });
  assert.deepEqual(two.findings.map((f) => f.evidence.project).sort(), ['blog', 'shop']);
  // Two projects with the same folder name are two findings, each with its own sessions.
  const same = insights({ sessions: [...project(MIN_SAMPLES, failing), ...project(MIN_SAMPLES, () => ({}), '/clients/acme/shop').map((s, i) => ({ ...s, id: `q${i}`, tests: i ? 'pass' : 'fail' }))] }).findings;
  assert.deepEqual(same.map((f) => [f.evidence.project, f.evidence.failed]).sort(), [['shop', 1], ['shop', 20]]);
  assert.notEqual(same[0].id, same[1].id);
});

test('skill proposals: turn off what the project sessions did not use, add what a matched pack brings, update what is behind', () => {
  const dir = '/work/my shop';
  const p = { dir, skills: [{ name: 'used', state: 'current' }, { name: 'idle', state: 'current' }, { name: 'named', state: 'current' }, { name: 'off', state: 'disabled' }, { name: 'gone', state: 'removed' }, { name: 'old', state: 'outdated' }], keep: ['named'], add: ['a11y', 'ui'], packs: ['frontend'] };
  const inProject = sessions(MIN_SAMPLES, ['used', 'old']).map((s) => ({ ...s, dir: `${dir}/app` }));
  const r = insights({ sessions: inProject, projects: [p] });
  const by = Object.fromEntries(r.findings.map((f) => [f.id.split(':')[0], f]));
  assert.deepEqual(Object.keys(by).sort(), ['skill-add', 'skill-disable', 'skill-update']);
  assert.ok(r.findings.every((f) => f.signal === 'skills' && f.severity === 'info' && f.evidence.dir === dir));
  assert.deepEqual(by['skill-disable'].evidence.skills, [{ name: 'idle', scope: 'my shop' }]);
  assert.equal(by['skill-disable'].fix, 'benchkeeper skills disable idle --project "/work/my shop"');
  assert.match(by['skill-disable'].message, /^1 skill of my shop not used in any of its last 20 Claude Code and Codex sessions: idle$/);
  assert.equal(by['skill-add'].fix, 'benchkeeper skills add a11y ui --project "/work/my shop"');
  assert.deepEqual([by['skill-add'].evidence.action, by['skill-add'].evidence.packs], ['pick', ['frontend']]);
  assert.equal(by['skill-update'].fix, 'benchkeeper skills update old --project "/work/my shop"');
  // The narrative gets the folder name, never the path the fix needs.
  assert.ok(!JSON.stringify(narrativeInput(r, r.findings)).includes('/work'));
});

test('skill proposals: no remove below the threshold of the project sessions, sessions of another project do not count', () => {
  const p = { dir: '/work/shop', skills: [{ name: 'idle', state: 'current' }], keep: [], add: [], packs: [] };
  const elsewhere = sessions(MIN_SAMPLES).map((s) => ({ ...s, dir: '/work/shopping' }));
  assert.deepEqual(ids(insights({ sessions: elsewhere, projects: [p] })), []);
  assert.deepEqual(ids(insights({ sessions: elsewhere.slice(1).map((s) => ({ ...s, dir: '/work/shop' })), projects: [p] })), []);
});

test('skill proposals: a skill used only by a Codex session of the project is not proposed, the message counts both agents', () => {
  const p = { dir: '/work/shop', skills: [{ name: 'idle', state: 'current' }, { name: 'codexed', state: 'current' }], keep: [], add: [], packs: [] };
  const inProject = [...sessions(MIN_SAMPLES), ...sessions(1, ['codexed'], 'codex')].map((s) => ({ ...s, dir: '/work/shop' }));
  const [f] = insights({ sessions: inProject, projects: [p] }).findings;
  assert.deepEqual(f.evidence.skills, [{ name: 'idle', scope: 'shop' }]);
  assert.equal(f.evidence.sessions, 21);
  assert.match(f.message, /last 21 Claude Code and Codex sessions: idle$/);
  // Codex sessions alone do not reach the threshold.
  assert.deepEqual(ids(insights({ sessions: [...sessions(MIN_SAMPLES - 1), ...sessions(5, [], 'codex')].map((s) => ({ ...s, dir: '/work/shop' })), projects: [p] })), []);
});

test('hygiene and freshness: the doctor findings are split, each fact appears once', () => {
  const doctorFindings = [
    { level: 'warning', check: 'env', message: 'DO_NOT_TRACK is set in the environment', fix: 'unset it' },
    { level: 'error', check: 'instructions', message: 'x imports gone.md', fix: 'fix the import', file: 'CLAUDE.md', line: 2 },
    { level: 'warning', check: 'pins', message: '.benchkeeper/pins.local.json is not ignored by git', fix: 'add it to .gitignore' },
    { level: 'warning', check: 'plugin', tag: 'outdated', message: 'plugin x 1 -> 2', fix: 'benchkeeper apply' },
  ];
  const r = insights({ doctorFindings });
  assert.equal(r.findings[0].severity, 'error');
  assert.deepEqual(r.findings.map((f) => `${f.signal} ${f.fix}`).sort(), ['freshness benchkeeper apply', 'hygiene add it to .gitignore', 'hygiene fix the import', 'hygiene unset it']);
  assert.deepEqual(r.summary, { error: 1, warning: 3, info: 0 });
  assert.deepEqual(r.findings.find((f) => f.severity === 'error').evidence, { check: 'instructions', message: 'x imports gone.md', file: 'CLAUDE.md', line: 2 });
  assert.equal(r.findings.filter((f) => f.signal === 'freshness').length, 1, 'a phase pin finding is hygiene');
  assert.equal(new Set(ids(r)).size, 4);
  assert.deepEqual(ids(insights({ doctorFindings })), ids(r), 'the same input gives the same ids');
  assert.deepEqual(insights({ doctorFindings: [] }).findings, []);
});

test('findings: errors first, then every other finding by id whatever its severity', () => {
  const doctorFindings = [
    { level: 'warning', check: 'z', message: 'late warning', fix: 'f' },
    { level: 'info', check: 'a', message: 'early info', fix: 'f' },
    { level: 'error', check: 'm', message: 'error', fix: 'f' },
  ];
  const r = insights({ doctorFindings });
  assert.deepEqual(r.findings.map((f) => f.message), ['error', 'early info', 'late warning']);
});

// A fixture home with one global skill, a skills lock of a registered project and the two Claude Code sessions of the shared fixture.
function machine() {
  const home = mkdtempSync(join(TMP, 'bk-insights-'));
  writeSessions(home, { title: SECRET });
  mkdirSync(join(home, '.claude/skills/old-skill'), { recursive: true });
  writeFileSync(join(home, '.claude/skills/old-skill/SKILL.md'), `---\nname: old-skill\ndescription: "${'x'.repeat(400)}"\n---\nbody ${SECRET}\n`);
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ env: { DO_NOT_TRACK: SECRET } }));
  return { home, ctx: context({ home, run: (argv) => ({ code: ['npm', 'podman', 'docker', 'gh'].includes(argv[0]) ? 1 : 0, stdout: '', stderr: '' }) }) };
}

async function run(ctx, args) {
  let text = '', err = '';
  const out = new Writable({ write(c, _, done) { text += c; done(); } });
  const errOut = new Writable({ write(c, _, done) { err += c; done(); } });
  const code = await main(args, { out, err: errOut, ctx });
  return { code, text, err };
}

test('collectInsights reads the machine: few sessions give no unused-skills finding, the doctor findings stay', async () => {
  const { ctx } = machine();
  const r = await collectInsights(ctx, { agents: ['claude'], now: Date.parse('2026-10-26T00:00:00Z') });
  assert.equal(r.samples.sessions, 2);
  assert.ok(!ids(r).includes('unused-skills'));
  assert.ok(r.findings.some((f) => f.signal === 'hygiene' && f.evidence.check === 'env'));
});

test('insights --json: the envelope, no secret and no session title, exit 0 without an error finding', async () => {
  const { ctx } = machine();
  const r = await run(ctx, ['insights', '--agents', 'claude', '--json']);
  const doc = JSON.parse(r.text);
  assert.equal(r.code, doc.summary.error ? 1 : 0);
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.command, 'insights');
  assert.deepEqual(Object.keys(doc).slice(2), ['samples', 'findings', 'summary']);
  assert.ok(doc.findings.length > 0 && doc.findings.every((f) => f.id && f.signal && f.severity && f.message && f.evidence && f.fix));
  assert.ok(!r.text.includes(SECRET) && !r.err.includes(SECRET));
});

test('insights: an unknown argument exits 2 with an error document, plain insights asks for --json', async () => {
  const { ctx } = machine();
  const bad = await run(ctx, ['insights', 'now', '--json']);
  assert.equal(bad.code, 2);
  assert.match(JSON.parse(bad.text).error, /unexpected argument now/);
  const plain = await run(ctx, ['insights']);
  assert.equal(plain.code, 2);
  assert.match(plain.text, /works with --json/);
});

// n Claude Code sessions that used the skill tdd, the first `recent` of them inside the window of the tests.
function writeClaudeSessions(home, n, recent) {
  const dir = join(home, '.claude/projects/-work-p');
  mkdirSync(dir, { recursive: true });
  const line = (t, extra) => JSON.stringify({ cwd: '/work/p', sessionId: 'x', timestamp: t, ...extra });
  for (let i = 0; i < n; i++) {
    const t = i < recent ? `2026-10-${String(1 + i).padStart(2, '0')}T10:00:00.000Z` : '2026-05-01T10:00:00.000Z';
    writeFileSync(join(dir, `p${i}.jsonl`), `${line(t, { type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: 'hi' } })}\n${line(t, { type: 'assistant', message: { id: `m${i}`, content: [{ type: 'tool_use', id: 'k', name: 'Skill', input: { skill: 'tdd' } }] } })}\n`);
  }
}

test('collectInsights: 20 sessions in the window report the installed skill none of them used, older ones do not count', async () => {
  const { home, ctx } = machine();
  writeClaudeSessions(home, 25, 20);
  // A CRLF skill still costs tokens; another agent's skill folder is not Claude Code's.
  mkdirSync(join(home, '.claude/skills/crlf'), { recursive: true });
  writeFileSync(join(home, '.claude/skills/crlf/SKILL.md'), '---\r\nname: crlf\r\ndescription: abcd\r\n---\r\nbody\r\n');
  mkdirSync(join(home, '.gemini/skills/gem'), { recursive: true });
  writeFileSync(join(home, '.gemini/skills/gem/SKILL.md'), '---\nname: gem\ndescription: abcd\n---\n');
  const r = await collectInsights(ctx, { agents: ['claude'], now: Date.parse('2026-10-26T00:00:00Z') });
  const f = r.findings.find((x) => x.id === 'unused-skills');
  assert.equal(r.samples.sessions, 22);
  assert.deepEqual(f.evidence.skills, [{ name: 'crlf', scope: 'global', tokens: 7 }, { name: 'old-skill', scope: 'global', tokens: 108 }]);
  assert.ok(!JSON.stringify(r).includes(SECRET));
});

test('collectInsights lists friction from the transcripts: the folder name, counts and no message text', async () => {
  const { home, ctx } = machine();
  writeFrictionSessions(home, SECRET);
  const r = await collectInsights(ctx, { agents: ['claude'], now: Date.parse('2026-10-26T00:00:00Z') });
  const f = r.findings.find((x) => x.signal === 'friction');
  assert.deepEqual({ ...f.evidence, sessionIds: f.evidence.sessionIds.length }, { project: 'friction', sessions: 20, failed: 20, rate: 100, sessionIds: 20 });
  assert.ok(!JSON.stringify(r).includes(SECRET) && !JSON.stringify(r).includes('/work/friction'));
});

test('collectInsights: --project adds the skills of a plugin installed for that project', async () => {
  const { home, ctx } = machine();
  writeClaudeSessions(home, 20, 20);
  const dir = join(home, 'work', 'a');
  const root = join(home, '.claude/plugins/cache/team/proj/1.0.0');
  mkdirSync(join(root, 'skills/team-skill'), { recursive: true });
  writeFileSync(join(root, 'skills/team-skill/SKILL.md'), '---\nname: team-skill\ndescription: abcd\n---\n');
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'proj@team': [{ scope: 'project', projectPath: dir, installPath: root }] } }));
  writeFileSync(join(dir, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'proj@team': true } }));
  const names = async (opts) => (await collectInsights(ctx, { agents: ['claude'], now: Date.parse('2026-10-26T00:00:00Z'), ...opts })).findings.find((f) => f.id === 'unused-skills').evidence.skills.map((x) => x.scope);
  assert.ok((await names({ dir })).includes('plugin proj'));
  assert.ok(!(await names({})).includes('plugin proj'));
});
