// The sessions board: one self-contained page. Rows go in as JSON data; one constant script draws the page, writes
// every transcript value through textContent, and builds the charts as plain SVG and CSS bars. Its hash is the page's script-src.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readText, writeAtomic } from './fsx.mjs';
import { repoEnv } from './git.mjs';
import { MIN_SAMPLES } from './insights.mjs';
import { canon, listProjects } from './projects.mjs';
import { byRun, CODEX_PRICES } from './sessions.mjs';
import { TOKENS, cssVars } from './tokens.mjs';

// The pure parts of the page script: their source goes into it as draw()'s argument, so the unit tests run the same code.
// The quick facts of one period: span is its days (ISO dates, oldest first), list its sessions.
export function periodFacts(list, span) {
  const day = (r) => r.start.slice(0, 10);
  const sum = (f) => list.reduce((n, r) => n + (f(r) ?? 0), 0);
  const ranked = (rs, f) => { const m = new Map(); for (const r of rs) m.set(f(r), (m.get(f(r)) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)); };
  const seen = new Set(list.map(day));
  let run = 0, streak = 0;
  for (const d of span) { run = seen.has(d) ? run + 1 : 0; streak = Math.max(streak, run); }
  const costed = list.filter((r) => r.costUSD != null);
  // Wall-clock seconds covered by any of the [start, end] spans, and the most at one time. At the same second an end
  // goes first, so back-to-back spans do not overlap.
  const sweep = (spans) => {
    let n = 0, peak = 0, wall = 0, from = 0;
    const edges = spans.flatMap(([a, b]) => (b > a ? [[a, 1], [b, -1]] : [])).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    for (const [t, step] of edges) { if (n) wall += t - from; n += step; from = t; peak = Math.max(peak, n); }
    return { wall, peak };
  };
  // Null when no session of the period recorded them (cached before they were read, a Codex session for limits).
  const turns = list.filter((r) => r.active).flatMap((r) => r.active), on = sweep(turns);
  const limited = list.filter((r) => r.limits);
  // An unresumed wait lasts until its reset time, or counts no time without one.
  const waits = sweep(limited.flatMap((r) => r.limits).map(([hit, back, reset]) => [hit, back ?? reset ?? hit]));
  return {
    sessions: list.length, time: sum((r) => r.busyMs), cost: costed.length ? sum((r) => r.costUSD) : null, tokens: sum((r) => r.tokens),
    uncosted: ranked(list.filter((r) => r.costUSD == null), (r) => r.agent), agent: ranked(list, (r) => r.agent)[0] ?? null,
    busiest: ranked(list, day)[0] ?? null, active: span.filter((d) => seen.has(d)).length, streak,
    atOnce: on.wall ? turns.reduce((n, [a, b]) => n + b - a, 0) / on.wall : null, peak: on.wall ? on.peak : null,
    waits: limited.length ? limited.reduce((n, r) => n + r.limits.length, 0) : null, blocked: limited.length ? waits.wall * 1000 : null,
  };
}

// The change line of a card: none for All time, an unknown value or an empty previous period (prev null), else the
// difference in percent (or points), or from zero the new value itself.
export function changeText(cur, prev, len, { fmt = String, points = false } = {}) {
  if (!len || cur == null || prev == null) return null;
  const tail = ` vs previous ${len} days`;
  const d = points ? Math.round(cur - prev) : prev ? Math.round(((cur - prev) / prev) * 100) : null;
  if (cur === prev || d === 0) return `no change${tail}`;
  if (d == null) return `+${fmt(cur)}${tail}`;
  return `${d > 0 ? '+' : '-'}${Math.abs(d)}${points ? ' points' : '%'}${tail}`;
}

// RFC 4180; a cell a spreadsheet would run as a formula starts with a quote.
export function toCsv(head, body) {
  const cell = (v) => { const s = String(v ?? '').replace(/^[=+@\t\r]/, "'$&"); return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  return `${[head, ...body].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

// The export card, 1200 x 630 SVG source in the colors of one scheme. A project series is "Project A", "Project B" and so
// on unless names is on; nothing else of a session (path, account, prompt) is an input.
export function cardSvg({ title, sub, facts, series, stacks, heat, names, colors: C }) {
  const x = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  let n = 0;
  const label = series.map((s) => (s.project && !names ? `Project ${String.fromCharCode(65 + n++)}` : s.name));
  const text = (px, py, size, fill, s, more = '') => `<text x="${px}" y="${py}" font-size="${size}" fill="${fill}"${more}>${x(s)}</text>`;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">`,
    `<rect width="1200" height="630" fill="${C.page}"/>`, text(48, 62, 30, C.ink, title, ' font-weight="600"'), text(1152, 62, 16, C['ink-2'], sub, ' text-anchor="end"')];
  facts.forEach(([l, v], i) => {
    const bx = 48 + (i % 4) * 280, by = 88 + Math.floor(i / 4) * 104;
    out.push(`<rect x="${bx}" y="${by}" width="264" height="92" rx="14" fill="${C.surface}" stroke="${C.line}"/>`, text(bx + 18, by + 30, 15, C['ink-2'], l), text(bx + 18, by + 72, 30, C.ink, v, ' font-weight="600"'));
  });
  out.push(`<rect x="48" y="304" width="728" height="294" rx="14" fill="${C.surface}" stroke="${C.line}"/>`, text(68, 334, 16, C['ink-2'], 'Per day'),
    `<rect x="800" y="304" width="352" height="294" rx="14" fill="${C.surface}" stroke="${C.line}"/>`, text(820, 334, 16, C['ink-2'], 'Last 12 weeks'));
  const peak = Math.max(...stacks.map((s) => s.parts.reduce((a, b) => a + b, 0)), 1e-9), step = 688 / Math.max(stacks.length, 1), bw = Math.max(1, Math.min(18, step - 2));
  stacks.forEach((s, i) => {
    let base = 0;
    s.parts.forEach((v, k) => {
      if (!v) return;
      const h = (v / peak) * 170;
      out.push(`<rect x="${(68 + i * step + (step - bw) / 2).toFixed(1)}" y="${(526 - base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" fill="${C[series[k].color]}"/>`);
      base += h;
    });
  });
  out.push(`<line x1="68" x2="756" y1="526" y2="526" stroke="${C.grid}"/>`);
  // The legend wraps to a second line; text width is estimated at 8px a character.
  let lx = 68, ly = 548;
  series.forEach((s, k) => {
    const w = 34 + label[k].length * 8;
    if (lx > 68 && lx + w > 756) { lx = 68; ly += 24; }
    out.push(`<rect x="${lx}" y="${ly}" width="12" height="12" rx="3" fill="${C[s.color]}"/>`, text(lx + 18, ly + 11, 14, C.ink, label[k]));
    lx += w;
  });
  heat.forEach((v, i) => { if (v != null) out.push(`<rect x="${820 + Math.floor(i / 7) * 26}" y="${352 + (i % 7) * 26}" width="22" height="22" rx="5" fill="${v ? C.accent : C.grid}" fill-opacity="${[1, 0.3, 0.5, 0.75, 1][v]}"/>`); });
  return `${out.join('')}</svg>`;
}

