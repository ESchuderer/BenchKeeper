import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CSP, SCRIPT_HASH, boardHtml, cardSvg, changeText, keepDays, periodFacts, projectActivity, projectRows, registeredPaths, toCsv } from '../src/board.mjs';
import { HEALTH, PRIMARY, TOKENS, cssVars } from '../src/tokens.mjs';
import { repoEnv } from '../src/git.mjs';
import { MIN_SAMPLES } from '../src/insights.mjs';
import { context } from '../src/runner.mjs';
import { scanSessions } from '../src/sessions.mjs';
import { TITLE, writeSessions, writeTreeSessions } from './fixtures/sessions.mjs';
// Links resolved: the registry keeps canonical paths (macOS: /var is /private/var).
const TMP = realpathSync(tmpdir());

const row = { agent: 'claude', id: 's1', project: '/work/shop', title: TITLE, start: '2026-10-20T10:00:00.000Z', end: '2026-10-20T10:03:00.000Z', turns: 1, models: [], costUSD: 1, busyMs: 1000, tokens: 10, tier: null, skills: [], tests: null, setup: [], setupVersion: null, prs: [] };

test('a title that closes the script element stays data; the CSP hash is the hash of the one inline script', () => {
  const html = boardHtml([row], '2026-10-22T00:00:00.000Z');
  const data = html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(data).rows[0].title, TITLE);
  assert.doesNotMatch(data, /<\/script|<img/i);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  assert.equal(scripts.length, 1);
  assert.equal(`sha256-${createHash('sha256').update(scripts[0]).digest('base64')}`, SCRIPT_HASH);
  assert.ok(html.includes(`content="${CSP}"`) && CSP.includes(`'${SCRIPT_HASH}'`) && CSP.startsWith("default-src 'none'"));
});

test('registered projects and their worktrees go to the board as the Project filter\'s first choice', () => {
  const home = mkdtempSync(join(TMP, 'bk-board-'));
  const run = (argv) => (argv.join(' ') === `git -C ${home}/shop worktree list --porcelain`
    ? { code: 0, stdout: `worktree ${home}/shop\nHEAD 1\n\nworktree ${home}/wt/shop-fix\nHEAD 2\n`, stderr: '' }
    : { code: 128, stdout: '', stderr: 'not a git repository' });
  const ctx = context({ home, run });
  mkdirSync(ctx.config, { recursive: true });
  writeFileSync(join(ctx.config, 'projects.json'), JSON.stringify({ projects: [{ path: `${home}/shop` }, { path: `${home}/plain` }] }));
  assert.deepEqual(registeredPaths(ctx), [{ path: `${home}/shop`, worktrees: [`${home}/wt/shop-fix`] }, { path: `${home}/plain`, worktrees: [] }]);
  const html = boardHtml([], '2026-10-23T00:00:00Z', registeredPaths(ctx));
  assert.deepEqual(JSON.parse(html.match(/<script type="application\/json" id="data">(.*?)<\/script>/s)[1]).registered, registeredPaths(ctx));
});

test('the main folder in another spelling than the registry (Git on Windows prints C:/, a link here) is no extra worktree', () => {
  const home = mkdtempSync(join(TMP, 'bk-board-'));
  mkdirSync(join(home, 'shop'));
  symlinkSync(join(home, 'shop'), join(home, 'link'), 'junction');
  const run = () => ({ code: 0, stdout: `worktree ${home}/link\nHEAD 1\n\nworktree ${home}/wt/shop-fix\nHEAD 2\n`, stderr: '' });
  const ctx = context({ home, run });
  mkdirSync(ctx.config, { recursive: true });
  writeFileSync(join(ctx.config, 'projects.json'), JSON.stringify({ projects: [{ path: join(home, 'shop') }] }));
  assert.deepEqual(registeredPaths(ctx)[0].worktrees, [`${home}/wt/shop-fix`]);
});

