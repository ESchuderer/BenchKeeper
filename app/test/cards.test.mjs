import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HEALTH, attention, chipsOf, costText, health, label, sparkText, totals, visibleProjects } from '../ui/cards.js';

const SET = { setupVersion: '6.1', checkout: '6.1', current: true, changes: [], agents: ['claude'], packs: ['core'] };
// One project per health state, with its /api/project-cards row.
const list = [
  { ...SET, path: '/p/sync', name: 'Sync' },
  { ...SET, path: '/p/old', current: false, agents: ['codex'] },
  { ...SET, path: '/p/edited', packs: ['web'] },
  { path: '/p/gone', missing: true, setupVersion: null, packs: [], agents: [] },
  { path: '/p/fresh', setupVersion: null, packs: [], agents: [], notes: 'ask ana' },
  { ...SET, path: '/p/pull', checkout: null },
];
const week = (n) => ({ activity: { week: n } });
const cards = {
  '/p/sync': { findings: 0, states: { current: 9 }, ...week(2) },
  '/p/old': { findings: 1, states: { current: 3, outdated: 1 }, ...week(1) },
  '/p/edited': { findings: 2, states: { current: 3, modified: 1 }, ...week(0) },
  '/p/gone': { findings: null, states: null, ...week(0) },
  '/p/fresh': { findings: 0, states: null, ...week(4) },
};

test('a card has the dot of its health state: missing folder, not set up, modified, outdated (version, pull or pending item), in sync', () => {
  assert.deepEqual(list.map((p) => health(p, cards[p.path])), ['sync', 'outdated', 'modified', 'missing', 'unset', 'outdated']);
  // Before the cards row loads: no modified, the rest from the project.
  assert.equal(health(list[2], undefined), 'sync');
  assert.equal(health({ ...SET, path: '/x', changes: [{}] }, null), 'outdated');
  assert.equal(health({ ...SET, path: '/x' }, { states: { absent: 1 } }), 'outdated');
  for (const h of Object.values(HEALTH)) assert.match(`var(--bk-h-${h.token})`, /^var\(--bk-h-(current|modified|outdated|missing|absent)\)$/);
  // A doctor finding alone needs attention.
  assert.equal(attention(list[0], { findings: 1 }), true);
  assert.equal(attention(list[0], cards['/p/sync']), false);
});

test('the header totals are the counts of the cards shown', () => {
  const t = totals(list, cards);
  assert.deepEqual(t, { projects: 6, sync: 1, attention: 4, week: 7, by: { missing: 1, modified: 1, outdated: 2, sync: 1, unset: 1 } });
  assert.equal(Object.values(t.by).reduce((n, x) => n + x, 0), t.projects);
  const shown = visibleProjects(list, { chips: ['attention'] }, cards);
  assert.equal(totals(shown, cards).projects, shown.length);
  assert.equal(totals(shown, cards).attention, shown.length);
  assert.deepEqual(totals([], {}), { projects: 0, sync: 0, attention: 0, week: 0, by: { missing: 0, modified: 0, outdated: 0, sync: 0, unset: 0 } });
});

test('chips and search narrow the projects, every chip must hold; the sort is stable', () => {
  const paths = (o) => visibleProjects(list, o, cards).map((p) => p.path);
  assert.deepEqual(paths({}), list.map((p) => p.path));
  assert.deepEqual(paths({ chips: ['attention'] }), ['/p/old', '/p/edited', '/p/gone', '/p/pull']);
  assert.deepEqual(paths({ chips: ['unset'] }), ['/p/fresh']);
  assert.deepEqual(paths({ chips: ['missing'] }), ['/p/gone']);
  assert.deepEqual(paths({ chips: ['pack:web'] }), ['/p/edited']);
  assert.deepEqual(paths({ chips: ['agent:codex'] }), ['/p/old']);
  assert.deepEqual(paths({ chips: ['attention', 'pack:core'] }), ['/p/old', '/p/pull']);
  // Search covers the name, the folder and the notes.
  assert.deepEqual(paths({ query: ' ANA ' }), ['/p/fresh']);
  assert.deepEqual(paths({ query: 'sync' }), ['/p/sync']);
  assert.deepEqual(paths({ query: 'zzz' }), []);
  assert.deepEqual(paths({ sort: 'health' }), ['/p/gone', '/p/edited', '/p/old', '/p/pull', '/p/sync', '/p/fresh']);
  assert.deepEqual(paths({ sort: 'name' }).slice(0, 2), ['/p/edited', '/p/fresh']);
  assert.deepEqual(paths({ sort: 'last' }), list.map((p) => p.path));
  assert.equal(label(list[0]), 'Sync');
});

test('links that name a Show value, a pack or an agent turn on the matching chips', () => {
  assert.deepEqual(chipsOf(new URLSearchParams('show=changes&pack=web&agent=codex')), ['attention', 'pack:web', 'agent:codex']);
  assert.deepEqual(chipsOf(new URLSearchParams('show=not-set-up')), ['unset']);
  assert.deepEqual(chipsOf(new URLSearchParams('show=all')), []);
});

test('the graph has a text alternative; the cost counts the sessions without one', () => {
  const a = { perDay: [0, 2, 0, 1], from: '2026-10-26', to: '2026-10-29', sessions: 3, cost: 1.5, uncosted: 1 };
  assert.equal(sparkText(a), '3 sessions on 2 days from 2026-10-26 to 2026-10-29, at most 2 a day');
  assert.equal(sparkText({ ...a, perDay: [0, 0, 0, 0], sessions: 0 }), 'No sessions from 2026-10-26 to 2026-10-29');
  assert.equal(costText(a), '$1.50, 1 session without a cost');
  assert.equal(costText({ ...a, uncosted: 0 }), '$1.50');
  assert.equal(costText({ ...a, estimated: 2 }), '$1.50, 2 sessions estimated, 1 session without a cost');
  assert.equal(costText({ ...a, cost: null, uncosted: 3 }), 'no cost recorded (3 sessions without a cost)');
  assert.equal(costText({ ...a, cost: null, sessions: 0, uncosted: 0 }), 'no sessions');
});