// Runs in the browser only: toString() of this function is the page script. The UI tests cover it, not the unit coverage.
/* node:coverage disable */
function draw({ periodFacts, changeText, toCsv, cardSvg }) {
  const D = JSON.parse(document.getElementById('data').textContent);
  const rows = D.rows, now = Date.parse(D.now), MIN = D.minSamples;
  const NS = 'http://www.w3.org/2000/svg';
  const SERIES = 6;
  const el = (tag, attrs, ...kids) => {
    const n = tag.startsWith('svg:') ? document.createElementNS(NS, tag.slice(4)) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs ?? {})) if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
    for (const k of kids.flat()) if (k != null) n.append(k instanceof Node ? k : String(k));
    return n;
  };
  const $ = (id) => document.getElementById(id);
  const patternKey = (r) => r.pattern ?? 'not recorded';
  const setupKey = (r) => (!r.setup ? 'not recorded' : r.setup.length ? r.setup.join(' + ') : 'none');
  // A session counts as the repository the app resolved for its folder (boardHtml), else under Other.
  const keys = new Map(D.keys);
  const under = (dir, p) => p === dir || p.startsWith(`${dir}/`) || p.startsWith(`${dir}\\`);
  const owners = new Map();
  const owner = (p) => {
    if (!owners.has(p)) owners.set(p, (p && D.registered.find((x) => [x.path, ...x.worktrees].some((d) => under(d, p)))?.path) || null);
    return owners.get(p);
  };
  const projectKey = (r) => keys.get(r.project) ?? 'Other';
  const listed = (r) => owner(projectKey(r)) != null;
  const short = (p) => p.split(/[\\/]/).slice(-2).join('/');
  // A project by its folder name; two of the same name each add their parent folder.
  const folder = (p) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  const names = new Map();
  for (const k of new Set(rows.map(projectKey))) names.set(folder(k), (names.get(folder(k)) ?? 0) + 1);
  const name = (k) => (k === 'Other' ? k : names.get(folder(k)) > 1 ? short(k) : folder(k));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  // Its sessions and the worktrees (folders other than the repository's own) they ran in.
  const counts = (k, rs) => { const w = new Set(rs.map((r) => r.project).filter((p) => p && p !== k)).size; return `${plural(rs.length, 'session')}${w ? `, ${plural(w, k === 'Other' ? 'folder' : 'worktree')}` : ''}`; };
  const day = (iso) => iso.slice(0, 10);
  const oldest = rows.reduce((a, r) => (!a || day(r.start) < a ? day(r.start) : a), '');
  const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
  const pct = (part, all) => (all ? `${Math.round((part / all) * 100)}%` : '-');
  const usd = (x) => (x == null ? 'not recorded' : `$${x < 10 ? x.toFixed(2) : Math.round(x).toLocaleString('en')}`);
  const money = (x) => (x == null ? 'not recorded' : `$${x.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const dur = (ms) => { if (ms == null) return 'not recorded'; const m = Math.round(ms / 60e3); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };
  const compact = (x) => (x >= 1e9 ? `${+(x / 1e9).toFixed(1)}B` : x >= 1e6 ? `${+(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${+(x / 1e3).toFixed(1)}K` : String(+x.toFixed(x < 10 ? 1 : 0)));
  const sum = (xs) => xs.reduce((n, x) => n + (x ?? 0), 0);
  const group = (list, key) => { const by = new Map(); for (const r of list) { const k = key(r); if (k == null) continue; const g = by.get(k); if (g) g.push(r); else by.set(k, [r]); } return by; };
  const passRate = (rs) => { const t = rs.filter((r) => r.tests); return { v: t.length ? (t.filter((r) => r.tests === 'pass').length / t.length) * 100 : null, n: t.length }; };
  const medianOf = (f) => (rs) => { const xs = rs.map(f).filter((x) => x != null); return { v: median(xs), n: xs.length }; };

  // Theme: the query (the app passes its own), else the stored choice, else the system's.
  let stored = null;
  try { stored = localStorage.getItem('bk-board-theme'); } catch { /* storage blocked */ }
  const asked = new URLSearchParams(location.search).get('theme');
  const theme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
  theme(['light', 'dark'].includes(asked) ? asked : stored);
  let report = () => {};
  // In the app's frame its heading, intro and theme button are the app's: the app sends the theme and takes the height.
  if (parent !== window) {
    document.documentElement.classList.add('framed');
    // The project choice is a chip at the head of the filter line, so the quick facts come right after it.
    $('filters').prepend($('rail'));
    report = () => parent.postMessage({ bkBoardHeight: Math.ceil(Math.max(document.body.getBoundingClientRect().height, $('rail').classList.contains('open') ? $('rail-panel').getBoundingClientRect().bottom + scrollY : 0)) }, location.origin);
    addEventListener('message', (e) => { if (e.source === parent && e.origin === location.origin && ['light', 'dark'].includes(e.data?.bkTheme)) theme(e.data.bkTheme); });
    new ResizeObserver(report).observe(document.body);
  }
  $('theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    theme(next);
    try { localStorage.setItem('bk-board-theme', next); } catch { /* storage blocked */ }
  });

  // Filters: one row of selects, each with the values present in the data.
  const FILTERS = [
    ['project', 'Project', projectKey],
    ['agent', 'Agent', (r) => r.agent],
    ['tier', 'Tier', (r) => r.tier?.last ?? 'none'],
    ['pattern', 'Pattern', patternKey],
    ['setup', 'Setup', setupKey],
  ];
  // reg: Registered only, remembered like the theme; it leaves out every session outside a registered project.
  let reg = false;
  try { reg = localStorage.getItem('bk-board-registered') === 'true'; } catch { /* storage blocked */ }
  const state = { period: '30', q: '', project: '', folder: '', rq: '', open: new Set(), older: false, reg: reg && D.registered.length > 0, hidden: new Set(), stack: 'project' };
  const pool = () => (state.reg ? rows.filter(listed) : rows);
  // The last project chosen, remembered like the theme; one no longer in the data falls back to All.
  try {
    const [p, f] = JSON.parse(localStorage.getItem('bk-board-project')) ?? [];
    if (pool().some((r) => projectKey(r) === p && (!f || r.project === f))) { Object.assign(state, { project: p, folder: f ?? '' }); if (f) state.open.add(p); }
  } catch { /* storage blocked */ }
  const options = (f) => {
    const values = [...new Set(rows.map(f))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return [el('option', { value: '' }, 'All'), ...values.map((v) => el('option', { value: v }, v))];
  };
  const bar = $('filters');
  // The project is chosen on the rail, the only list of projects.
  for (const [key, label, f] of FILTERS.slice(1)) {
    const s = el('select', { id: `f-${key}` }, options(f));
    s.value = state[key] ?? '';
    s.addEventListener('change', () => { state[key] = s.value; render(); });
    bar.append(el('span', { class: 'f' }, el('label', { for: `f-${key}` }, label), s));
  }
  const period = el('select', { id: 'f-period' }, [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['all', 'All time']].map(([v, t]) => el('option', { value: v, selected: v === state.period }, t)));
  period.addEventListener('change', () => { state.period = period.value; render(); });
  bar.append(el('span', { class: 'f' }, el('label', { for: 'f-period' }, 'Period'), period));
  const none = !D.registered.length;
  const regBox = el('input', { type: 'checkbox', id: 'f-reg', checked: state.reg, disabled: none, 'aria-describedby': none ? 'f-reg-hint' : null });
  regBox.addEventListener('change', () => {
    state.reg = regBox.checked;
    try { localStorage.setItem('bk-board-registered', String(state.reg)); } catch { /* storage blocked */ }
    if (state.reg && state.project && owner(state.project) == null) state.project = state.folder = '';
    render();
  });
  bar.append(el('span', { class: 'f' }, regBox, el('label', { for: 'f-reg' }, 'Registered only'), none ? el('span', { class: 'muted', id: 'f-reg-hint' }, 'No project is registered in the app.') : null));
  const metric = $('metric');
  metric.addEventListener('change', () => render());
  $('search').addEventListener('input', (e) => { state.q = e.target.value.toLowerCase(); renderTable(current); });

  const table = (caption, head, body) => el('table', {}, el('caption', {}, caption), el('thead', {}, el('tr', {}, head.map((h) => el('th', { scope: 'col' }, h)))),
    el('tbody', {}, body.map((cells) => el('tr', {}, cells.map((c, i) => (i === 0 ? el('th', { scope: 'row' }, c) : el('td', {}, c)))))));
  // A file the page makes itself, saved through a blob link: nothing leaves the machine.
  const save = (file, blob) => { const a = el('a', { href: URL.createObjectURL(blob), download: file }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  // A chart's text alternative: its table for screen readers, and the same rows as a CSV file.
  const alt = (file, caption, head, body) => {
    const b = el('button', { type: 'button', class: 'csv', 'aria-label': `Download data (CSV): ${caption}` }, 'Download data (CSV)');
    b.addEventListener('click', () => save(`${file}.csv`, new Blob([toCsv(head, body)], { type: 'text/csv' })));
    return [el('div', { class: 'sr' }, table(caption, head, body)), b];
  };
  const DAY = 864e5;
  const dayStart = (t) => Date.parse(day(new Date(t).toISOString()));
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const days = (list) => {
    const first = state.period === 'all' ? (list.length ? Date.parse(day(list.at(-1).start)) : now) : now - (Number(state.period) - 1) * DAY;
    const out = [];
    for (let t = dayStart(first); t <= now; t += DAY) out.push(iso(t));
    return out;
  };

  // Rank over every session once: a project keeps its slot and color while the filters change; the rest fold into Other.
  const ranked = new Map();
  for (const r of rows) ranked.set(projectKey(r), (ranked.get(projectKey(r)) ?? 0) + 1);
  ranked.delete('Other');
  const TOP = [...ranked].sort((a, b) => b[1] - a[1]).slice(0, SERIES).map(([k]) => k);
  // The filtered list names its SERIES busiest projects; a named project outside the top ones takes a color no named top one uses.
  let named = TOP, extra = new Map();
  const slot = (r) => (named.includes(projectKey(r)) ? projectKey(r) : 'Other');
  const color = (k) => (k === 'Other' || (!TOP.includes(k) && !extra.has(k)) ? 'var(--other)' : `var(--s${(TOP.includes(k) ? TOP.indexOf(k) : extra.get(k)) + 1})`);
  const assign = (list) => {
    const n = new Map();
    for (const r of list) if (projectKey(r) !== 'Other') n.set(projectKey(r), (n.get(projectKey(r)) ?? 0) + 1);
    const distinct = [...n.keys()];
    named = [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, SERIES).map(([k]) => k);
    const free = [...Array(SERIES).keys()].filter((i) => !named.includes(TOP[i]));
    extra = new Map(named.filter((k) => !TOP.includes(k)).map((k) => [k, free.shift()]));
    return distinct;
  };

  let gid = 0;
  // Values over time as a line with a tinted area under it; a null value leaves a gap in the data, not in the axis.
  function sparkline(values, w = 120, h = 28) {
    const max = Math.max(...values.map((v) => v ?? 0), 1e-9), id = `g${gid++}`;
    const pts = values.map((v, i) => (v == null ? null : [values.length > 1 ? (i / (values.length - 1)) * (w - 8) + 4 : w / 2, h - 4 - (v / max) * (h - 8)])).filter(Boolean);
    const last = pts.at(-1);
    return el('svg:svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true', class: 'spark' },
      el('svg:defs', {}, el('svg:linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, el('svg:stop', { offset: '0%', 'stop-color': 'var(--s1)', 'stop-opacity': 0.35 }), el('svg:stop', { offset: '100%', 'stop-color': 'var(--s1)', 'stop-opacity': 0 }))),
      pts.length > 1 && el('svg:polygon', { points: `${pts[0][0]},${h} ${pts.map((p) => p.join(',')).join(' ')} ${last[0]},${h}`, fill: `url(#${id})` }),
      el('svg:polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: 'var(--s1)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
      last && el('svg:circle', { cx: last[0], cy: last[1], r: 3.5, fill: 'var(--s1)', stroke: 'var(--surface)', 'stroke-width': 2 }));
  }

  const AGENTS = { claude: 'Claude Code', codex: 'Codex' };
  const agentName = (a) => AGENTS[a] ?? a;
  // The quick facts as [label, value, change line, note], for the page and the export card. prev is null for All time and
  // when the filters leave the previous period empty: then no card has a change line.
  let facts = [];
  function tiles(list, prev, span, prevSpan) {
    const len = state.period === 'all' ? null : Number(state.period);
    const cur = periodFacts(list, span), old = prev?.length ? periodFacts(prev, prevSpan) : null;
    const delta = (k, fmt) => changeText(cur[k], old?.[k] ?? null, len, { fmt });
    const missing = cur.uncosted.map(([a, n]) => `${plural(n, `${agentName(a)} session`)} without a cost`).join(', ');
    const estimated = list.some((r) => r.costEstimated) ? `; Codex estimated at OpenAI API prices of ${D.priceDate}, priced models only` : '';
    facts = [
      ['Sessions', String(cur.sessions), delta('sessions')],
      ['Agent time', dur(cur.time), delta('time', dur), 'API and tool time'],
      ['Cost', usd(cur.cost), delta('cost', usd), `API-equivalent${estimated}${missing ? `; ${missing}` : ''}`],
      ['Tokens', compact(cur.tokens), delta('tokens', compact), 'input, cache and output'],
      ['Agents at once', cur.atOnce == null ? 'not recorded' : cur.atOnce.toFixed(1), delta('atOnce', (x) => x.toFixed(1)), cur.atOnce == null ? null : `on average while any turn ran, peak ${cur.peak}`],
      ['Busiest day', cur.busiest?.[0] ?? '-', cur.busiest && plural(cur.busiest[1], 'session')],
      ['Active days', String(cur.active), delta('active'), `of ${plural(span.length, 'day')}`],
      ['Blocked by limits', dur(cur.blocked), delta('blocked', dur), cur.waits == null ? null : `${plural(cur.waits, 'usage limit wait')} across sessions, Claude Code only`],
    ];
    // Under the quick facts, smaller: the most used agent, the longest streak and test runs, with the same change rule.
    const stats = (l) => l && { pass: passRate(l).v };
    const is = stats(list), was = stats(old && prev);
    const more = [
      ['Most used agent', cur.agent ? agentName(cur.agent[0]) : '-', cur.agent && `${cur.agent[1]} of ${plural(cur.sessions, 'session')}`],
      ['Longest streak', plural(cur.streak, 'day'), delta('streak')],
      ['Tests passed', is.pass == null ? '-' : `${Math.round(is.pass)}%`, changeText(is.pass, was?.pass ?? null, len, { points: true }), `of ${plural(list.filter((r) => r.tests).length, 'session')} with a test run`],
    ];
    const tile = ([label, value, line, note]) => el('div', { class: 'tile' }, el('div', { class: 'label' }, label), el('div', { class: 'value num' }, value),
      line && el('div', { class: 'delta num' }, line), note && el('div', { class: 'note' }, note));
    $('tiles').replaceChildren(el('div', { class: 'facts' }, facts.map(tile)), el('div', { class: 'facts small' }, more.map(tile)));
  }

  // The project rail: registered repositories, All, then the other repositories, each newest first. A repository with
  // sessions in more than one folder expands to them; one without a session in 30 days sits under Show older. Other, the
  // folders of no known repository, comes last.
  // Framed or narrow, the rail is one button with the choice that opens the same list.
  const narrow = () => getComputedStyle($('rail-toggle')).display !== 'none';
  const setOpen = (open) => { $('rail').classList.toggle('open', open); $('rail-toggle').setAttribute('aria-expanded', String(open)); report(); };
  function rail(list) {
    const by = group(list, projectKey);
    const span = [...Array(14).keys()].map((i) => iso(now - (13 - i) * DAY));
    const cards = [...by].map(([k, rs]) => ({ k, rs, newest: rs.reduce((a, r) => (r.start > a ? r.start : a), '') })).sort((a, b) => (a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : b.rs.length - a.rs.length));
    const choose = (k, f = '') => {
      const same = state.project === k && state.folder === f;
      state.project = same ? '' : k; state.folder = same ? '' : f;
      if (f) state.open.add(k);
      render();
      if (narrow()) { setOpen(false); $('rail-toggle').focus(); }
    };
    const recent = iso(now - 29 * DAY);
    const entry = ({ k, rs }) => {
      const days14 = group(rs, (r) => day(r.start));
      const tier = rs.find((r) => r.tier)?.tier.last, pd = `pd${gid++}`;
      const b = el('button', { type: 'button', class: 'card', title: k, 'aria-describedby': pd, 'aria-pressed': String(state.project === k && !state.folder) },
        el('span', { class: 'dot', style: `background:${color(k)}` }), el('span', { class: 'pname' }, name(k)),
        tier && el('span', { class: 'psub' }, tier), sparkline(span.map((d) => days14.get(d)?.length ?? 0), 60, 20), el('span', { class: 'pcount num' }, String(rs.length)));
      b.addEventListener('click', () => choose(k));
      const e = el('div', { class: 'entry', 'data-find': `${name(k)} ${k}`.toLowerCase(), 'data-k': k }, b, el('span', { class: 'sr', id: pd }, `${counts(k, rs)}${tier ? `, last tier ${tier}` : ''}`));
      const folders = [...group(rs, (r) => r.project)].sort((x, y) => (x[0] < y[0] ? -1 : 1));
      if (folders.length < 2) return el('div', { class: 'item' }, e);
      const id = `fl-${gid++}`, open = state.open.has(k);
      const exp = el('button', { type: 'button', class: 'exp', 'aria-expanded': String(open), 'aria-controls': id, 'aria-label': `Folders of ${name(k)}` }, el('span', { 'aria-hidden': 'true' }, '▸'));
      const ul = el('ul', { class: 'folders', id, hidden: !open }, folders.map(([p, ps]) => {
        const f = el('button', { type: 'button', class: 'folder', title: p, 'aria-pressed': String(state.folder === p) }, folder(p), el('span', { class: 'psub num' }, ` ${ps.length}`));
        f.addEventListener('click', () => choose(k, p));
        return el('li', { 'data-find': `${folder(p)} ${p}`.toLowerCase() }, f);
      }));
      exp.addEventListener('click', () => expand(e, exp.getAttribute('aria-expanded') !== 'true'));
      e.append(exp);
      return el('div', { class: 'item' }, e, ul);
    };
    const all = el('button', { type: 'button', class: 'card all', 'aria-pressed': String(!state.project) }, state.reg ? 'All registered projects' : 'All projects');
    all.addEventListener('click', () => { state.project = state.folder = ''; render(); if (narrow()) { setOpen(false); $('rail-toggle').focus(); } });
    const other = cards.filter((c) => c.k === 'Other');
    const old = cards.filter((c) => c.k !== 'Other' && day(c.newest) < recent);
    const older = el('details', { class: 'older', open: state.older || null }, el('summary', {}, `Show older (${old.length})`), old.map(entry));
    older.addEventListener('toggle', () => { state.older = older.open; });
    const fresh = cards.filter((c) => !old.includes(c) && !other.includes(c));
    $('rail-list').replaceChildren(...(fresh.length ? [el('div', { class: 'gh' }, 'Recent')] : []), ...fresh.filter((c) => owner(c.k) != null).map(entry), all, ...fresh.filter((c) => owner(c.k) == null).map(entry), ...(old.length ? [older] : []), ...other.map(entry));
    $('rail-toggle').firstChild.textContent = `${state.project ? `${name(state.project)}${state.folder ? ` / ${folder(state.folder)}` : ''}` : all.textContent}, ${plural(cards.length - other.length, 'project')}`;
    find();
  }
  const expand = (e, open) => {
    if (open) state.open.add(e.dataset.k); else state.open.delete(e.dataset.k);
    find();
  };
  // The search hides what does not match; a repository stays when one of its folders matches, and shows those folders.
  function find() {
    const q = state.rq;
    for (const g of $('rail-list').querySelectorAll('.gh')) g.hidden = !!q;
    for (const item of $('rail-list').querySelectorAll('.item')) {
      const [e, ul] = item.children;
      const own = !q || e.dataset.find.includes(q);
      let hits = 0;
      for (const li of ul?.children ?? []) { li.hidden = !!q && !li.dataset.find.includes(q); hits += !li.hidden; }
      item.hidden = !own && !hits;
      if (ul) { ul.hidden = !(q && hits && !own) && !state.open.has(e.dataset.k); e.querySelector('.exp').setAttribute('aria-expanded', String(!ul.hidden)); }
    }
    const older = $('rail-list').querySelector('.older');
    if (older) { older.hidden = ![...older.querySelectorAll('.item')].some((x) => !x.hidden); if (q && !older.hidden) older.open = true; }
  }
  $('rail-q').addEventListener('input', (e) => { state.rq = e.target.value.toLowerCase(); find(); });
  addEventListener('click', (e) => { if (narrow() && $('rail').classList.contains('open') && !$('rail').contains(e.target)) setOpen(false); });
  // A click on the app around the frame does not reach the click listener; the frame loses the focus instead.
  addEventListener('blur', () => { if (narrow() && $('rail').classList.contains('open')) setOpen(false); });
  $('rail-toggle').addEventListener('click', () => { const open = !$('rail').classList.contains('open'); setOpen(open); if (open) $('rail-q').focus(); });
  // Up and Down move through the list, Right and Left open and close a repository's folders, Escape clears the search, then closes the list.
  $('rail').addEventListener('keydown', (ev) => {
    const items = [...$('rail').querySelectorAll('input, button, summary')].filter((n) => n.getClientRects().length);
    const i = items.indexOf(document.activeElement), e = ev.target.closest?.('.entry');
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') items[i + (ev.key === 'ArrowDown' ? 1 : -1)]?.focus();
    else if ((ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') && e?.querySelector('.exp')) expand(e, ev.key === 'ArrowRight');
    else if (ev.key === 'Escape' && state.rq) { $('rail-q').value = state.rq = ''; find(); }
    else if (ev.key === 'Escape' && narrow() && $('rail').classList.contains('open')) { setOpen(false); $('rail-toggle').focus(); }
    else return;
    ev.preventDefault();
  });

  // The drawn chart, for the keyboard and the readout.
  let drawn = null;
  const METRICS = {
    cost: { label: 'Cost', value: (r) => r.costUSD ?? 0, text: money, axis: (v) => `$${compact(v)}`, floor: 1 },
    time: { label: 'Agent time', value: (r) => (r.busyMs ?? 0) / 3600e3, text: (v) => dur(v * 3600e3), axis: (v) => `${compact(v)}h`, floor: 0.5 },
    tokens: { label: 'Tokens', value: (r) => r.tokens ?? 0, text: compact, axis: compact, floor: 1000 },
    sessions: { label: 'Sessions', value: () => 1, text: String, axis: compact, floor: 2 },
  };
  // The drawn series and days, for the export card.
  let card = { series: [], stacks: [] };
  function chart(list, span, keep = null) {
    drawn?.clear();
    const M = METRICS[metric.value];
    const { value, text } = M;
    const distinct = assign(list);
    // Stacked by agent, each agent is a series in the order of its sessions; by project, the named ones and Other.
    const agents = state.stack === 'agent' ? [...group(list, (r) => r.agent)].sort((a, b) => b[1].length - a[1].length).map(([k]) => k) : null;
    const slotOf = agents ? (r) => r.agent : slot;
    const colorOf = agents ? (k) => `var(--s${(agents.indexOf(k) % SERIES) + 1})` : color;
    const nameOf = agents ? agentName : name;
    const present = new Set(list.map(slotOf));
    const keys = agents ?? [...TOP, ...extra.keys(), 'Other'].filter((k) => present.has(k) && (k === 'Other' || named.includes(k)));
    const shown = keys.filter((k) => !state.hidden.has(k));
    // Other states what it holds: the projects past the named ones and the folders of no repository.
    const folded = distinct.length - named.length, loose = list.some((r) => projectKey(r) === 'Other');
    const otherName = `Other (${[folded && plural(folded, 'more project'), loose && 'folders of no repository'].filter(Boolean).join(' and ')})`;
    const label = (k) => (k === 'Other' ? otherName : nameOf(k));
    // One pass over the sessions: per day and series.
    const byDay = new Map();
    for (const r of list) {
      const d = day(r.start), m = byDay.get(d) ?? new Map(), k = slotOf(r);
      m.set(k, (m.get(k) ?? 0) + value(r));
      byDay.set(d, m);
    }
    const stacks = span.map((d) => ({ d, parts: keys.map((k) => (state.hidden.has(k) ? 0 : byDay.get(d)?.get(k) ?? 0)) }));
    card = { series: keys.map((k) => ({ name: label(k), project: !agents && k !== 'Other', color: colorOf(k).slice(6, -1) })), stacks };
    const by = agents ? 'agent' : 'project';
    // A round top tick: 1, 2 or 5 times a power of ten.
    const peak = Math.max(...stacks.map((s) => sum(s.parts)), M.floor), mag = 10 ** Math.floor(Math.log10(peak));
    const max = [1, 2, 5, 10].map((m) => m * mag).find((m) => m >= peak);
    // Drawn at the frame's width, so text keeps its size on a phone and a wide screen.
    const W = Math.max(300, $('chart').clientWidth), H = 220, L = 48, B = 24, T = 8;
    const step = (W - L) / Math.max(stacks.length, 1), bw = Math.max(2, Math.min(24, step - 4));
    const y = (v) => H - B - (v / max) * (H - B - T);
    const svg = el('svg:svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${M.label} per day by ${by}` });
    for (const t of [0, 0.5, 1]) svg.append(el('svg:line', { x1: L, x2: W, y1: y(max * t), y2: y(max * t), stroke: 'var(--grid)', 'stroke-width': 1 }),
      el('svg:text', { x: L - 6, y: y(max * t) + 4, 'text-anchor': 'end', class: 'tick' }, M.axis(max * t)));
    // The chosen day: a band behind the bars, and its values in the readout under the legend.
    const band = el('svg:rect', { x: 0, y: T, width: step, height: H - T - B, fill: 'var(--grid)', opacity: 0.6, visibility: 'hidden' });
    svg.append(band);
    const tip = $('tip');
    let active = null;
    const clear = () => { active = null; band.setAttribute('visibility', 'hidden'); tip.replaceChildren(); $('tip-live').textContent = ''; };
    const choose = (i, announce) => {
      active = Math.max(0, Math.min(stacks.length - 1, i));
      const s = stacks[active], total = sum(s.parts);
      band.setAttribute('x', L + active * step);
      band.setAttribute('visibility', 'visible');
      const items = byDay.has(s.d) ? [...keys.map((k, j) => s.parts[j] && el('span', { class: 'key' }, el('span', { class: 'swatch', style: `background:${colorOf(k)}` }), `${nameOf(k)} ${text(s.parts[j])}`)).filter(Boolean), el('span', {}, `Total ${text(total)}`)] : ['no sessions'];
      tip.replaceChildren(el('strong', {}, `${s.d} `), ...items);
      if (announce) $('tip-live').textContent = tip.textContent;
    };
    stacks.forEach((s, i) => {
      let base = 0;
      const x = L + i * step + (step - bw) / 2;
      s.parts.forEach((v, k) => {
        if (!v) return;
        const top = y(base + v), bottom = y(base);
        // A 2px surface gap between stacked segments.
        const h = Math.max(1, bottom - top - (base ? 2 : 0));
        svg.append(el('svg:rect', { x, y: top, width: bw, height: h, rx: 2, fill: colorOf(keys[k]), class: 'mark' }));
        base += v;
      });
      if (i % Math.max(1, Math.ceil(stacks.length / Math.floor(W / 70))) === 0) svg.append(el('svg:text', { x: x + bw / 2, y: H - 6, 'text-anchor': 'middle', class: 'tick' }, s.d.slice(5)));
      // The hit area is the whole day, not the bar: a touch or a pointer near a thin bar still reads it.
      const hit = el('svg:rect', { x: L + i * step, y: T, width: step, height: H - T - B, fill: 'transparent' });
      hit.addEventListener('pointerenter', () => choose(i));
      hit.addEventListener('pointerdown', () => choose(i));
      hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') clear(); });
      svg.append(hit);
    });
    drawn = { count: stacks.length, get active() { return active; }, choose, clear };
    const c = $('chart');
    c.setAttribute('tabindex', '0'); c.setAttribute('role', 'group'); c.setAttribute('aria-label', `Per day by ${by}. The left and right arrow keys read each day, Escape closes the reading.`);
    // A chip hides or shows its series; the chart is drawn again with the same scale rules.
    $('legend').replaceChildren(...keys.map((k) => {
      const b = el('button', { type: 'button', class: 'key chip', 'aria-pressed': String(!state.hidden.has(k)) }, el('span', { class: 'swatch', style: `background:${colorOf(k)}` }), label(k));
      b.addEventListener('click', () => { if (state.hidden.has(k)) state.hidden.delete(k); else state.hidden.add(k); chart(list, span, drawn?.active); $('legend').children[keys.indexOf(k)]?.focus(); });
      return b;
    }));
    $('chart').replaceChildren(svg);
    if (keep != null) choose(keep);
    $('chart-table').replaceChildren(...alt(`per-day-${metric.value}-by-${by}`, `${M.label} per day by ${by}, days without sessions left out`, ['Day', ...shown.map(nameOf), 'Total'],
      stacks.filter((s) => byDay.has(s.d)).map((s) => [s.d, ...keys.flatMap((k, j) => (state.hidden.has(k) ? [] : [text(s.parts[j])])), text(sum(s.parts))])));
  }
  for (const b of document.querySelectorAll('#stack button')) b.addEventListener('click', () => {
    state.stack = b.value;
    for (const x of document.querySelectorAll('#stack button')) x.setAttribute('aria-pressed', String(x === b));
    render();
  });
  // The keyboard reads the chart day by day; Escape closes the readout.
  $('chart').addEventListener('keydown', (e) => {
    if (!drawn || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const to = { ArrowRight: (drawn.active ?? -1) + 1, ArrowLeft: (drawn.active ?? drawn.count) - 1, Home: 0, End: drawn.count - 1 }[e.key];
    if (e.key === 'Escape') drawn.clear();
    else if (to != null) { drawn.choose(to, true); e.preventDefault(); }
  });
  $('chart').addEventListener('blur', () => drawn?.clear());

  // Horizontal bars: a label, the bar (segments of 0 to 1 of the track), the value and the sample size. A bar resting on
  // fewer than MIN sessions is hatched and says so in words.
  const bars = (items) => el('ul', { class: 'bars', role: 'list' }, items.map((b) => el('li', { class: b.low ? 'low' : b.mark ? 'mark-row' : null },
    el('span', { class: 'bar-label' }, b.label),
    el('span', { class: 'bar-track' }, (b.segs ?? [{ w: b.frac, color: 'var(--s1)' }]).map((s) => el('span', { class: 'seg', style: `width:${Math.max(0, s.w) * 100}%;background:${s.color}`, title: s.title }))),
    el('span', { class: 'bar-val num' }, b.text), el('span', { class: 'bar-n num' }, `n=${b.n}${b.low ? `, under ${MIN}` : ''}`))));

  // One mini chart per metric over the groups; the line under it names the highest and lowest group with MIN or more.
  function compare(id, by, metrics, cap, tableFor) {
    const gs = [...by].sort((a, b) => b[1].length - a[1].length).slice(0, cap);
    $(id).replaceChildren(el('div', { class: 'cmps' }, metrics.map((m) => {
      const items = gs.map(([k, rs]) => ({ label: k, ...m.f(rs) }));
      const max = Math.max(...items.map((i) => i.v ?? 0), 1e-9);
      const ok = items.filter((i) => i.v != null && i.n >= MIN).sort((a, b) => a.v - b.v);
      const line = ok.length < 2 ? `Fewer than two groups have ${MIN} or more sessions with this value: no comparison drawn.`
        : `Highest ${ok.at(-1).label} ${m.fmt(ok.at(-1).v)} (n=${ok.at(-1).n}), lowest ${ok[0].label} ${m.fmt(ok[0].v)} (n=${ok[0].n}).`;
      return el('div', { class: 'cmp' }, el('h3', {}, m.title),
        bars(items.map((i) => ({ label: i.label, n: i.n, frac: (i.v ?? 0) / max, text: i.v == null ? 'not recorded' : m.fmt(i.v), low: i.n < MIN }))), el('p', { class: 'note' }, line));
    })), ...alt(id, ...tableFor), ...(by.size > cap ? [el('p', { class: 'note' }, `The ${cap} groups with most sessions; the data has all ${by.size}.`)] : []));
  }
  const CMP = [
    { title: 'Median agent time per session', f: medianOf((r) => r.busyMs), fmt: dur },
    { title: 'Median cost per session', f: medianOf((r) => r.costUSD), fmt: money },
    { title: 'Tests passed', f: passRate, fmt: (v) => `${Math.round(v)}%` },
  ];

  // A table's caption, head and body, for a visible table or a chart's text alternative.
  function groups(list, key, caption, label) {
    const by = group(list, key);
    return [caption, [label, 'Sessions', 'Median cost', 'Median time', 'Tests passed', 'Moved up'],
      [...by].sort((a, b) => b[1].length - a[1].length).map(([k, rs]) => {
        const tested = rs.filter((r) => r.tests), tiered = rs.filter((r) => r.tier);
        return [k, rs.length, money(median(rs.map((r) => r.costUSD))), dur(median(rs.map((r) => r.busyMs))), pct(tested.filter((r) => r.tests === 'pass').length, tested.length),
          pct(tiered.filter((r) => r.tier.movedUp).length, tiered.length)];
      })];
  }

  // Weeks counted back from today, the oldest first; the model mix over time.
  const week = (r) => Math.floor((dayStart(now) - dayStart(Date.parse(r.start))) / (7 * DAY));
  const weekLabel = (w) => `week of ${iso(dayStart(now) - (w * 7 + 6) * DAY)}`;
  function weekly(list) {
    const by = group(list, week), order = [...by.keys()].sort((a, b) => b - a).slice(-26);
    // Model mix: the share of each week's sessions, a session with several models split evenly.
    const total = new Map();
    for (const r of list) for (const m of r.models.length ? r.models : ['unknown']) total.set(m, (total.get(m) ?? 0) + 1);
    const top = [...total].sort((a, b) => b[1] - a[1]).slice(0, SERIES - 1).map(([m]) => m);
    const col = (m) => (top.includes(m) ? `var(--s${top.indexOf(m) + 1})` : 'var(--other)');
    const mix = order.map((w) => {
      const rs = by.get(w), share = new Map();
      for (const r of rs) { const ms = r.models.length ? r.models : ['unknown']; for (const m of ms) { const k = top.includes(m) ? m : 'Other'; share.set(k, (share.get(k) ?? 0) + 1 / ms.length); } }
      return { w, n: rs.length, share };
    });
    const keys = [...top, ...(mix.some((x) => x.share.has('Other')) ? ['Other'] : [])];
    $('by-model').replaceChildren(el('div', { id: 'model-legend', class: 'legend' }, keys.map((m) => el('span', { class: 'key' }, el('span', { class: 'swatch', style: `background:${col(m)}` }), m))),
      bars(mix.map((x) => ({ label: weekLabel(x.w), n: x.n, text: `${x.n} sessions`, low: x.n < MIN, segs: keys.map((m) => ({ w: (x.share.get(m) ?? 0) / x.n, color: col(m), title: `${m} ${Math.round(((x.share.get(m) ?? 0) / x.n) * 100)}%` })) }))),
      ...alt('model-mix', 'Share of sessions by model and week', ['Week', ...keys], mix.map((x) => [weekLabel(x.w), ...keys.map((m) => pct(x.share.get(m) ?? 0, x.n))])));
  }

  // Histograms: sessions per bin, the bin holding the median marked.
  function histogram(id, vals, edges, labels, fmt, title) {
    const counts = labels.map(() => 0), bin = (v) => edges.findIndex((e, i) => v < edges[i + 1]);
    for (const v of vals) counts[bin(v)]++;
    const med = median(vals), mb = med == null ? -1 : bin(med), max = Math.max(...counts, 1);
    $(id).replaceChildren(el('h3', {}, title), el('p', { class: 'note num' }, `Median ${med == null ? 'not recorded' : fmt(med)} over ${vals.length} sessions`),
      bars(labels.map((l, i) => ({ label: i === mb ? `${l} (median)` : l, n: counts[i], frac: counts[i] / max, text: String(counts[i]), mark: i === mb }))),
      ...alt(id, title, ['Bin', 'Sessions'], labels.map((l, i) => [l, counts[i]])));
  }

  // Twelve weeks of agent time per day, weeks as columns from Monday; heat keeps each day's level for the export card.
  let heat = [];
  function calendar(list) {
    const today = dayStart(now), dow = (new Date(today).getUTCDay() + 6) % 7, first = today - dow * DAY - 11 * 7 * DAY;
    const by = group(list.filter((r) => Date.parse(day(r.start)) >= first), (r) => day(r.start));
    const busy = (d) => sum((by.get(d) ?? []).map((r) => r.busyMs));
    const nz = [...by.keys()].map(busy).filter((v) => v > 0).sort((a, b) => a - b);
    const level = (v) => (v <= 0 ? 0 : 1 + [0.25, 0.5, 0.75].filter((q) => v > nz[Math.floor(q * (nz.length - 1))]).length);
    const C = 14, G = 3, L = 30, T = 16, W = L + 12 * (C + G), H = T + 7 * (C + G) + 4;
    const svg = el('svg:svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Agent time per day over the last 12 weeks', class: 'cal' });
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((t, r) => svg.append(el('svg:text', { x: 0, y: T + r * (C + G) + C - 3, class: 'tick' }, t)));
    // A month's name over the first week that starts in it; the first column's only when the next month is two columns away.
    const month = (c) => new Date(first + c * 7 * DAY).toLocaleString('en', { month: 'short', timeZone: 'UTC' });
    for (let c = 0; c < 12; c++) if (c ? month(c) !== month(c - 1) : month(0) === month(2)) svg.append(el('svg:text', { x: L + c * (C + G), y: 11, class: 'tick' }, month(c)));
    let active = 0, streak = 0, longest = 0;
    const lines = [];
    heat = [];
    for (let c = 0; c < 12; c++) for (let r = 0; r < 7; r++) {
      const t = first + (c * 7 + r) * DAY;
      if (t > today) { streak = 0; heat.push(null); continue; }
      const d = iso(t), v = busy(d), has = by.has(d);
      streak = has ? streak + 1 : 0; longest = Math.max(longest, streak);
      if (has) { active++; lines.push([d, by.get(d).length, dur(v)]); }
      heat.push(level(v));
      svg.append(el('svg:rect', { x: L + c * (C + G), y: T + r * (C + G), width: C, height: C, rx: 4, fill: level(v) ? 'var(--accent)' : 'var(--grid)', 'fill-opacity': level(v) ? [0, 0.3, 0.5, 0.75, 1][level(v)] : 1, class: 'mark' }, el('svg:title', {}, `${d}: ${has ? dur(v) : 'no sessions'}`)));
    }
    $('calendar').replaceChildren(el('p', { class: 'note num' }, `${active} active days of 84, longest streak ${longest} day${longest === 1 ? '' : 's'}`), el('div', { class: 'scroll' }, svg),
      ...alt('activity', 'Days with sessions in the last 12 weeks', ['Day', 'Sessions', 'Agent time'], lines.reverse()));
  }

  // One project: its branches and their pull request links (every period).
  function projectPage(list) {
    const s = $('project-page'), k = state.project;
    s.hidden = !k;
    if (s.hidden) return;
    const prs = new Set(list.flatMap((r) => r.prs));
    $('project-title').textContent = `Project ${name(k)}`;
    $('project-body').replaceChildren(el('p', { class: 'note num' }, `${list.length} sessions, ${prs.size} pull requests`),
      list.length ? table('Branches, newest first', ['Branch', 'Sessions', 'Last session', 'Pull requests'], [...group(list, (r) => r.branch ?? '-')].map(([b, rs]) => {
        const ps = new Set(rs.flatMap((r) => r.prs));
        return [b, rs.length, rs.reduce((a, r) => (r.start > a ? r.start : a), '').slice(0, 10), [...ps].map((u) => `#${u.split('/').pop()}`).join(', ') || '-'];
      }).sort((a, b) => (a[2] < b[2] ? 1 : -1))) : el('p', { class: 'muted' }, 'No sessions match these filters.'));
  }

  function skills(list) {
    const n = new Map();
    for (const r of list) for (const s of r.skills) n.set(s, (n.get(s) ?? 0) + 1);
    const ranked = [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 25);
    const max = ranked[0]?.[1] ?? 1;
    $('skills').replaceChildren(table('Sessions that used each skill (top 25)', ['Skill', 'Sessions'], ranked.map(([s, c]) => [s, el('span', { class: 'rank' }, el('span', { class: 'rank-bar', style: `width:${(c / max) * 100}%` }), String(c))])));
  }

  let current = [], last = null, announced = null;
  // A region that scrolls sideways is a Tab stop, so the keyboard can scroll it; one that fits is not.
  const scrollStops = () => document.querySelectorAll('main section, .scroll').forEach((s) => (s.scrollWidth > s.clientWidth ? s.setAttribute('tabindex', '0') : s.removeAttribute('tabindex')));
  // The frame's own height changes (the page grows to fit) fire resize too: only a new width redraws.
  let width = innerWidth;
  addEventListener('resize', () => {
    if (innerWidth === width) return;
    width = innerWidth;
    cancelAnimationFrame(last);
    last = requestAnimationFrame(() => { if (current.length) chart(current, days(current), drawn?.active); scrollStops(); });
  });
  function renderTable(list) {
    const q = state.q;
    const shown = list.filter((r) => !q || [r.title, r.project, r.branch, setupKey(r), patternKey(r), r.run, r.tier?.last, r.tier?.changeType, ...r.skills].some((x) => x && x.toLowerCase().includes(q))).slice(0, 300);
    const text = `${shown.length} of ${list.length} sessions${shown.length === 300 ? ' (first 300)' : ''}`;
    $('count').textContent = text;
    // Read out when typing settles, not on every key.
    clearTimeout(announced);
    announced = setTimeout(() => { $('count-live').textContent = text; }, 500);
    // Ponytail's own figures (its ledger, read only) in a column of their own, shown when a row has them.
    const pony = list.some((r) => r.ponytail);
    const ledgerCell = (p) => (p ? [p.costUSD == null ? null : money(p.costUSD), `${p.turns} turns`, p.agentMinutes == null ? null : `${p.agentMinutes}m`, p.reusePct == null ? null : `reuse ${p.reusePct}%`, p.tests, p.level].filter((x) => x != null).join(', ') : '-');
    $('sessions').replaceChildren(!shown.length ? el('p', { class: 'muted' }, 'No sessions match.') : table('Sessions, newest first', ['Started', 'Project', 'Title', 'Agent', 'Tier', 'Pattern', 'Setup', 'Cost', 'Time', 'Tests', 'Pull requests', ...(pony ? ['Source', 'Ponytail ledger'] : [])], shown.map((r) => [
      r.start.slice(0, 16).replace('T', ' '), short(r.project ?? ''), r.title ?? '-', r.agent,
      r.tier ? `${r.tier.first}${r.tier.movedUp || r.tier.last !== r.tier.first ? ` to ${r.tier.last}` : ''}${r.tier.changeType ? ` (${r.tier.changeType})` : ''}` : '-',
      `${patternKey(r)}${r.subagents ? `, ${r.subagents} subagent${r.subagents > 1 ? 's' : ''}` : ''}${r.run ? `, run ${r.run}` : ''}`,
      `${setupKey(r)}${r.setupVersion ? `, ${r.setupVersion}` : ''}`, `${money(r.costUSD)}${r.costEstimated ? ' (estimated)' : ''}`, dur(r.busyMs), r.tests ?? '-',
      r.prs.length ? r.prs.map((u) => `#${u.split('/').pop()}`).join(', ') : '-',
      ...(pony ? [r.source ?? 'transcript', ledgerCell(r.ponytail)] : []),
    ])));
    scrollStops();
  }

  const CHARTS = ['chart', 'by-tier', 'by-pattern', 'by-setup', 'by-model', 'dist-time', 'dist-turns', 'calendar', 'by-change', 'skills'];
  function render() {
    try { localStorage.setItem('bk-board-project', JSON.stringify([state.project, state.folder])); } catch { /* storage blocked */ }
    // Whole UTC days, the same ones the chart draws: today and the days before it.
    const len = state.period === 'all' ? null : Number(state.period);
    const since = len ? iso(now - (len - 1) * DAY) : '';
    const before = len ? iso(now - (2 * len - 1) * DAY) : '';
    const all = pool();
    const others = (r) => FILTERS.every(([key, , f]) => !state[key] || f(r) === state[key]) && (!state.folder || r.project === state.folder);
    const base = all.filter(others);
    const list = base.filter((r) => r.start >= since);
    const prev = len ? base.filter((r) => day(r.start) >= before && day(r.start) < since) : null;
    assign(list);
    // The rail leaves the project filter out, so every project of the period stays a choice.
    rail(all.filter((r) => r.start >= since && FILTERS.every(([key, , f]) => key === 'project' || !state[key] || f(r) === state[key])));
    const span = days(list);
    current = list;
    tiles(list, prev, span, len ? [...Array(len).keys()].map((i) => iso(now - (2 * len - 1 - i) * DAY)) : null);
    // Not one session on the machine before this period: its history is cut, said once here instead of on every card.
    $('history').hidden = !(len && oldest && oldest >= since);
    $('history-start').textContent = oldest;
    projectPage(base);
    if (!list.length) {
      // One sentence per section instead of header-only tables and an empty axis.
      drawn = null;
      for (const a of ['tabindex', 'role', 'aria-label']) $('chart').removeAttribute(a);
      for (const id of CHARTS) $(id).replaceChildren(el('p', { class: 'muted' }, 'No sessions match these filters.'));
      for (const id of ['legend', 'chart-table', 'tip', 'tip-live']) $(id).replaceChildren();
      card = { series: [], stacks: [] }; heat = [];
      renderTable(list);
      return;
    }
    chart(list, span);
    const tiered = group(list, (r) => r.tier?.last ?? null);
    compare('by-tier', tiered, [{ title: 'Tests passed', f: passRate, fmt: (v) => `${Math.round(v)}%` }, { title: 'Median turns per session', f: medianOf((r) => r.turns), fmt: (v) => String(+v.toFixed(1)) }], 8, groups(list, (r) => r.tier?.last ?? null, 'Sessions by tier (the last tier line)', 'Tier'));
    compare('by-pattern', group(list, patternKey), CMP, 8, groups(list, patternKey, 'Sessions by pattern', 'Pattern'));
    compare('by-setup', group(list, setupKey), CMP, 8, groups(list, setupKey, 'Sessions by setup', 'Setup'));
    weekly(list);
    histogram('dist-time', list.map((r) => r.busyMs).filter((v) => v != null), [0, 60e3, 300e3, 900e3, 1800e3, 3600e3, 7200e3, 14400e3, Infinity], ['under 1m', '1 to 5m', '5 to 15m', '15 to 30m', '30 to 60m', '1 to 2h', '2 to 4h', '4h or more'], dur, 'Agent time per session');
    histogram('dist-turns', list.map((r) => r.turns), [0, 2, 3, 5, 9, 17, Infinity], ['1 or none', '2', '3 to 4', '5 to 8', '9 to 16', '17 or more'], (v) => String(v), 'Turns per session');
    calendar(base);
    $('by-change').replaceChildren(table(...groups(list, (r) => (r.tier ? `${r.tier.first}: ${r.tier.changeType ?? 'no change type'}` : null), 'Moved up per first tier and change type (report only)', 'Tier and change type')));
    skills(list);
    renderTable(list);
  }
  // The export card: built from the drawn page data in the page itself, previewed, then saved as PNG or SVG.
  const exp = $('export');
  const cardText = () => {
    const dark = $('x-theme').value ? $('x-theme').value === 'dark' : document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const period = $('f-period').selectedOptions[0].textContent;
    return cardSvg({ title: `Sessions, ${period.toLowerCase()}`, sub: `${METRICS[metric.value].label} per day, read ${D.now.slice(0, 10)}`, facts: facts.map(([l, v]) => [l, v]), ...card, heat, names: $('x-names').checked, colors: D.colors[dark ? 'dark' : 'light'] });
  };
  const preview = () => $('x-preview').replaceChildren(document.importNode(new DOMParser().parseFromString(cardText(), 'image/svg+xml').documentElement, true));
  $('export-open').addEventListener('click', () => { preview(); exp.showModal(); });
  for (const id of ['x-names', 'x-theme']) $(id).addEventListener('change', preview);
  $('x-close').addEventListener('click', () => exp.close());
  $('x-svg').addEventListener('click', () => save('sessions-card.svg', new Blob([cardText()], { type: 'image/svg+xml' })));
  $('x-png').addEventListener('click', () => {
    const img = new Image(), url = URL.createObjectURL(new Blob([cardText()], { type: 'image/svg+xml' }));
    img.onload = () => {
      const c = el('canvas', { width: 1200, height: 630 });
      c.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      c.toBlob((b) => save('sessions-card.png', b), 'image/png');
    };
    img.src = url;
  });
  render();
  // Runs over all periods and filters: cost and tokens per run, then per task.
  const total = (x) => [String(x.sessions), money(x.costUSD), compact(x.tokens)];
  $('by-run').replaceChildren(!D.runs.length ? el('p', { class: 'muted' }, 'No orchestrated sessions.') : table('Cost and tokens per run and task, all periods', ['Run', 'Task', 'Sessions', 'Cost', 'Tokens'],
    D.runs.slice(0, 50).flatMap((x) => [[x.run ?? 'not recorded', 'all tasks', ...total(x)], ...x.tasks.map((t) => [x.run ?? 'not recorded', t.task ?? 'not recorded', ...total(t)])])));
  scrollStops();
}
/* node:coverage enable */

const SCRIPT = `(${draw})({ periodFacts: ${periodFacts}, changeText: ${changeText}, toCsv: ${toCsv}, cardSvg: ${cardSvg} });`;
export const SCRIPT_HASH = `sha256-${createHash('sha256').update(SCRIPT).digest('base64')}`;
// No requests at all; inline styles only; the script by its hash. The app adds frame-ancestors in its header.
// img-src blob: lets the export card draw its own SVG into a canvas for the PNG.
export const CSP = `default-src 'none'; script-src '${SCRIPT_HASH}'; style-src 'unsafe-inline'; img-src blob:; base-uri 'none'; form-action 'none'`;

// Tokens first: the colors per theme, then the shape, shadow and type every panel shares.
const STYLE = `
:root { color-scheme: light; ${cssVars('light')} }
@media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) { color-scheme: dark; ${cssVars('dark')} } }
:root[data-theme="dark"] { color-scheme: dark; ${cssVars('dark')} }
* { box-sizing: border-box; } [hidden] { display: none !important; }
body { margin: 0; padding: 16px; background: var(--page); color: var(--ink); font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
.head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
h1 { font-size: 22px; letter-spacing: -0.01em; margin: 0; } h2 { font-size: 16px; margin: 0 0 10px; } h3 { font-size: 13px; margin: 0 0 8px; color: var(--ink-2); font-weight: 600; }
.muted, .note, caption, .tick { color: var(--ink-2); } .tick { fill: var(--ink-2); font-size: 11px; }
.num, .tick { font-family: var(--mono); font-variant-numeric: tabular-nums; }
button, select, input { font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 5px 10px; }
button { cursor: pointer; transition: border-color var(--ease), box-shadow var(--ease); }
button:hover { border-color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
#filters { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; margin: 12px 0; }
#filters label { color: var(--ink-2); } .f { display: inline-flex; gap: 6px; align-items: center; max-width: 100%; }
#filters select { max-width: min(240px, 100%); }
.layout { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 16px; align-items: start; }
#rail { position: sticky; top: 8px; max-height: calc(100vh - 16px); overflow-y: auto; padding: 4px; margin: -4px; }
#rail-list, .older { display: flex; flex-direction: column; gap: 2px; } #rail-q { width: 100%; margin-bottom: 8px; }
#rail-toggle { display: none; width: 100%; text-align: left; font-weight: 600; }
.entry { display: flex; gap: 4px; } .entry .card { flex: 1; min-width: 0; } .exp { padding: 0 8px; height: 32px; background: transparent; border-color: transparent; } .exp[aria-expanded="true"] span { display: inline-block; transform: rotate(90deg); }
.folders { list-style: none; margin: 0 0 0 18px; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.folder { width: 100%; text-align: left; border-color: transparent; padding: 2px 8px; overflow-wrap: anywhere; } .folder[aria-pressed="true"] { border-color: var(--accent); }
.older summary { margin: 0; }
/* Framed in the app, whose navbar already stands on the left, the rail is one button that opens the list. */
.framed .layout { grid-template-columns: minmax(0, 1fr); }
.framed #rail { position: relative; max-height: none; overflow: visible; margin: 0; padding: 0; max-width: 100%; }
.framed #rail-toggle { display: block; width: auto; max-width: 100%; overflow-wrap: anywhere; border-radius: 999px; } .framed #rail:not(.open) #rail-panel { display: none; }
.framed #rail-panel { position: absolute; z-index: 5; top: calc(100% + 4px); left: 0; width: min(340px, calc(100vw - 32px)); max-height: 360px; overflow-y: auto; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
.framed #rail-q { border: 0; border-bottom: 1px solid var(--line); border-radius: 0; margin: 0; padding: 8px 12px; background: var(--surface); position: sticky; top: 0; } .framed #rail-q:focus-visible { outline-offset: -2px; }
.framed #rail-list { padding: 4px 0; }
.card { display: flex; align-items: center; gap: 8px; text-align: left; width: 100%; height: 32px; padding: 0 12px; background: transparent; border-color: transparent; border-radius: var(--radius-sm); }
.card:hover { background: var(--glow); }
.card.all { font-weight: 600; }
.card[aria-pressed="true"] { background: var(--glow); border-color: var(--accent); }
.gh { padding: 6px 12px 2px; font-size: 12px; font-weight: 600; color: var(--ink-2); }
.pname { flex: 1; min-width: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .card[aria-pressed="true"] .pname { font-weight: 600; }
.psub, .pcount { font-size: 12px; color: var(--ink-2); } .pcount { min-width: 2ch; text-align: right; } .card .spark { width: 42px; height: 14px; flex: none; }
.dot { width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 0 3px var(--glow); }
section { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px; margin: 0 0 16px; overflow-x: auto; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 12px; }
.facts.small { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-bottom: 16px; } .small .tile .value { font-size: 18px; }
.tile { position: relative; isolation: isolate; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 12px 14px; overflow: hidden; }
.tile::before { content: ''; position: absolute; inset: -30% -20% auto auto; width: 70%; height: 90%; background: radial-gradient(closest-side, var(--glow), transparent); z-index: -1; }
.tile .label { color: var(--ink-2); } .tile .value { font-size: 24px; font-weight: 600; letter-spacing: -0.02em; } .note, .delta { font-size: 12px; } .delta { color: var(--ink-2); }
.spark { display: block; max-width: 100%; }
#chart svg { display: block; }
#legend, .legend { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; } .key { display: inline-flex; align-items: center; gap: 6px; }
.chip { border-radius: 999px; padding: 3px 10px; } .chip[aria-pressed="false"] { opacity: 0.55; text-decoration: line-through; }
.swatch { width: 12px; height: 12px; border-radius: 4px; display: inline-block; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
caption { text-align: left; padding-bottom: 6px; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--grid); vertical-align: top; }
thead th { font-weight: 600; } tbody th { font-weight: 400; }
.rank { display: flex; align-items: center; gap: 8px; } .rank-bar { display: inline-block; height: 8px; border-radius: 0 4px 4px 0; background: var(--s1); max-width: 240px; flex: none; }
.cmps { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.bars { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(70px, 150px) minmax(60px, 1fr) auto auto; gap: 8px 10px; align-items: center; }
.bars li { display: contents; }
.bar-label { overflow-wrap: anywhere; } .bar-n, .bar-val { font-size: 12px; } .bar-n { color: var(--ink-2); white-space: nowrap; }
.bar-track { position: relative; display: flex; height: 12px; border-radius: 6px; background: var(--grid); overflow: hidden; }
.seg { display: block; height: 100%; transition: width 250ms ease; }
.low .seg { background-image: repeating-linear-gradient(135deg, transparent 0 4px, var(--surface) 4px 6px); opacity: 0.8; }
.mark-row .bar-label { font-weight: 600; } .mark-row .seg { box-shadow: 0 0 0 2px var(--ink); }
.scroll { overflow-x: auto; }
#tip { display: flex; flex-wrap: wrap; gap: 2px 14px; min-height: 2.9em; margin: 4px 0; }
#chart:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.mark, .swatch, .seg { forced-color-adjust: none; }
.sr, .framed h1 { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.framed #theme, .framed .lead { display: none; }
.framed-only { display: none; } .framed .framed-only { display: inline; }
details summary { cursor: pointer; color: var(--ink-2); margin-top: 8px; }
.csv { font-size: 12px; padding: 2px 8px; margin-top: 8px; } a { color: var(--accent); }
#stack { margin-top: 6px; } #stack button[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
dialog { background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); width: min(760px, calc(100vw - 32px)); padding: 16px; }
dialog::backdrop { background: rgba(0, 0, 0, 0.4); } dialog .f, #x-options { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 8px 0; }
#x-preview svg { display: block; width: 100%; height: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.row { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
@media (max-width: 760px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  #rail { position: relative; max-height: none; overflow: visible; margin: 0 0 12px; padding: 0; }
  #rail-toggle { display: block; } #rail:not(.open) #rail-panel { display: none; }
  #rail-panel { position: absolute; z-index: 5; top: calc(100% + 4px); left: 0; width: min(340px, 100%); max-height: 360px; overflow-y: auto; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
  #rail-q { border: 0; border-bottom: 1px solid var(--line); border-radius: 0; margin: 0; padding: 8px 12px; background: var(--surface); position: sticky; top: 0; } #rail-q:focus-visible { outline-offset: -2px; } #rail-list { padding: 4px 0; }
  .bars { grid-template-columns: minmax(0, 1fr); } .bars li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 4px 10px; align-items: center; } .bar-track { grid-column: 1 / -1; order: 3; }
}
@media (prefers-reduced-motion: reduce) { *, ::before, ::after { transition: none !important; animation: none !important; } }
`;

const parts = (p) => p.split(/[\\/]/).filter(Boolean);
const inside = (dir, p) => p === dir || p.startsWith(`${dir}/`) || p.startsWith(`${dir}\\`);
// The repository each session folder counts under, the first that names one: the main worktree git gave for the folder
// on any of its rows (kept after the folder is gone); the registered project whose folder or worktree holds it; the
// deepest known repository it sits in; the one known repository named like its parent folder
// (<worktrees root>/<repository>/<worktree>), in any letter case. A folder none of them names is left out: the board shows it under Other.
function repoKeys(rows, registered) {
  const found = new Map(rows.filter((r) => r.project && r.repo).map((r) => [r.project, r.repo]));
  const known = [...new Set([...found.values(), ...registered.map((x) => x.path)])].sort((a, b) => b.length - a.length);
  const named = new Map();
  for (const k of known) { const b = parts(k).at(-1); if (!b) continue; const n = b.toLowerCase(); named.set(n, named.has(n) ? null : k); }
  const keys = new Map();
  for (const p of new Set(rows.map((r) => r.project).filter(Boolean))) {
    const k = found.get(p) ?? registered.find((x) => [x.path, ...x.worktrees].some((d) => inside(d, p)))?.path ?? known.find((d) => inside(d, p)) ?? named.get(parts(p).at(-2)?.toLowerCase());
    if (k) keys.set(p, k);
  }
  return keys;
}

// One registered project's sessions, worktrees counted under it as on the board: its page shows only these.
export function projectRows(rows, registered, path, keys = repoKeys(rows, registered)) {
  return rows.filter((r) => keys.get(r.project) === path);
}

// The Projects view's cards: per registered project, its sessions of the last `days` days up to now, all agents merged and
// worktrees counted under their repository as on the board. perDay: sessions per day, oldest first; uncosted: sessions
// without a cost; estimated: sessions with an estimated cost; change: the sessions against the previous period, by the cards' rule.
export function projectActivity(rows, registered, now, days = 30) {
  const keys = repoKeys(rows, registered);
  const today = Date.parse(now.slice(0, 10));
  const span = (back) => Array.from({ length: days }, (_, i) => new Date(today - (back + days - 1 - i) * 864e5).toISOString().slice(0, 10));
  const cur = span(0), prev = span(days);
  const within = (list, s) => list.filter((r) => r.start.slice(0, 10) >= s[0] && r.start.slice(0, 10) <= s.at(-1));
  return Object.fromEntries(registered.map(({ path }) => {
    const mine = projectRows(rows, registered, path, keys).filter((r) => r.start);
    const now30 = within(mine, cur), before = within(mine, prev);
    const f = periodFacts(now30, cur);
    const last = mine.reduce((a, r) => (!a || r.start > a.start ? r : a), null);
    return [path, {
      perDay: cur.map((d) => now30.filter((r) => r.start.startsWith(d)).length), from: cur[0], to: cur.at(-1),
      sessions: f.sessions, week: within(mine, cur.slice(-7)).length, time: f.time, cost: f.cost, uncosted: now30.filter((r) => r.costUSD == null).length, estimated: now30.filter((r) => r.costEstimated).length,
      change: changeText(f.sessions, before.length ? before.length : null, days),
      last: last && { time: last.end ?? last.start, tier: last.tier?.last ?? null },
    }];
  }));
}

// rows: scanSessions output; now: an ISO time (the periods count back from it); registered: registeredPaths(), the
// projects Registered only keeps, with their worktrees for rows cached without a repository.
export function boardHtml(rows, now = new Date().toISOString(), registered = [], keepDays = 30) {
  // JSON in a script element: < as <, so no value can close the element.
  const data = JSON.stringify({ rows, keys: [...repoKeys(rows, registered)], runs: byRun(rows), priceDate: CODEX_PRICES.date, now, registered, minSamples: MIN_SAMPLES, colors: TOKENS }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>Sessions board</title>
<style>${STYLE}</style>
</head>
<body>
<main aria-label="Sessions board">
<div class="head"><h1>Sessions board</h1><span class="muted"><span class="lead">Claude Code and Codex sessions on this machine, read </span><span class="framed-only">Read </span>${now.slice(0, 16).replace('T', ' ')} UTC</span><span class="f"><button id="export-open" type="button">Export card</button><button id="theme" type="button">Light or dark</button></span></div>
<p id="history" class="note" hidden>History starts <span id="history-start"></span>: older sessions are no longer on this machine (Claude Code keeps transcripts for ${keepDays} days, <a href="https://code.claude.com/docs/en/settings-reference#cleanupperioddays" target="_blank" rel="noopener">cleanupPeriodDays</a>).</p>
<div id="filters" role="group" aria-label="Filters"></div>
<div class="layout">
<nav id="rail" aria-label="Projects"><button id="rail-toggle" type="button" aria-expanded="false" aria-controls="rail-panel"><span></span><span aria-hidden="true"> \u25be</span></button><div id="rail-panel"><input id="rail-q" type="search" aria-label="Find a project" placeholder="Find a project"><div id="rail-list"></div></div></nav>
<div class="content">
<div id="tiles"></div>
<section aria-labelledby="h-cal"><h2 id="h-cal">Activity, last 12 weeks</h2><div id="calendar"></div></section>
<section aria-labelledby="h-chart"><div class="row"><h2 id="h-chart">Per day by project</h2><label>Show <select id="metric"><option value="cost">Cost</option><option value="time">Agent time</option><option value="tokens">Tokens</option><option value="sessions">Sessions</option></select></label></div>
<div id="stack" class="f" role="group" aria-labelledby="stack-label"><span id="stack-label" class="muted">Stack by</span><button type="button" value="project" aria-pressed="true">Project</button><button type="button" value="agent" aria-pressed="false">Agent</button></div>
<div id="legend"></div><div id="chart" tabindex="0" role="group" aria-label="Per day by project. The left and right arrow keys read each day, Escape closes the reading."></div><div id="tip"></div><span id="tip-live" class="sr" role="status"></span><div id="chart-table"></div></section>
<section id="project-page" aria-labelledby="project-title" hidden><h2 id="project-title"></h2><div id="project-body"></div></section>
<section aria-labelledby="h-tier"><h2 id="h-tier">Tier against outcome</h2><p class="note">n is the sessions a bar rests on. A bar under ${MIN_SAMPLES} is hatched and left out of the highest and lowest line.</p><div id="by-tier"></div></section>
<section aria-labelledby="h-pattern"><h2 id="h-pattern">By pattern</h2><div id="by-pattern"></div></section>
<section aria-labelledby="h-setup"><h2 id="h-setup">By setup</h2><div id="by-setup"></div></section>
<section aria-labelledby="h-model"><h2 id="h-model">Model mix</h2><div id="by-model"></div></section>
<section aria-labelledby="h-dist"><h2 id="h-dist">Distribution</h2><div class="cmps"><div id="dist-time"></div><div id="dist-turns"></div></div></section>
<section aria-labelledby="h-change"><h2 id="h-change">Moved up</h2><div id="by-change"></div></section>
<section aria-labelledby="h-run"><h2 id="h-run">By run</h2><p class="note">Orchestrated sessions, matched by the run and task ids in the worker's first prompt. Codex costs are estimated from tokens and OpenAI API prices.</p><div id="by-run"></div></section>
<section aria-labelledby="h-skills"><h2 id="h-skills">Skills used</h2><div id="skills"></div></section>
<section aria-labelledby="h-sessions"><div class="row"><h2 id="h-sessions">Sessions</h2><label>Search <input id="search" type="search"></label></div><p id="count" class="muted"></p><span id="count-live" class="sr" role="status"></span><div id="sessions"></div></section>
</div>
</div>
</main>
<dialog id="export" aria-labelledby="export-title"><h2 id="export-title">Export card</h2>
<p class="note">Made on this machine from the page data, nothing is uploaded. Projects show as Project A, Project B and so on unless names are on.</p>
<div id="x-options"><span class="f"><input type="checkbox" id="x-names"><label for="x-names">Show project names</label></span><span class="f"><label for="x-theme">Theme</label><select id="x-theme"><option value="">As the page</option><option value="light">Light</option><option value="dark">Dark</option></select></span></div>
<div id="x-preview" role="img" aria-label="Preview of the card"></div>
<div class="f"><button id="x-png" type="button">Save PNG</button><button id="x-svg" type="button">Save SVG</button><button id="x-close" type="button">Close</button></div></dialog>
<script type="application/json" id="data">${data}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

// The board as a file the user opens without the app (the tier band's Board button): rewritten by every scan.
export function writeBoard(ctx, rows, now) {
  const file = join(ctx.config, 'board.html');
  writeAtomic(file, boardHtml(rows, now, registeredPaths(ctx), keepDays(ctx)), 0o600);
  return file;
}

// The days Claude Code keeps transcripts (cleanupPeriodDays in the user settings, default 30): the board's history.
export function keepDays(ctx) {
  let v;
  try { v = JSON.parse(readText(join(ctx.home, '.claude/settings.json')) ?? '{}')?.cleanupPeriodDays; } catch { /* unreadable settings: the default */ }
  return Number.isInteger(v) && v > 0 ? v : 30;
}

// The app's registered projects, each with its other Git worktrees, where sessions on a branch often run.
export function registeredPaths(ctx) {
  return listProjects(ctx).map(({ path }) => {
    const r = ctx.run(['git', '-C', path, 'worktree', 'list', '--porcelain'], { env: repoEnv() });
    return { path, worktrees: r.code === 0 ? r.stdout.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9)).filter((w) => canon(w) !== canon(path)) : [] };
  });
}
