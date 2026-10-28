import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CSP, SCRIPT_HASH, boardHtml, registeredPaths } from '../src/board.mjs';
import { HEALTH, PRIMARY, TOKENS, cssVars } from '../src/tokens.mjs';
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
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
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
  // The fixture's pull request link must not reach the host's gh.
  const run = () => ({ code: 127, stdout: '', stderr: 'not installed' });
  const rows = await scanSessions(context({ home, run }));
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
