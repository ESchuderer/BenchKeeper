import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { MIN_SAMPLES, collectInsights, insights } from '../src/insights.mjs';
import { context } from '../src/runner.mjs';
import { writeSessions } from './fixtures/sessions.mjs';

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

test('hygiene and freshness: the doctor findings are split, each fact appears once', () => {
  const doctorFindings = [
    { level: 'warning', check: 'env', message: 'DO_NOT_TRACK is set in the environment', fix: 'unset it' },
    { level: 'error', check: 'instructions', message: 'x imports gone.md', fix: 'fix the import', file: 'CLAUDE.md', line: 2 },
    { level: 'warning', check: 'pins', message: 'skills CLI 1.8.0 is out for 7 days, the app pins 1.7.2', fix: 'a newer app release updates the pin' },
    { level: 'warning', check: 'plugin', tag: 'outdated', message: 'plugin x 1 -> 2', fix: 'benchkeeper apply' },
  ];
  const r = insights({ doctorFindings });
  assert.equal(r.findings[0].severity, 'error');
  assert.deepEqual(r.findings.map((f) => `${f.signal} ${f.fix}`).sort(), ['freshness a newer app release updates the pin', 'freshness benchkeeper apply', 'hygiene fix the import', 'hygiene unset it']);
  assert.deepEqual(r.summary, { error: 1, warning: 3, info: 0 });
  assert.deepEqual(r.findings.find((f) => f.severity === 'error').evidence, { check: 'instructions', message: 'x imports gone.md', file: 'CLAUDE.md', line: 2 });
  assert.equal(r.findings.filter((f) => f.signal === 'freshness').length, 2);
  assert.equal(new Set(ids(r)).size, 4);
  assert.deepEqual(ids(insights({ doctorFindings })), ids(r), 'the same input gives the same ids');
  assert.deepEqual(insights({ doctorFindings: [] }).findings, []);
});

test('freshness: a project skill behind the library is a finding, a current or unpinned one is not', () => {
  const skillPins = [
    { project: '/work/shop', name: 'tdd', pinned: 'abc', newest: 'def' },
    { project: '/work/shop', name: 'ok', pinned: 'abc', newest: 'abc' },
    { project: '/work/shop', name: 'own', pinned: null, newest: null },
  ];
  const r = insights({ skillPins });
  assert.equal(r.findings.length, 1);
  assert.deepEqual(r.findings[0].evidence, { project: '/work/shop', skill: 'tdd', pinned: 'abc', newest: 'def' });
  assert.equal(r.findings[0].fix, 'benchkeeper skills update tdd --project /work/shop');
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

test('collectInsights: 20 sessions in the window report the installed skill none of them used, older ones do not count', async () => {
  const { home, ctx } = machine();
  const dir = join(home, '.claude/projects/-work-p');
  mkdirSync(dir, { recursive: true });
  const line = (t, extra) => JSON.stringify({ cwd: '/work/p', sessionId: 'x', timestamp: t, ...extra });
  for (let i = 0; i < 25; i++) {
    const t = i < 20 ? `2026-10-${String(1 + i).padStart(2, '0')}T10:00:00.000Z` : '2026-05-01T10:00:00.000Z';
    writeFileSync(join(dir, `p${i}.jsonl`), `${line(t, { type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: 'hi' } })}\n${line(t, { type: 'assistant', message: { id: `m${i}`, content: [{ type: 'tool_use', id: 'k', name: 'Skill', input: { skill: 'tdd' } }] } })}\n`);
  }
  const r = await collectInsights(ctx, { agents: ['claude'], now: Date.parse('2026-10-26T00:00:00Z') });
  const f = r.findings.find((x) => x.id === 'unused-skills');
  assert.equal(r.samples.sessions, 22);
  assert.deepEqual(f.evidence.skills, [{ name: 'old-skill', scope: 'global', tokens: 108 }]);
  assert.ok(!JSON.stringify(r).includes(SECRET));
});