test('worktrees of two repositories count as their repository, also a removed one; a folder of no repository is left for Other; the rows go to the page unchanged', () => {
  const rows = [
    { ...row, id: 'a', project: '/wt/shop/a', repo: '/src/shop' },
    { ...row, id: 'b', project: '/wt/shop/b', repo: '/src/shop' },
    // Removed before the first scan: the folder pattern <worktrees root>/<repository>/<worktree> names it.
    { ...row, id: 'c', project: '/wt/shop/gone', repo: null },
    // Cached before the repository was read: another row of the same folder has it.
    { ...row, id: 'd', project: '/wt/shop/a' },
    { ...row, id: 'e', project: '/src/blog', repo: '/src/blog' },
    { ...row, id: 'f', project: '/src/blog/.claude/worktrees/x', repo: null },
    { ...row, id: 'g', project: '/wt/blog-fix' },
    { ...row, id: 'h', project: '/home/u/notes', repo: null },
  ];
  const before = structuredClone(rows);
  const data = JSON.parse(boardHtml(rows, '2026-10-23T00:00:00Z', [{ path: '/src/blog', worktrees: ['/wt/blog-fix'] }]).match(/<script type="application\/json" id="data">(.*?)<\/script>/s)[1]);
  assert.deepEqual(Object.fromEntries(data.keys), {
    '/wt/shop/a': '/src/shop', '/wt/shop/b': '/src/shop', '/wt/shop/gone': '/src/shop',
    '/src/blog': '/src/blog', '/src/blog/.claude/worktrees/x': '/src/blog', '/wt/blog-fix': '/src/blog',
  });
  assert.deepEqual(data.rows, before);
  assert.deepEqual(rows, before);
});

test('project cards: sessions of both agents and of worktrees per day for 30 days, cost with the uncosted count, last session and tier, the change rule', () => {
  const at = (day, extra = {}) => ({ ...row, start: `2026-10-${day}T10:00:00.000Z`, end: `2026-10-${day}T10:30:00.000Z`, ...extra });
  const rows = [
    at('29', { id: 'a', tier: { first: 'quick', last: 'standard' } }),
    at('29', { id: 'b', agent: 'codex', costUSD: null, busyMs: 500, project: '/wt/shop-fix' }),
    at('23', { id: 'c', costUSD: 2 }),
    // The previous 30 days and older: only in the change.
    at('01', { id: 'd' }),
    { ...row, id: 'e', start: '2026-09-15T10:00:00.000Z', end: null },
    { ...row, id: 'f', project: '/src/blog', start: '2026-10-28T10:00:00.000Z' },
  ];
  const cards = projectActivity(rows, [{ path: '/work/shop', worktrees: ['/wt/shop-fix'] }, { path: '/src/blog', worktrees: [] }, { path: '/src/idle', worktrees: [] }], '2026-10-29T12:00:00Z');
  const shop = cards['/work/shop'];
  assert.equal(shop.perDay.length, 30);
  assert.deepEqual([shop.from, shop.to], ['2026-09-30', '2026-10-29']);
  assert.equal(shop.perDay.at(-1), 2);
  assert.equal(shop.perDay.at(-7), 1);
  assert.equal(shop.perDay.reduce((n, x) => n + x, 0), shop.sessions);
  assert.deepEqual({ sessions: shop.sessions, week: shop.week, time: shop.time, cost: shop.cost, uncosted: shop.uncosted }, { sessions: 4, week: 3, time: 3500, cost: 4, uncosted: 1 });
  assert.equal(shop.change, '+300% vs previous 30 days');
  assert.deepEqual(shop.last, { time: '2026-10-29T10:30:00.000Z', tier: 'standard' });
  // No session in the previous period: no change text, never "none".
  assert.equal(cards['/src/blog'].change, null);
  assert.deepEqual(cards['/src/idle'], { perDay: Array(30).fill(0), from: '2026-09-30', to: '2026-10-29', sessions: 0, week: 0, time: 0, cost: null, uncosted: 0, estimated: 0, change: null, last: null });
});

test('a project\'s sessions: its folder and its worktrees, not another project nor a folder of none', () => {
  const rows = [row, { ...row, id: 'w', project: '/wt/shop-fix' }, { ...row, id: 'b', project: '/src/blog' }, { ...row, id: 'x', project: '/tmp/x' }];
  const registered = [{ path: '/work/shop', worktrees: ['/wt/shop-fix'] }, { path: '/src/blog', worktrees: [] }];
  assert.deepEqual(projectRows(rows, registered, '/work/shop').map((r) => r.id), ['s1', 'w']);
  assert.deepEqual(projectRows(rows, registered, '/src/blog').map((r) => r.id), ['b']);
});

