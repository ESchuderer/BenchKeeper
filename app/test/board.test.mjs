import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { CSP, SCRIPT_HASH, boardHtml } from '../src/board.mjs';
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
