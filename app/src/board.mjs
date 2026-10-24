// The sessions board: one self-contained page. Rows go in as JSON data; one constant script draws the page, writes
// every transcript value through textContent, and builds the charts as plain SVG. Its hash is the page's script-src.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { writeAtomic } from './fsx.mjs';
import { listProjects } from './projects.mjs';

// Runs in the browser only: toString() of this function is the page script.
function draw() {
  const D = JSON.parse(document.getElementById('data').textContent);
  const rows = D.rows, now = Date.parse(D.now);
  const NS = 'http://www.w3.org/2000/svg';
  const SERIES = 4;
  const el = (tag, attrs, ...kids) => {
    const n = tag.startsWith('svg:') ? document.createElementNS(NS, tag.slice(4)) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs ?? {})) if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
    for (const k of kids.flat()) if (k != null) n.append(k instanceof Node ? k : String(k));
    return n;
  };
  const $ = (id) => document.getElementById(id);
  const setupKey = (r) => (!r.setup ? 'not recorded' : r.setup.length ? r.setup.join(' + ') : 'none');
  const day = (iso) => iso.slice(0, 10);
  const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
  const pct = (part, all) => (all ? `${Math.round((part / all) * 100)}%` : '-');
  const usd = (x) => (x == null ? 'not recorded' : `$${x < 10 ? x.toFixed(2) : Math.round(x).toLocaleString('en')}`);
  const dur = (ms) => { if (ms == null) return 'not recorded'; const m = Math.round(ms / 60e3); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };
  const compact = (x) => (x >= 1e9 ? `${+(x / 1e9).toFixed(1)}B` : x >= 1e6 ? `${+(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${+(x / 1e3).toFixed(1)}K` : String(+x.toFixed(x < 10 ? 1 : 0)));
  const sum = (xs) => xs.reduce((n, x) => n + (x ?? 0), 0);

  // Theme: the query (the app passes its own), else the stored choice, else the system's.
  let stored = null;
  try { stored = localStorage.getItem('bk-board-theme'); } catch { /* storage blocked */ }
  const asked = new URLSearchParams(location.search).get('theme');
  const theme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
  theme(['light', 'dark'].includes(asked) ? asked : stored);
  $('theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    theme(next);
    try { localStorage.setItem('bk-board-theme', next); } catch { /* storage blocked */ }
  });

  // Filters: one row of selects, each with the values present in the data.
  const FILTERS = [
    ['project', 'Project', (r) => r.project ?? 'unknown'],
    ['agent', 'Agent', (r) => r.agent],
    ['tier', 'Tier', (r) => r.tier?.last ?? 'none'],
    ['setup', 'Setup', setupKey],
  ];
  // Projects registered in the app and their worktrees; a leading space keeps the option apart from any path.
  const REGISTERED = ' registered';
  const listed = (r) => !!r.project && D.registered.some((p) => r.project === p || r.project.startsWith(`${p}/`) || r.project.startsWith(`${p}\\`));
  const state = { period: '30', q: '', project: rows.some(listed) ? REGISTERED : '' };
  const matches = (key, f, r) => (key === 'project' && state.project === REGISTERED ? listed(r) : f(r) === state[key]);
  const bar = $('filters');
  for (const [key, label, f] of FILTERS) {
    const values = [...new Set(rows.map(f))].sort();
    const own = key === 'project' && D.registered.length ? [el('option', { value: REGISTERED, selected: state.project === REGISTERED }, 'Registered projects')] : [];
    const s = el('select', { id: `f-${key}` }, own, el('option', { value: '', selected: !state[key] }, 'All'), values.map((v) => el('option', { value: v }, v)));
    s.addEventListener('change', () => { state[key] = s.value; render(); });
    bar.append(el('span', { class: 'f' }, el('label', { for: `f-${key}` }, label), s));
  }
  const period = el('select', { id: 'f-period' }, [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['all', 'All time']].map(([v, t]) => el('option', { value: v, selected: v === state.period }, t)));
  period.addEventListener('change', () => { state.period = period.value; render(); });
  bar.append(el('span', { class: 'f' }, el('label', { for: 'f-period' }, 'Period'), period));
  const metric = $('metric');
  metric.addEventListener('change', () => render());
  $('search').addEventListener('input', (e) => { state.q = e.target.value.toLowerCase(); renderTable(current); });

  const table = (caption, head, body) => el('table', {}, el('caption', {}, caption), el('thead', {}, el('tr', {}, head.map((h) => el('th', { scope: 'col' }, h)))),
    el('tbody', {}, body.map((cells) => el('tr', {}, cells.map((c, i) => (i === 0 ? el('th', { scope: 'row' }, c) : el('td', {}, c)))))));
  const days = (list) => {
    const first = state.period === 'all' ? (list.length ? Date.parse(day(list.at(-1).start)) : now) : now - (Number(state.period) - 1) * 864e5;
    const out = [];
    for (let t = Date.parse(day(new Date(first).toISOString())); t <= now; t += 864e5) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  };

  function sparkline(values) {
    const w = 120, h = 28, max = Math.max(...values, 1);
    const pts = values.map((v, i) => [values.length > 1 ? (i / (values.length - 1)) * (w - 8) + 4 : w / 2, h - 4 - (v / max) * (h - 8)]);
    const last = pts.at(-1);
    return el('svg:svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true', class: 'spark' },
      el('svg:polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
      last && el('svg:circle', { cx: last[0], cy: last[1], r: 4, fill: 'var(--s1)', stroke: 'var(--surface)', 'stroke-width': 2 }));
  }

  function tiles(list, span) {
    const recent = span.slice(-14);
    const per = (f) => recent.map((d) => sum(list.filter((r) => day(r.start) === d).map(f)));
    const codex = list.filter((r) => r.costUSD == null).length;
    const items = [
      ['Sessions', String(list.length), per(() => 1), null],
      ['Agent time', dur(sum(list.map((r) => r.busyMs))), per((r) => r.busyMs), 'API and tool time'],
      ['Cost', usd(sum(list.map((r) => r.costUSD))), per((r) => r.costUSD), `API-equivalent, Claude Code only${codex ? `; ${codex} sessions not recorded` : ''}`],
      ['Tokens', compact(sum(list.map((r) => r.tokens))), per((r) => r.tokens), 'input, cache and output'],
    ];
    $('tiles').replaceChildren(...items.map(([label, value, series, note]) => el('div', { class: 'tile' },
      el('div', { class: 'label' }, label), el('div', { class: 'value' }, value), sparkline(series), note && el('div', { class: 'note' }, note))));
  }

  function chart(list, span) {
    const isCost = metric.value === 'cost';
    const value = (r) => (isCost ? r.costUSD ?? 0 : (r.busyMs ?? 0) / 3600e3);
    const counts = new Map();
    for (const r of list) counts.set(setupKey(r), (counts.get(setupKey(r)) ?? 0) + 1);
    // Fixed slots by session count; the rest fold into Other, so a series keeps its color while filters change.
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, SERIES).map(([k]) => k);
    const keys = [...top, ...(counts.size > SERIES ? ['Other'] : [])];
    const color = (k) => (k === 'Other' ? 'var(--other)' : `var(--s${top.indexOf(k) + 1})`);
    const series = (r) => (top.includes(setupKey(r)) ? setupKey(r) : 'Other');
    const stacks = span.map((d) => ({ d, parts: keys.map((k) => sum(list.filter((r) => day(r.start) === d && series(r) === k).map(value))) }));
    // A round top tick: 1, 2 or 5 times a power of ten.
    const peak = Math.max(...stacks.map((s) => sum(s.parts)), isCost ? 1 : 0.5), mag = 10 ** Math.floor(Math.log10(peak));
    const max = [1, 2, 5, 10].map((m) => m * mag).find((m) => m >= peak);
    // Drawn at the frame's width, so text keeps its size on a phone and a wide screen.
    const W = Math.max(300, $('chart').clientWidth), H = 220, L = 48, B = 24, T = 8;
    const step = (W - L) / Math.max(stacks.length, 1), bw = Math.max(2, Math.min(24, step - 4));
    const y = (v) => H - B - (v / max) * (H - B - T);
    const fmt = (v) => (isCost ? `$${compact(v)}` : `${compact(v)}h`);
    const svg = el('svg:svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${isCost ? 'Cost' : 'Agent time'} per day by setup; the table below has the values` });
    for (const t of [0, 0.5, 1]) svg.append(el('svg:line', { x1: L, x2: W, y1: y(max * t), y2: y(max * t), stroke: 'var(--grid)', 'stroke-width': 1 }),
      el('svg:text', { x: L - 6, y: y(max * t) + 4, 'text-anchor': 'end', class: 'tick' }, fmt(max * t)));
    const tip = $('tip');
    stacks.forEach((s, i) => {
      let base = 0;
      const x = L + i * step + (step - bw) / 2;
      s.parts.forEach((v, k) => {
        if (!v) return;
        const top = y(base + v), bottom = y(base);
        // A 2px surface gap between stacked segments.
        const h = Math.max(1, bottom - top - (base ? 2 : 0));
        const rect = el('svg:rect', { x, y: top, width: bw, height: h, rx: 2, fill: color(keys[k]) });
        rect.addEventListener('pointerenter', (e) => { tip.textContent = `${s.d}: ${keys[k]}, ${isCost ? usd(v) : dur(v * 3600e3)}`; tip.hidden = false; tip.style.left = `${e.clientX + 12}px`; tip.style.top = `${e.clientY + 12}px`; });
        rect.addEventListener('pointerleave', () => { tip.hidden = true; });
        svg.append(rect);
        base += v;
      });
      if (i % Math.max(1, Math.ceil(stacks.length / Math.floor(W / 70))) === 0) svg.append(el('svg:text', { x: x + bw / 2, y: H - 6, 'text-anchor': 'middle', class: 'tick' }, s.d.slice(5)));
    });
    $('legend').replaceChildren(...keys.map((k) => el('span', { class: 'key' }, el('span', { class: 'swatch', style: `background:${color(k)}` }), k)));
    $('chart').replaceChildren(svg);
    $('chart-table').replaceChildren(table('Per day', ['Day', ...keys], stacks.filter((s) => sum(s.parts)).map((s) => [s.d, ...s.parts.map((v) => (isCost ? usd(v) : dur(v * 3600e3)))])));
  }

  function groups(list, key, caption, label) {
    const by = new Map();
    for (const r of list) { const k = key(r); if (k != null) by.set(k, [...(by.get(k) ?? []), r]); }
    return table(caption, [label, 'Sessions', 'Median cost', 'Median time', 'Tests passed', 'PRs merged', 'Moved up'],
      [...by].sort((a, b) => b[1].length - a[1].length).map(([k, rs]) => {
        const tested = rs.filter((r) => r.tests), withPr = rs.filter((r) => r.prs.length), tiered = rs.filter((r) => r.tier);
        return [k, rs.length, usd(median(rs.map((r) => r.costUSD))), dur(median(rs.map((r) => r.busyMs))), pct(tested.filter((r) => r.tests === 'pass').length, tested.length),
          pct(withPr.filter((r) => r.prs.some((p) => p.state === 'merged')).length, withPr.length), pct(tiered.filter((r) => r.tier.movedUp).length, tiered.length)];
      }));
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
  const scrollStops = () => document.querySelectorAll('main > section').forEach((s) => (s.scrollWidth > s.clientWidth ? s.setAttribute('tabindex', '0') : s.removeAttribute('tabindex')));
  addEventListener('resize', () => { cancelAnimationFrame(last); last = requestAnimationFrame(() => { chart(current, days(current)); scrollStops(); }); });
  function renderTable(list) {
    const q = state.q;
    const shown = list.filter((r) => !q || [r.title, r.project, r.branch, setupKey(r), r.tier?.last, r.tier?.changeType, ...r.skills].some((x) => x && x.toLowerCase().includes(q))).slice(0, 300);
    const text = `${shown.length} of ${list.length} sessions${shown.length === 300 ? ' (first 300)' : ''}`;
    $('count').textContent = text;
    // Read out when typing settles, not on every key.
    clearTimeout(announced);
    announced = setTimeout(() => { $('count-live').textContent = text; }, 500);
    $('sessions').replaceChildren(table('Sessions, newest first', ['Started', 'Project', 'Title', 'Agent', 'Tier', 'Setup', 'Cost', 'Time', 'Tests', 'Pull requests'], shown.map((r) => [
      r.start.slice(0, 16).replace('T', ' '), (r.project ?? '').split('/').slice(-2).join('/'), r.title ?? '-', r.agent,
      r.tier ? `${r.tier.first}${r.tier.movedUp || r.tier.last !== r.tier.first ? ` to ${r.tier.last}` : ''}${r.tier.changeType ? ` (${r.tier.changeType})` : ''}` : '-',
      `${setupKey(r)}${r.setupVersion ? `, ${r.setupVersion}` : ''}`, usd(r.costUSD), dur(r.busyMs), r.tests ?? '-',
      r.prs.length ? r.prs.map((p) => `#${p.url.split('/').pop()} ${p.state}`).join(', ') : '-',
    ])));
    scrollStops();
  }

  function render() {
    // Whole UTC days, the same ones the chart draws: today and the days before it.
    const since = state.period === 'all' ? '' : day(new Date(now - (Number(state.period) - 1) * 864e5).toISOString());
    const list = rows.filter((r) => r.start >= since && FILTERS.every(([key, , f]) => !state[key] || matches(key, f, r)));
    const span = days(list);
    current = list;
    tiles(list, span);
    chart(list, span);
    $('by-tier').replaceChildren(groups(list, (r) => r.tier?.last ?? null, 'Sessions by tier (the last tier line)', 'Tier'));
    $('by-setup').replaceChildren(groups(list, setupKey, 'Sessions by setup', 'Setup'));
    $('by-change').replaceChildren(groups(list, (r) => (r.tier ? `${r.tier.first}: ${r.tier.changeType ?? 'no change type'}` : null), 'Moved up per first tier and change type (report only)', 'Tier and change type'));
    skills(list);
    renderTable(list);
  }
  render();
}