// WCAG relative luminance; a mark needs 3:1 against its surface (the dataviz palette validator's contrast check).
const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((n, c, i) => n + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test('every series color holds 3:1 and every text color 4.5:1 against its surface, in light and dark', () => {
  const css = boardHtml([], '2026-10-23T00:00:00Z').match(/<style>([\s\S]*?)<\/style>/)[1];
  const dark = css.match(/:root\[data-theme="dark"\] \{([^}]*)\}/)[1], system = css.match(/:where\(:not\(\[data-theme="light"\]\)\) \{([^}]*)\}/)[1], light = css.match(/:root \{ color-scheme: light;([^}]*)\}/)[1];
  for (const [name, block] of [['light', light], ['dark', dark], ['system dark', system]]) {
    const v = (k) => block.match(new RegExp(`--${k}: (#[0-9a-f]{6})`))[1];
    for (const k of ['s1', 's2', 's3', 's4', 's5', 's6', 'other']) assert.ok(contrast(v(k), v('surface')) >= 3, `${name} ${k} ${v(k)} on ${v('surface')}: ${contrast(v(k), v('surface')).toFixed(2)}`);
    for (const k of ['ink', 'ink-2', 'accent']) for (const on of ['surface', 'page']) assert.ok(contrast(v(k), v(on)) >= 4.5, `${name} ${k} on ${on}: ${contrast(v(k), v(on)).toFixed(2)}`);
  }
});

test('nothing moves on hover: the only transform is the open fold arrow, the only transitions are colors, shadows and bar widths', () => {
  const css = boardHtml([], '2026-10-23T00:00:00Z').match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.deepEqual(css.match(/transform: [^;]+/g), ['transform: rotate(90deg)']);
  assert.deepEqual(css.match(/transition: [^;]+/g), ['transition: border-color var(--ease), box-shadow var(--ease)', 'transition: width 250ms ease', 'transition: none !important']);
});

