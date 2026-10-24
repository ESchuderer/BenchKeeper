import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CSP, SCRIPT_HASH, boardHtml, registeredPaths } from '../src/board.mjs';
import { context } from '../src/runner.mjs';
import { TITLE } from './fixtures/sessions.mjs';

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
  const home = mkdtempSync(join(tmpdir(), 'bk-board-'));
  const run = (argv) => (argv.join(' ') === `git -C ${home}/shop worktree list --porcelain`
    ? { code: 0, stdout: `worktree ${home}/shop\nHEAD 1\n\nworktree ${home}/wt/shop-fix\nHEAD 2\n`, stderr: '' }
    : { code: 128, stdout: '', stderr: 'not a git repository' });
  const ctx = context({ home, run });
  mkdirSync(ctx.config, { recursive: true });
  writeFileSync(join(ctx.config, 'projects.json'), JSON.stringify({ projects: [{ path: `${home}/shop` }, { path: `${home}/plain` }] }));
  assert.deepEqual(registeredPaths(ctx), [`${home}/shop`, `${home}/wt/shop-fix`, `${home}/plain`]);
  const html = boardHtml([], '2026-10-23T00:00:00Z', registeredPaths(ctx));
  assert.deepEqual(JSON.parse(html.match(/<script type="application\/json" id="data">(.*?)<\/script>/s)[1]).registered, registeredPaths(ctx));
});

// WCAG relative luminance; a mark needs 3:1 against its surface (the dataviz palette validator's contrast check).
const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((n, c, i) => n + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test('every series color holds 3:1 against its surface, in light and dark', () => {
  const css = boardHtml([], '2026-10-23T00:00:00Z').match(/<style>([\s\S]*?)<\/style>/)[1];
  const dark = css.match(/:root\[data-theme="dark"\] \{([^}]*)\}/)[1], system = css.match(/:where\(:not\(\[data-theme="light"\]\)\) \{([^}]*)\}/)[1], light = css.match(/:root \{ color-scheme: light;([^}]*)\}/)[1];
  for (const [name, block] of [['light', light], ['dark', dark], ['system dark', system]]) {
    const v = (k) => block.match(new RegExp(`--${k}: (#[0-9a-f]{6})`))[1];
    for (const k of ['s1', 's2', 's3', 's4']) assert.ok(contrast(v(k), v('surface')) >= 3, `${name} ${k} ${v(k)} on ${v('surface')}: ${contrast(v(k), v('surface')).toFixed(2)}`);
  }
});