export const SCRIPT = `(${draw})();`;
export const SCRIPT_HASH = `sha256-${createHash('sha256').update(SCRIPT).digest('base64')}`;
// No requests at all; inline styles only; the script by its hash. The app adds frame-ancestors in its header.
export const CSP = `default-src 'none'; script-src '${SCRIPT_HASH}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;

const STYLE = `
:root { color-scheme: light; --page: #f8f9fa; --surface: #ffffff; --ink: #1a1b1e; --ink-2: #55565c; --grid: #e6e7e9; --line: #dee2e6;
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --other: #8a8984; --accent: #1c5cab; }
@media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) { color-scheme: dark; --page: #1a1b1e; --surface: #242424; --ink: #e9ecef;
  --ink-2: #b8bcc2; --grid: #373a40; --line: #424242; --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --other: #77766f; --accent: #86b6ef; } }
:root[data-theme="dark"] { color-scheme: dark; --page: #1a1b1e; --surface: #242424; --ink: #e9ecef; --ink-2: #b8bcc2; --grid: #373a40; --line: #424242;
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --other: #77766f; --accent: #86b6ef; }
* { box-sizing: border-box; }
body { margin: 0; padding: 16px; background: var(--page); color: var(--ink); font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; }
.head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
h1 { font-size: 20px; margin: 0; } h2 { font-size: 16px; margin: 0 0 8px; }
.muted, .note, caption, .tick { color: var(--ink-2); } .tick { fill: var(--ink-2); font-size: 11px; }
button, select, input { font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; }
#filters { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; margin: 12px 0; }
#filters label { color: var(--ink-2); } .f { display: inline-flex; gap: 6px; align-items: center; max-width: 100%; }
section { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin: 12px 0; overflow-x: auto; }
#tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
.tile { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
.tile .label { color: var(--ink-2); } .tile .value { font-size: 24px; font-weight: 600; } .note { font-size: 12px; }
#chart svg { display: block; }
#filters select { max-width: min(240px, 100%); }
#legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 6px 0; } .key { display: inline-flex; align-items: center; gap: 6px; }
.swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
caption { text-align: left; padding-bottom: 6px; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--grid); vertical-align: top; }
thead th { font-weight: 600; } tbody th { font-weight: 400; }
.rank { display: flex; align-items: center; gap: 8px; } .rank-bar { display: inline-block; height: 8px; border-radius: 0 4px 4px 0; background: var(--s1); max-width: 240px; flex: none; }
#tip { position: fixed; pointer-events: none; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; box-shadow: 0 2px 8px rgb(0 0 0 / 15%); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
details summary { cursor: pointer; color: var(--ink-2); margin-top: 6px; }
.row { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
`;

// rows: scanSessions output; now: an ISO time (the periods count back from it); registered: folders the Project filter
// offers as one choice, and preselects when a session ran in one.
export function boardHtml(rows, now = new Date().toISOString(), registered = []) {
  // JSON in a script element: < as <, so no value can close the element.
  const data = JSON.stringify({ rows, now, registered }).replace(/</g, '\\u003c');
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
<div class="head"><h1>Sessions board</h1><span class="muted">Claude Code and Codex sessions on this machine, read ${now.slice(0, 16).replace('T', ' ')} UTC</span><button id="theme" type="button">Light or dark</button></div>
<div id="filters" role="group" aria-label="Filters"></div>
<div id="tiles"></div>
<section aria-labelledby="h-chart"><div class="row"><h2 id="h-chart">Per day by setup</h2><label>Show <select id="metric"><option value="cost">Cost</option><option value="time">Agent time</option></select></label></div>
<div id="legend"></div><div id="chart"></div><details><summary>Table</summary><div id="chart-table"></div></details></section>
<section aria-labelledby="h-tier"><h2 id="h-tier">By tier</h2><div id="by-tier"></div></section>
<section aria-labelledby="h-setup"><h2 id="h-setup">By setup</h2><div id="by-setup"></div></section>
<section aria-labelledby="h-change"><h2 id="h-change">Moved up</h2><div id="by-change"></div></section>
<section aria-labelledby="h-skills"><h2 id="h-skills">Skills used</h2><div id="skills"></div></section>
<section aria-labelledby="h-sessions"><div class="row"><h2 id="h-sessions">Sessions</h2><label>Search <input id="search" type="search"></label></div><p id="count" class="muted"></p><span id="count-live" class="sr" role="status"></span><div id="sessions"></div></section>
</main>
<div id="tip" role="status" hidden></div>
<script type="application/json" id="data">${data}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

// The board as a file the user opens without the app (the tier band's Board button): rewritten by every scan.
export function writeBoard(ctx, rows, now) {
  const file = join(ctx.config, 'board.html');
  writeAtomic(file, boardHtml(rows, now, registeredPaths(ctx)), 0o600);
  return file;
}

// The app's registered projects with their Git worktrees, where sessions on a branch often run.
export function registeredPaths(ctx) {
  return [...new Set(listProjects(ctx).flatMap(({ path }) => {
    const r = ctx.run(['git', '-C', path, 'worktree', 'list', '--porcelain']);
    return [path, ...(r.code === 0 ? r.stdout.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9)) : [])];
  }))];
}