test('the app shares the board tokens: the primary scale holds its contrast, the health bar has a color per state, variables take the prefix', () => {
  assert.equal(PRIMARY[9], TOKENS.light.accent);
  assert.equal(PRIMARY[4], TOKENS.dark.accent);
  assert.ok(contrast('#ffffff', PRIMARY[9]) >= 4.5, 'white on the filled button');
  for (const s of ['light', 'dark']) {
    const hex = [...cssVars(s, 'bk-', true).matchAll(/--bk-h-([a-z]+): (#[0-9a-f]{6})/g)];
    assert.deepEqual(hex.map((m) => m[1]), HEALTH);
  }
  assert.match(cssVars('dark', 'bk-'), /--bk-page: #17181c;/);
});

// OKLab difference times 100, the palette validator's measure; under 15 two colors read alike with full color vision.
const oklab = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const [l, m, s] = [[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]].map((w) => Math.cbrt(w[0] * r + w[1] * g + w[2] * b));
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const deltaE = (a, b) => Math.hypot(...oklab(a).map((x, i) => x - oklab(b)[i])) * 100;

test('the health bar tells current from every other state, and missing from its neighbors, in light and dark', () => {
  for (const s of ['light', 'dark']) {
    const h = Object.fromEntries([...cssVars(s, 'bk-', true).matchAll(/--bk-h-([a-z]+): (#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
    for (const k of HEALTH.slice(1)) assert.ok(deltaE(h.current, h[k]) >= 15, `${s} current ${h.current} and ${k} ${h[k]}: ${deltaE(h.current, h[k]).toFixed(1)}`);
    for (const k of ['outdated', 'foreign']) assert.ok(deltaE(h.missing, h[k]) >= 15, `${s} missing and ${k}`);
    assert.ok(contrast(h.missing, TOKENS[s].surface) >= 3, `${s} missing on the surface`);
  }
});

test('the low-sample threshold is the insights one and goes to the page as data', () => {
  const html = boardHtml([], '2026-10-23T00:00:00Z');
  assert.equal(JSON.parse(html.match(/<script type="application\/json" id="data">(.*?)<\/script>/s)[1]).minSamples, MIN_SAMPLES);
  assert.equal(MIN_SAMPLES, 20);
});

test('no transcript text reaches the page: a marker in a prompt, a reply, a tool result and a queued prompt is not in the HTML', async () => {
  const home = mkdtempSync(join(TMP, 'bk-board-marker-'));
  const MARK = 'PLANTED-MARKER-7f3a';
  writeSessions(home);
  const common = { cwd: '/work/shop', gitBranch: 'main', version: '2.1.300', sessionId: 'm1' };
  const line = (t, o) => JSON.stringify({ ...common, timestamp: t, ...o });
  const dir = join(home, '.claude/projects', '-work-shop');
  writeFileSync(join(dir, 'm1.jsonl'), [
    line('2026-10-21T10:00:00.000Z', { type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: `please ${MARK}` } }),
    line('2026-10-21T10:00:01.000Z', { type: 'assistant', message: { id: 'a1', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: `reply ${MARK}` }, { type: 'tool_use', id: 'k1', name: 'Bash', input: { command: `echo ${MARK}` } }], usage: { input_tokens: 1, output_tokens: 1 } } }),
    line('2026-10-21T10:00:02.000Z', { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'k1', content: `out ${MARK}`, is_error: false }] } }),
    line('2026-10-21T10:00:03.000Z', { type: 'attachment', attachment: { type: 'queued_command', prompt: `later ${MARK}`, origin: { kind: 'human' }, humanTurn: true } }),
  ].join('\n') + '\n');
  const rows = await scanSessions(context({ home }));
  assert.ok(rows.some((r) => r.id === 'm1'));
  assert.ok(!JSON.stringify(rows).includes(MARK));
  assert.ok(!boardHtml(rows, '2026-10-23T00:00:00Z').includes(MARK));
});

test('a session keeps the repository found when it entered the cache, also after its worktree is removed; git is asked once per folder', async () => {
  const home = mkdtempSync(join(TMP, 'bk-board-repo-'));
  const repo = join(home, 'src/shop'), a = join(home, 'wt/shop-a'), b = join(home, 'wt/shop-b'), plain = join(home, 'notes');
  for (const d of [repo, a, b, plain]) mkdirSync(d, { recursive: true });
  const asked = [];
  const run = (argv) => {
    if (argv[0] !== 'git' || argv.slice(3).join(' ') !== 'worktree list --porcelain') return { code: 127, stdout: '', stderr: 'not installed' };
    asked.push(argv[2]);
    return argv[2] === plain ? { code: 128, stdout: '', stderr: 'not a git repository' } : { code: 0, stdout: [repo, a, b].map((w) => `worktree ${w}\nHEAD 0\n`).join('\n'), stderr: '' };
  };
  writeTreeSessions(home, [a, a, b, plain]);
  const ctx = context({ home, run });
  const repos = async () => Object.fromEntries((await scanSessions(ctx)).map((r) => [r.id, r.repo]));
  assert.deepEqual(await repos(), { w0: repo, w1: repo, w2: repo, w3: null });
  assert.deepEqual(asked.sort(), [a, b, plain].sort());
  asked.length = 0;
  await repos();
  assert.deepEqual(asked, []);
  // The worktree goes and its transcript grows, so it is read again: the row keeps its repository.
  rmSync(b, { recursive: true });
  appendFileSync(join(home, '.claude/projects', b.replaceAll('/', '-'), 'w2.jsonl'), '\n');
  assert.equal((await repos()).w2, repo);
  assert.deepEqual(asked, []);
});

test('with GIT_DIR naming another repository (the app run from a hook), sessions and registered projects keep their own repository', async () => {
  const home = mkdtempSync(join(TMP, 'bk-board-gitdir-'));
  const shop = join(home, 'shop'), fix = join(home, 'wt/shop-fix'), other = join(home, 'other');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { env: repoEnv(), stdio: 'ignore' });
  for (const d of [shop, other]) git('init', '-q', d);
  git('-C', shop, 'commit', '-q', '--allow-empty', '-m', 'x');
  git('-C', shop, 'worktree', 'add', '-q', fix);
  writeTreeSessions(home, [fix]);
  const ctx = context({ home });
  mkdirSync(ctx.config, { recursive: true });
  writeFileSync(join(ctx.config, 'projects.json'), JSON.stringify({ projects: [{ path: shop }] }));
  const saved = process.env.GIT_DIR;
  process.env.GIT_DIR = join(other, '.git');
  try {
    assert.deepEqual(registeredPaths(ctx), [{ path: shop, worktrees: [fix] }]);
    assert.equal((await scanSessions(ctx))[0].repo, shop);
  } finally { if (saved === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = saved; }
});

// Days counted back from 2026-10-28: the current 7 days are 10-22 to 10-28, the previous 7 days 10-15 to 10-21.
const span = (from, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * 864e5).toISOString().slice(0, 10));
const CUR = span('2026-10-22', 7), PREV = span('2026-10-15', 7);
const s = (agent, project, d, costUSD, o = {}) => ({ agent, project, start: `${d}T10:00:00.000Z`, busyMs: 60e3, costUSD, tokens: 100, ...o });
// The card numbers of one filter, as the page computes them: the facts of both windows, then the change line.
const cards = (rows, keep) => {
  const cur = rows.filter(keep).filter((r) => r.start >= CUR[0]), prev = rows.filter(keep).filter((r) => r.start < CUR[0] && r.start >= PREV[0]);
  const a = periodFacts(cur, CUR), b = prev.length ? periodFacts(prev, PREV) : null;
  return { facts: a, sessions: changeText(a.sessions, b?.sessions ?? null, 7), cost: changeText(a.cost, b?.cost ?? null, 7) };
};
const FILTERS = { all: () => true, 'one agent': (r) => r.agent === 'claude', 'a project': (r) => r.project === '/work/shop' };

test('the quick facts match the numbers of the period computed from the rows', () => {
  const rows = [s('claude', '/a', '2026-10-22', 1.5), s('claude', '/a', '2026-10-23', 2), s('codex', '/b', '2026-10-23', null, { tokens: 50 }), s('claude', '/b', '2026-10-25', 0.5, { busyMs: null }), s('codex', '/b', '2026-10-26', null)];
  assert.deepEqual(periodFacts(rows, CUR), {
    sessions: 5, time: 4 * 60e3, cost: 4, tokens: 450, uncosted: [['codex', 2]], agent: ['claude', 3], busiest: ['2026-10-23', 2], active: 4, streak: 2,
    atOnce: null, peak: null, waits: null, blocked: null,
  });
  // Nothing in the period: zeros, no agent or busiest day, no cost rather than $0.
  assert.deepEqual(periodFacts([], CUR), { sessions: 0, time: 0, cost: null, tokens: 0, uncosted: [], agent: null, busiest: null, active: 0, streak: 0, atOnce: null, peak: null, waits: null, blocked: null });
});

test('agents at once and limit waits: unions over sessions, back-to-back turns do not overlap, rows without the fields are left out', () => {
  const rows = [
    s('claude', '/a', '2026-10-22', 1, { active: [[0, 100], [200, 300]], limits: [[400, 500, 900], [1000, null, 1300]] }),
    // Overlaps the first session's turn and wait; one limit stopping both counts its time once.
    s('claude', '/b', '2026-10-22', 1, { active: [[50, 150], [300, 400]], limits: [[450, 600, null], [2000, null, null]] }),
    s('codex', '/b', '2026-10-22', null, { active: [[60, 90]], limits: null }),
    s('claude', '/c', '2026-10-22', 1, { active: null, limits: null }),
  ];
  const f = periodFacts(rows, CUR);
  // Agent time 430 s over 350 s of wall-clock: [0, 150], [200, 400]; three at once from 60 to 90.
  assert.deepEqual([f.atOnce, f.peak], [430 / 350, 3]);
  // [400, 600] and [1000, 1300]; the wait without an end or a reset time counts, without time.
  assert.deepEqual([f.waits, f.blocked], [4, 500e3]);
  assert.deepEqual([periodFacts([s('codex', '/b', '2026-10-22', null, { active: [], limits: null })], CUR)].map((x) => [x.atOnce, x.peak, x.waits, x.blocked]), [[null, null, null, null]]);
});

test('two agents, one with an empty previous window: All gives the merged numbers, each agent its own', () => {
  const rows = [s('claude', '/work/shop', '2026-10-22', 1), s('claude', '/work/shop', '2026-10-23', 1), s('codex', '/work/shop', '2026-10-24', null), s('claude', '/work/shop', '2026-10-16', 1)];
  const all = cards(rows, FILTERS.all), claude = cards(rows, FILTERS['one agent']), codex = cards(rows, (r) => r.agent === 'codex');
  assert.deepEqual([all.facts.sessions, all.facts.cost, all.facts.uncosted], [3, 2, [['codex', 1]]]);
  assert.equal(all.sessions, '+200% vs previous 7 days');
  assert.deepEqual([claude.facts.sessions, claude.sessions], [2, '+100% vs previous 7 days']);
  assert.deepEqual([codex.facts.sessions, codex.facts.cost, codex.sessions], [1, null, null]);
});

for (const [name, keep] of Object.entries(FILTERS)) {
  test(`change line, ${name}: an empty previous period gives no change text, not "none"`, () => {
    const c = cards([s('claude', '/work/shop', '2026-10-22', 1), s('codex', '/work/shop', '2026-10-23', 2)], keep);
    assert.deepEqual([c.sessions, c.cost], [null, null]);
  });
  test(`change line, ${name}: a previous period with data gives the change up, down or none, the same for the same data`, () => {
    const rows = [s('claude', '/work/shop', '2026-10-22', 3), s('claude', '/work/shop', '2026-10-16', 1), s('claude', '/work/shop', '2026-10-17', 1)];
    assert.deepEqual([cards(rows, keep).sessions, cards(rows, keep).cost], ['-50% vs previous 7 days', '+50% vs previous 7 days']);
    const even = [s('claude', '/work/shop', '2026-10-22', 1), s('claude', '/work/shop', '2026-10-16', 1)];
    assert.equal(cards(even, keep).sessions, 'no change vs previous 7 days');
  });
  test(`change line, ${name}: a metric unknown in the previous period gives no change text`, () => {
    const c = cards([s('claude', '/work/shop', '2026-10-22', 2), s('claude', '/work/shop', '2026-10-16', null)], keep);
    assert.deepEqual([c.sessions, c.cost], ['no change vs previous 7 days', null]);
  });
}

test('the change line: All time has none, points for a rate, a known zero before gives the new value', () => {
  assert.equal(changeText(5, 3, null), null);
  assert.equal(changeText(80, 75.4, 30, { points: true }), '+5 points vs previous 30 days');
  assert.equal(changeText(3, 0, 30), '+3 vs previous 30 days');
  assert.equal(changeText(0, 0, 30), 'no change vs previous 30 days');
  assert.equal(changeText(1000, 1001, 30), 'no change vs previous 30 days');
});

test('the CSV quotes what needs it and keeps a formula from running', () => {
  assert.equal(toCsv(['Day', 'a,b'], [['2026-10-22', 'say "hi"'], ['=1+1', null]]), 'Day,"a,b"\r\n2026-10-22,"say ""hi"""\r\n\'=1+1,\r\n');
});

test('the export card holds no project name, path or account unless names are on, and then only the project names', () => {
  const series = [{ name: 'shop', project: true, color: 's1' }, { name: 'blog <x>', project: true, color: 's2' }, { name: 'Other (3 more projects)', project: false, color: 'other' }];
  const input = { title: 'Sessions, last 30 days', sub: 'Cost per day, read 2026-10-28', facts: [['Sessions', '40'], ['Most used agent', 'Claude Code']], series, stacks: [{ d: '2026-10-27', parts: [2, 1, 0] }, { d: '2026-10-28', parts: [0, 0, 4] }], heat: [0, 1, 4, null], colors: TOKENS.dark };
  const off = cardSvg({ ...input, names: false });
  assert.match(off, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1200" height="630"/);
  assert.ok(off.includes('Project A') && off.includes('Project B') && off.includes('Other (3 more projects)'));
  assert.doesNotMatch(off, /shop|blog|\/work|\/home/);
  assert.ok(off.includes(TOKENS.dark.page) && off.includes(TOKENS.dark.s1));
  const on = cardSvg({ ...input, names: true });
  assert.ok(on.includes('>shop<') && on.includes('blog &#60;x&#62;') && !on.includes('Project A'));
});

test('the board history is cleanupPeriodDays from the user settings, 30 when it is missing or not a whole number of days', () => {
  const home = mkdtempSync(join(TMP, 'bk-board-keep-'));
  assert.equal(keepDays({ home }), 30);
  mkdirSync(join(home, '.claude'));
  for (const [text, days] of [['{"cleanupPeriodDays": 14}', 14], ['{"cleanupPeriodDays": "9"}', 30], ['{"cleanupPeriodDays": 0}', 30], ['not json', 30]]) {
    writeFileSync(join(home, '.claude/settings.json'), text);
    assert.equal(keepDays({ home }), days, text);
  }
  assert.match(boardHtml([], '2026-10-23T00:00:00Z', [], 14), /keeps transcripts for 14 days/);
});
