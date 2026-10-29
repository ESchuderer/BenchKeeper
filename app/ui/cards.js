// The Projects view's cards: health, filter chips, header totals and the graph's words. Pure, so node tests run them.

export const label = (p) => p.name || p.path.split('/').pop();
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Health order: what needs attention first. token: the board's health color (--bk-h-*) the dot takes.
export const HEALTH = {
  missing: { text: 'Folder not found', token: 'missing' },
  modified: { text: 'Modified', token: 'modified' },
  outdated: { text: 'Outdated', token: 'outdated' },
  sync: { text: 'In sync', token: 'current' },
  unset: { text: 'Not set up', token: 'absent' },
};
// Origin's setup counts when the checkout's is older or missing: the checkout needs a pull.
export const lags = (p) => !!p.setupVersion && p.checkout !== p.setupVersion;
// card: the project's row of /api/project-cards (null until it loads); modified comes only from its item states.
export function health(p, card) {
  if (p.missing) return 'missing';
  if (!p.setupVersion) return 'unset';
  if (card?.states?.modified) return 'modified';
  const s = card?.states ?? {};
  return !p.current || lags(p) || p.changes?.length || s.outdated || s.absent || s.removed ? 'outdated' : 'sync';
}
export const attention = (p, card) => ['missing', 'modified', 'outdated'].includes(health(p, card)) || card?.findings > 0;

export const CHIPS = { attention: 'Needs attention', unset: 'No setup', missing: 'Folder not found' };
// The Show values links still send (the Dashboard's figures, older bookmarks) as chips.
const SHOWN = { changes: 'attention', behind: 'attention', 'not-set-up': 'unset', missing: 'missing' };
export const chipsOf = (params) => [SHOWN[params.get('show')], params.get('pack') && `pack:${params.get('pack')}`, params.get('agent') && `agent:${params.get('agent')}`].filter(Boolean);
// Every chip on must hold: a pack or an agent chip names one of the project's.
function matches(p, card, chip) {
  const [kind, id] = chip.split(':');
  if (kind === 'pack') return !!p.packs?.includes(id);
  if (kind === 'agent') return !!p.agents?.includes(id);
  if (kind === 'attention') return attention(p, card);
  if (kind === 'unset') return !p.missing && !p.setupVersion;
  return p.missing === true;
}

const rank = (p, cards) => Object.keys(HEALTH).indexOf(health(p, cards[p.path]));
const SORTS = {
  added: ['Order added', () => 0],
  name: ['Name', (a, b) => label(a).localeCompare(label(b))],
  health: ['Health', (a, b, cards) => rank(a, cards) - rank(b, cards)],
  last: ['Last change', (a, b) => (b.last ?? '').localeCompare(a.last ?? '')],
};
export const SORT_OPTIONS = Object.entries(SORTS).map(([value, [text]]) => ({ value, label: text }));

// The projects to show, in cards and table alike: search over name, folder and notes, then the chips, then the sort (a
// stable one, so ties and the default keep the order the projects were added in). cards: /api/project-cards by path.
export function visibleProjects(list, { query = '', sort = 'added', chips = [] } = {}, cards = {}) {
  const q = query.trim().toLowerCase();
  const rows = list.filter((p) => chips.every((c) => matches(p, cards[p.path], c)) && (!q || [label(p), p.path, p.notes ?? ''].some((t) => t.toLowerCase().includes(q))));
  const by = SORTS[sort]?.[1] ?? SORTS.added[1];
  return rows.map((p, i) => ({ p, i })).sort((a, b) => by(a.p, b.p, cards) || a.i - b.i).map(({ p }) => p);
}

// The header strip: the counts of the cards shown, and the health bar's segments.
export function totals(list, cards = {}) {
  const by = Object.fromEntries(Object.keys(HEALTH).map((h) => [h, list.filter((p) => health(p, cards[p.path]) === h).length]));
  return { projects: list.length, sync: by.sync, attention: list.filter((p) => attention(p, cards[p.path])).length, week: list.reduce((n, p) => n + (cards[p.path]?.activity?.week ?? 0), 0), by };
}

// The sparkline's text alternative.
export function sparkText(a) {
  const days = a.perDay.filter(Boolean).length;
  if (!days) return `No sessions from ${a.from} to ${a.to}`;
  const top = Math.max(...a.perDay);
  return `${plural(a.sessions, 'session')} on ${plural(days, 'day')} from ${a.from} to ${a.to}, at most ${top} a day`;
}

// The cost of the period: sessions without a cost are counted, never left blank.
export function costText(a) {
  const missing = a.uncosted ? `${plural(a.uncosted, 'session')} without a cost` : '';
  if (a.cost == null) return a.sessions ? `no cost recorded (${missing})` : 'no sessions';
  return `$${a.cost.toFixed(2)}${missing ? `, ${missing}` : ''}`;
}
