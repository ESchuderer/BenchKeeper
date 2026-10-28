// The sessions board: one self-contained page. Rows go in as JSON data; one constant script draws the page, writes
// every transcript value through textContent, and builds the charts as plain SVG and CSS bars. Its hash is the page's script-src.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { writeAtomic } from './fsx.mjs';
import { MIN_SAMPLES } from './insights.mjs';
import { listProjects } from './projects.mjs';

// Runs in the browser only: toString() of this function is the page script. The UI tests cover it, not the unit coverage.
/* node:coverage disable */
function draw() {
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
  const projectKey = (r) => r.project ?? 'unknown';
  const short = (p) => p.split(/[\\/]/).slice(-2).join('/');
  const day = (iso) => iso.slice(0, 10);
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
  // A merged pull request counts once, on the day of its first session.
  const mergedPrs = (list) => {
    const m = new Map();
    for (const r of list) for (const p of r.prs) if (p.state === 'merged' && (!m.has(p.url) || day(r.start) < m.get(p.url))) m.set(p.url, day(r.start));
    return m;
  };

  // Theme: the query (the app passes its own), else the stored choice, else the system's.
  let stored = null;
  try { stored = localStorage.getItem('bk-board-theme'); } catch { /* storage blocked */ }
  const asked = new URLSearchParams(location.search).get('theme');
  const theme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
  theme(['light', 'dark'].includes(asked) ? asked : stored);
  // In the app's frame its heading, intro and theme button are the app's: the app sends the theme and takes the height.
  if (parent !== window) {
    document.documentElement.classList.add('framed');
    addEventListener('message', (e) => { if (e.source === parent && e.origin === location.origin && ['light', 'dark'].includes(e.data?.bkTheme)) theme(e.data.bkTheme); });
    new ResizeObserver(() => parent.postMessage({ bkBoardHeight: Math.ceil(document.body.getBoundingClientRect().height) }, location.origin)).observe(document.body);
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
  // Projects registered in the app and their worktrees; a leading space keeps the option apart from any path.
  const REGISTERED = ' registered';
  const listed = (r) => !!r.project && D.registered.some((p) => r.project === p || r.project.startsWith(`${p}/`) || r.project.startsWith(`${p}\\`));
  const FIRST = rows.some(listed) ? REGISTERED : '';
  const state = { period: '30', q: '', project: FIRST, hidden: new Set() };
  const matches = (key, f, r) => (key === 'project' && state.project === REGISTERED ? listed(r) : f(r) === state[key]);
  const bar = $('filters');
  for (const [key, label, f] of FILTERS) {
    const values = [...new Set(rows.map(f))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
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
  const details = (...kids) => el('details', {}, el('summary', {}, 'Table of values'), ...kids);
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
  const TOP = [...ranked].sort((a, b) => b[1] - a[1]).slice(0, SERIES).map(([k]) => k);
  // A filtered list of at most SERIES projects names them all; a project outside the top ones takes a color no shown top one uses.
  let named = TOP, extra = new Map();
  const slot = (r) => (named.includes(projectKey(r)) ? projectKey(r) : 'Other');
  const color = (k) => (k === 'Other' || (!TOP.includes(k) && !extra.has(k)) ? 'var(--other)' : `var(--s${(TOP.includes(k) ? TOP.indexOf(k) : extra.get(k)) + 1})`);
  const name = (k) => (k === 'Other' ? k : short(k));
  const assign = (list) => {
    const distinct = [...new Set(list.map(projectKey))];
    named = distinct.length <= SERIES ? distinct : TOP;
    const free = [...Array(SERIES).keys()].filter((i) => !distinct.includes(TOP[i]));
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

  // The change against the previous period of the same length, in words as well as an arrow.
  function change(cur, prev, unit) {
    if (prev == null || cur == null) return null;
    const len = state.period;
    const base = ` vs previous ${len} days`;
    const diff = unit === 'pts' ? Math.round(cur - prev) : prev ? Math.round(((cur - prev) / prev) * 100) : null;
    if (diff === 0 || (!prev && !cur)) return el('div', { class: 'delta' }, `no change${base}`);
    if (diff == null) return el('div', { class: 'delta' }, `none in the previous ${len} days`);
    return el('div', { class: 'delta' }, el('span', { 'aria-hidden': 'true' }, diff > 0 ? '▲ ' : '▼ '), `${diff > 0 ? 'up' : 'down'} ${Math.abs(diff)}${unit === 'pts' ? ' points' : '%'}${base}`);
  }

  function tiles(list, prev, span) {
    const recent = span.slice(-30), by = group(list, (r) => day(r.start));
    const per = (f) => recent.map((d) => f(by.get(d) ?? []));
    const stats = (l) => ({ sessions: l.length, time: sum(l.map((r) => r.busyMs)), cost: sum(l.map((r) => r.costUSD)), tokens: sum(l.map((r) => r.tokens)), pass: passRate(l).v, merged: mergedPrs(l).size });
    const cur = stats(list), old = prev && stats(prev);
    const codex = list.filter((r) => r.costUSD == null).length;
    const merged = mergedPrs(list);
    const items = [
      ['Sessions', 'sessions', String(cur.sessions), per((rs) => rs.length), null],
      ['Agent time', 'time', dur(cur.time), per((rs) => sum(rs.map((r) => r.busyMs))), 'API and tool time'],
      ['Cost', 'cost', usd(cur.cost), per((rs) => sum(rs.map((r) => r.costUSD))), `API-equivalent, Claude Code only${codex ? `; ${codex} sessions not recorded` : ''}`],
      ['Tokens', 'tokens', compact(cur.tokens), per((rs) => sum(rs.map((r) => r.tokens))), 'input, cache and output'],
      ['Tests passed', 'pass', cur.pass == null ? '-' : `${Math.round(cur.pass)}%`, per((rs) => passRate(rs).v), `of ${list.filter((r) => r.tests).length} sessions with a test run`],
      ['Merged pull requests', 'merged', String(cur.merged), recent.map((d) => [...merged.values()].filter((x) => x === d).length), 'by first session'],
    ];
    $('tiles').replaceChildren(...items.map(([label, key, value, series, note]) => el('div', { class: 'tile' },
      el('div', { class: 'label' }, label), el('div', { class: 'value num' }, value), sparkline(series), old && change(cur[key], old[key], key === 'pass' ? 'pts' : null), note && el('div', { class: 'note' }, note))));
  }

  // The project rail: newest activity first; a click filters everything below, a second click clears it.
  function rail(list) {
    const regOnly = state.project === REGISTERED || (state.project && listed({ project: state.project }));
    const by = group(list.filter((r) => !regOnly || listed(r)), projectKey);
    const span = [...Array(14).keys()].map((i) => iso(now - (13 - i) * DAY));
    const cards = [...by].map(([k, rs]) => ({ k, rs, newest: rs.reduce((a, r) => (r.start > a ? r.start : a), '') })).sort((a, b) => (a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : b.rs.length - a.rs.length));
    const choose = (v) => { state.project = state.project === v ? FIRST : v; $('f-project').value = state.project; render(); };
    $('rail').replaceChildren(
      el('button', { type: 'button', class: 'card all', 'aria-pressed': String(state.project === FIRST) }, FIRST ? 'Registered projects' : 'All projects'),
      ...cards.map(({ k, rs }) => {
        const days14 = group(rs, (r) => day(r.start));
        const tier = rs.find((r) => r.tier)?.tier.last;
        const b = el('button', { type: 'button', class: 'card', 'aria-pressed': String(state.project === k) },
          el('span', { class: 'dot', style: `background:${color(k)}` }), el('span', { class: 'pname' }, name(k)),
          el('span', { class: 'psub num' }, `${rs.length} session${rs.length === 1 ? '' : 's'}${tier ? `, last tier ${tier}` : ''}`),
          sparkline(span.map((d) => days14.get(d)?.length ?? 0), 80, 22));
        b.addEventListener('click', () => choose(k));
        return b;
      }));
    $('rail').firstChild.addEventListener('click', () => { state.project = FIRST; $('f-project').value = FIRST; render(); });
  }

  // The drawn chart, for the keyboard and the readout.
  let drawn = null;
  const METRICS = {
    cost: { label: 'Cost', value: (r) => r.costUSD ?? 0, text: money, axis: (v) => `$${compact(v)}`, floor: 1 },
    time: { label: 'Agent time', value: (r) => (r.busyMs ?? 0) / 3600e3, text: (v) => dur(v * 3600e3), axis: (v) => `${compact(v)}h`, floor: 0.5 },
    tokens: { label: 'Tokens', value: (r) => r.tokens ?? 0, text: compact, axis: compact, floor: 1000 },
    sessions: { label: 'Sessions', value: () => 1, text: String, axis: compact, floor: 2 },
  };
  function chart(list, span, keep = null) {
    drawn?.clear();
    $('chart-table').parentElement.hidden = false;
    const M = METRICS[metric.value];
    const { value, text } = M;
    const distinct = assign(list);
    const present = new Set(list.map(slot));
    const keys = [...TOP, ...extra.keys(), 'Other'].filter((k) => present.has(k) && (k === 'Other' || distinct.includes(k)));
    const shown = keys.filter((k) => !state.hidden.has(k));
    // One pass over the sessions: per day and series.
    const byDay = new Map();
    for (const r of list) {
      const d = day(r.start), m = byDay.get(d) ?? new Map(), k = slot(r);
      m.set(k, (m.get(k) ?? 0) + value(r));
      byDay.set(d, m);
    }
    const stacks = span.map((d) => ({ d, parts: keys.map((k) => (state.hidden.has(k) ? 0 : byDay.get(d)?.get(k) ?? 0)) }));
    // A round top tick: 1, 2 or 5 times a power of ten.
    const peak = Math.max(...stacks.map((s) => sum(s.parts)), M.floor), mag = 10 ** Math.floor(Math.log10(peak));
    const max = [1, 2, 5, 10].map((m) => m * mag).find((m) => m >= peak);
    // Drawn at the frame's width, so text keeps its size on a phone and a wide screen.
    const W = Math.max(300, $('chart').clientWidth), H = 220, L = 48, B = 24, T = 8;
    const step = (W - L) / Math.max(stacks.length, 1), bw = Math.max(2, Math.min(24, step - 4));
    const y = (v) => H - B - (v / max) * (H - B - T);
    const svg = el('svg:svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${M.label} per day by project; the table of values below has the numbers` });
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
      const items = byDay.has(s.d) ? [...keys.map((k, j) => s.parts[j] && el('span', { class: 'key' }, el('span', { class: 'swatch', style: `background:${color(k)}` }), `${name(k)} ${text(s.parts[j])}`)).filter(Boolean), el('span', {}, `Total ${text(total)}`)] : ['no sessions'];
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
        svg.append(el('svg:rect', { x, y: top, width: bw, height: h, rx: 2, fill: color(keys[k]), class: 'mark' }));
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
    c.setAttribute('tabindex', '0'); c.setAttribute('role', 'group'); c.setAttribute('aria-label', 'Per day by project. The left and right arrow keys read each day, Escape closes the reading.');
    // A chip hides or shows its series; the chart is drawn again with the same scale rules.
    $('legend').replaceChildren(...keys.map((k) => {
      const b = el('button', { type: 'button', class: 'key chip', 'aria-pressed': String(!state.hidden.has(k)) }, el('span', { class: 'swatch', style: `background:${color(k)}` }), name(k));
      b.addEventListener('click', () => { if (state.hidden.has(k)) state.hidden.delete(k); else state.hidden.add(k); chart(list, span, drawn?.active); $('legend').children[keys.indexOf(k)]?.focus(); });
      return b;
    }));
    $('chart').replaceChildren(svg);
    if (keep != null) choose(keep);
    $('chart-table').replaceChildren(table('Per day, days without sessions left out', ['Day', ...shown.map(name), 'Total'], stacks.filter((s) => byDay.has(s.d)).map((s) => [s.d, ...keys.flatMap((k, j) => (state.hidden.has(k) ? [] : [text(s.parts[j])])), text(sum(s.parts))])));
  }
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
    })), details(tableFor), ...(by.size > cap ? [el('p', { class: 'note' }, `The ${cap} groups with most sessions; the table has all ${by.size}.`)] : []));
  }
  const CMP = [
    { title: 'Median agent time per session', f: medianOf((r) => r.busyMs), fmt: dur },
    { title: 'Median cost per session', f: medianOf((r) => r.costUSD), fmt: money },
    { title: 'Tests passed', f: passRate, fmt: (v) => `${Math.round(v)}%` },
  ];

  function groups(list, key, caption, label) {
    const by = group(list, key);
    return table(caption, [label, 'Sessions', 'Median cost', 'Median time', 'Tests passed', 'PRs merged', 'Moved up'],
      [...by].sort((a, b) => b[1].length - a[1].length).map(([k, rs]) => {
        const tested = rs.filter((r) => r.tests), withPr = rs.filter((r) => r.prs.length), tiered = rs.filter((r) => r.tier);
        return [k, rs.length, money(median(rs.map((r) => r.costUSD))), dur(median(rs.map((r) => r.busyMs))), pct(tested.filter((r) => r.tests === 'pass').length, tested.length),
          pct(withPr.filter((r) => r.prs.some((p) => p.state === 'merged')).length, withPr.length), pct(tiered.filter((r) => r.tier.movedUp).length, tiered.length)];
      }));
  }

  // Weeks counted back from today, the oldest first; cost and merged pull requests over time.
  const week = (r) => Math.floor((dayStart(now) - dayStart(Date.parse(r.start))) / (7 * DAY));
  const weekLabel = (w) => `week of ${iso(dayStart(now) - (w * 7 + 6) * DAY)}`;
  function weekly(list) {
    const by = group(list, week), order = [...by.keys()].sort((a, b) => b - a).slice(-26);
    const merged = mergedPrs(list);
    const wk = new Map(); for (const [, d] of merged) { const w = Math.floor((dayStart(now) - Date.parse(d)) / (7 * DAY)); wk.set(w, (wk.get(w) ?? 0) + 1); }
    const prs = order.map((w) => { const rs = by.get(w), n = wk.get(w) ?? 0, c = sum(rs.map((r) => r.costUSD)); return { w, rs, n, v: n ? c / n : null }; });
    const max = Math.max(...prs.map((p) => p.v ?? 0), 1e-9);
    $('by-prpr').replaceChildren(bars(prs.map((p) => ({ label: weekLabel(p.w), n: p.rs.length, frac: (p.v ?? 0) / max, text: p.v == null ? 'no merged pull request' : `${money(p.v)} (${p.n} merged)`, low: p.rs.length < MIN }))),
      details(table('Cost per merged pull request by week', ['Week', 'Sessions', 'Merged pull requests', 'Cost', 'Cost per merged pull request'], prs.map((p) => [weekLabel(p.w), p.rs.length, p.n, usd(sum(p.rs.map((r) => r.costUSD))), p.v == null ? '-' : money(p.v)]))));
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
      details(table('Share of sessions by model and week', ['Week', ...keys], mix.map((x) => [weekLabel(x.w), ...keys.map((m) => pct(x.share.get(m) ?? 0, x.n))]))));
  }

  // Histograms: sessions per bin, the bin holding the median marked.
  function histogram(id, vals, edges, labels, fmt, title) {
    const counts = labels.map(() => 0), bin = (v) => edges.findIndex((e, i) => v < edges[i + 1]);
    for (const v of vals) counts[bin(v)]++;
    const med = median(vals), mb = med == null ? -1 : bin(med), max = Math.max(...counts, 1);
    $(id).replaceChildren(el('h3', {}, title), el('p', { class: 'note num' }, `Median ${med == null ? 'not recorded' : fmt(med)} over ${vals.length} sessions`),
      bars(labels.map((l, i) => ({ label: i === mb ? `${l} (median)` : l, n: counts[i], frac: counts[i] / max, text: String(counts[i]), mark: i === mb }))),
      details(table(title, ['Bin', 'Sessions'], labels.map((l, i) => [l, counts[i]]))));
  }

  // Twelve weeks of agent time per day, weeks as columns from Monday.
  function calendar(list) {
    const today = dayStart(now), dow = (new Date(today).getUTCDay() + 6) % 7, first = today - dow * DAY - 11 * 7 * DAY;
    const by = group(list.filter((r) => Date.parse(day(r.start)) >= first), (r) => day(r.start));
    const busy = (d) => sum((by.get(d) ?? []).map((r) => r.busyMs));
    const nz = [...by.keys()].map(busy).filter((v) => v > 0).sort((a, b) => a - b);
    const level = (v) => (v <= 0 ? 0 : 1 + [0.25, 0.5, 0.75].filter((q) => v > nz[Math.floor(q * (nz.length - 1))]).length);
    const C = 14, G = 3, L = 18, W = L + 12 * (C + G), H = 7 * (C + G) + 4;
    const svg = el('svg:svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Agent time per day over the last 12 weeks; the table of values below has the numbers', class: 'cal' });
    ['Mon', 'Wed', 'Fri'].forEach((t, i) => svg.append(el('svg:text', { x: 0, y: (i * 2) * (C + G) + C - 2, class: 'tick' }, t[0])));
    let active = 0, streak = 0, longest = 0;
    const lines = [];
    for (let c = 0; c < 12; c++) for (let r = 0; r < 7; r++) {
      const t = first + (c * 7 + r) * DAY;
      if (t > today) { streak = 0; continue; }
      const d = iso(t), v = busy(d), has = by.has(d);
      streak = has ? streak + 1 : 0; longest = Math.max(longest, streak);
      if (has) { active++; lines.push([d, by.get(d).length, dur(v)]); }
      svg.append(el('svg:rect', { x: L + c * (C + G), y: r * (C + G), width: C, height: C, rx: 4, fill: level(v) ? 'var(--accent)' : 'var(--grid)', 'fill-opacity': level(v) ? [0, 0.3, 0.5, 0.75, 1][level(v)] : 1, class: 'mark' }, el('svg:title', {}, `${d}: ${has ? dur(v) : 'no sessions'}`)));
    }
    $('calendar').replaceChildren(el('p', { class: 'note num' }, `${active} active days of 84, longest streak ${longest} day${longest === 1 ? '' : 's'}`), el('div', { class: 'scroll' }, svg),
      details(table('Days with sessions in the last 12 weeks', ['Day', 'Sessions', 'Agent time'], lines.reverse())));
  }

  // One project: its branches and the states of its pull requests (every period).
  function projectPage(list) {
    const s = $('project-page'), k = state.project;
    s.hidden = !k || k === REGISTERED;
    if (s.hidden) return;
    const prs = new Map();
    for (const r of list) for (const p of r.prs) prs.set(p.url, p.state);
    const states = [...group([...prs].map(([url, st]) => ({ st })), (x) => x.st)].map(([st, xs]) => `${xs.length} ${st}`).join(', ');
    $('project-title').textContent = `Project ${short(k)}`;
    $('project-body').replaceChildren(el('p', { class: 'note num' }, `${list.length} sessions, ${prs.size} pull requests${states ? `: ${states}` : ''}`),
      list.length ? table('Branches, newest first', ['Branch', 'Sessions', 'Last session', 'Pull requests'], [...group(list, (r) => r.branch ?? '-')].map(([b, rs]) => {
        const ps = new Map(); for (const r of rs) for (const p of r.prs) ps.set(p.url, p.state);
        return [b, rs.length, rs.reduce((a, r) => (r.start > a ? r.start : a), '').slice(0, 10), [...ps].map(([u, st]) => `#${u.split('/').pop()} ${st}`).join(', ') || '-'];
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
    $('sessions').replaceChildren(!shown.length ? el('p', { class: 'muted' }, 'No sessions match.') : table('Sessions, newest first', ['Started', 'Project', 'Title', 'Agent', 'Tier', 'Pattern', 'Setup', 'Cost', 'Time', 'Tests', 'Pull requests'], shown.map((r) => [
      r.start.slice(0, 16).replace('T', ' '), short(r.project ?? ''), r.title ?? '-', r.agent,
      r.tier ? `${r.tier.first}${r.tier.movedUp || r.tier.last !== r.tier.first ? ` to ${r.tier.last}` : ''}${r.tier.changeType ? ` (${r.tier.changeType})` : ''}` : '-',
      `${patternKey(r)}${r.subagents ? `, ${r.subagents} subagent${r.subagents > 1 ? 's' : ''}` : ''}${r.run ? `, run ${r.run}` : ''}`,
      `${setupKey(r)}${r.setupVersion ? `, ${r.setupVersion}` : ''}`, money(r.costUSD), dur(r.busyMs), r.tests ?? '-',
      r.prs.length ? r.prs.map((p) => `#${p.url.split('/').pop()} ${p.state}`).join(', ') : '-',
    ])));
    scrollStops();
  }

  const CHARTS = ['chart', 'by-tier', 'by-pattern', 'by-setup', 'by-prpr', 'by-model', 'dist-time', 'dist-turns', 'calendar', 'by-change', 'skills'];
  function render() {
    // Whole UTC days, the same ones the chart draws: today and the days before it.
    const len = state.period === 'all' ? null : Number(state.period);
    const since = len ? iso(now - (len - 1) * DAY) : '';
    const before = len ? iso(now - (2 * len - 1) * DAY) : '';
    const others = (r) => FILTERS.every(([key, , f]) => !state[key] || matches(key, f, r));
    const base = rows.filter(others);
    const list = base.filter((r) => r.start >= since);
    const prev = len ? base.filter((r) => day(r.start) >= before && day(r.start) < since) : null;
    assign(list);
    // The rail leaves the project filter out, so every project of the period stays a choice.
    rail(rows.filter((r) => r.start >= since && FILTERS.every(([key, , f]) => key === 'project' || !state[key] || matches(key, f, r))));
    const span = days(list);
    current = list;
    tiles(list, prev, span);
    projectPage(base);
    if (!list.length) {
      // One sentence per section instead of header-only tables and an empty axis.
      drawn = null;
      for (const a of ['tabindex', 'role', 'aria-label']) $('chart').removeAttribute(a);
      for (const id of CHARTS) $(id).replaceChildren(el('p', { class: 'muted' }, 'No sessions match these filters.'));
      for (const id of ['legend', 'chart-table', 'tip', 'tip-live']) $(id).replaceChildren();
      $('chart-table').parentElement.hidden = true;
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
    $('by-change').replaceChildren(groups(list, (r) => (r.tier ? `${r.tier.first}: ${r.tier.changeType ?? 'no change type'}` : null), 'Moved up per first tier and change type (report only)', 'Tier and change type'));
    skills(list);
    renderTable(list);
  }
  render();
}
/* node:coverage enable */

export const SCRIPT = `(${draw})();`;
export const SCRIPT_HASH = `sha256-${createHash('sha256').update(SCRIPT).digest('base64')}`;
// No requests at all; inline styles only; the script by its hash. The app adds frame-ancestors in its header.
export const CSP = `default-src 'none'; script-src '${SCRIPT_HASH}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;

// Tokens first: the colors per theme, then the shape, shadow and type every panel shares.
const STYLE = `
:root { color-scheme: light; --page: #f4f6fa; --surface: #ffffff; --ink: #1a1b1e; --ink-2: #55565c; --grid: #e6e7e9; --line: #dde1e8;
  --s1: #2a78d6; --s2: #d9531c; --s3: #0a8f5e; --s4: #a86b00; --s5: #7a4fd1; --s6: #c22a7a; --other: #8a8984; --accent: #1c5cab;
  --glow: rgba(42, 120, 214, 0.1); --shadow: 0 1px 2px rgba(20, 24, 40, 0.06), 0 8px 24px rgba(20, 24, 40, 0.07); }
@media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) { color-scheme: dark; --page: #17181c; --surface: #242424; --ink: #e9ecef;
  --ink-2: #b8bcc2; --grid: #373a40; --line: #3d4047; --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #a98af0; --s6: #e0629f; --other: #8d8c85; --accent: #86b6ef;
  --glow: rgba(57, 135, 229, 0.16); --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35); } }
:root[data-theme="dark"] { color-scheme: dark; --page: #17181c; --surface: #242424; --ink: #e9ecef; --ink-2: #b8bcc2; --grid: #373a40; --line: #3d4047;
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #a98af0; --s6: #e0629f; --other: #8d8c85; --accent: #86b6ef;
  --glow: rgba(57, 135, 229, 0.16); --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35); }
:root { --radius: 16px; --radius-sm: 10px; --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; --ease: 150ms ease; }
* { box-sizing: border-box; }
body { margin: 0; padding: 16px; background: var(--page); color: var(--ink); font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
.head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
h1 { font-size: 22px; letter-spacing: -0.01em; margin: 0; } h2 { font-size: 16px; margin: 0 0 10px; } h3 { font-size: 13px; margin: 0 0 8px; color: var(--ink-2); font-weight: 600; }
.muted, .note, caption, .tick { color: var(--ink-2); } .tick { fill: var(--ink-2); font-size: 11px; }
.num, .tick { font-family: var(--mono); font-variant-numeric: tabular-nums; }
button, select, input { font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 5px 10px; }
button { cursor: pointer; transition: border-color var(--ease), transform var(--ease), box-shadow var(--ease); }
button:hover { border-color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
#filters { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; margin: 12px 0; }
#filters label { color: var(--ink-2); } .f { display: inline-flex; gap: 6px; align-items: center; max-width: 100%; }
#filters select { max-width: min(240px, 100%); }
.layout { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 16px; align-items: start; }
#rail { display: flex; flex-direction: column; gap: 8px; position: sticky; top: 8px; max-height: calc(100vh - 16px); overflow-y: auto; padding: 4px; margin: -4px; }
.framed #rail { position: static; max-height: none; }
.card { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; align-items: center; text-align: left; width: 100%; padding: 10px 12px; border-radius: var(--radius); box-shadow: var(--shadow); }
.card.all { display: block; font-weight: 600; } .card:hover { transform: translateY(-1px); }
.card[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent), var(--shadow); }
.pname { font-weight: 600; overflow-wrap: anywhere; } .psub { grid-column: 2; font-size: 12px; color: var(--ink-2); } .card .spark { grid-column: 2; }
.dot { width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 0 3px var(--glow); }
section { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px; margin: 0 0 16px; overflow-x: auto; }
#tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
.tile { position: relative; isolation: isolate; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 12px 14px; overflow: hidden; transition: transform var(--ease); }
.tile::before { content: ''; position: absolute; inset: -30% -20% auto auto; width: 70%; height: 90%; background: radial-gradient(closest-side, var(--glow), transparent); z-index: -1; }
.tile:hover { transform: translateY(-1px); }
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
.row { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
@media (max-width: 760px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  #rail { flex-direction: row; overflow-x: auto; overflow-y: hidden; position: static; max-height: none; padding-bottom: 8px; }
  .card { width: auto; min-width: 150px; max-width: 230px; flex: none; } .card .spark { display: none; }
  .bars { grid-template-columns: minmax(0, 1fr); } .bars li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 4px 10px; align-items: center; } .bar-track { grid-column: 1 / -1; order: 3; }
}
@media (prefers-reduced-motion: reduce) { *, ::before, ::after { transition: none !important; animation: none !important; } }
`;

// rows: scanSessions output; now: an ISO time (the periods count back from it); registered: folders the Project filter
// offers as one choice, and preselects when a session ran in one.
export function boardHtml(rows, now = new Date().toISOString(), registered = []) {
  // JSON in a script element: < as <, so no value can close the element.
  const data = JSON.stringify({ rows, now, registered, minSamples: MIN_SAMPLES }).replace(/</g, '\\u003c');
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
<div class="head"><h1>Sessions board</h1><span class="muted"><span class="lead">Claude Code and Codex sessions on this machine, read </span><span class="framed-only">Read </span>${now.slice(0, 16).replace('T', ' ')} UTC</span><button id="theme" type="button">Light or dark</button></div>
<p class="muted">Sessions older than the agent's transcript cleanup period come from the app's cache of summaries, which starts when the app first scanned.</p>
<div id="filters" role="group" aria-label="Filters"></div>
<div class="layout">
<nav id="rail" aria-label="Projects"></nav>
<div class="content">
<div id="tiles"></div>
<section aria-labelledby="h-chart"><div class="row"><h2 id="h-chart">Per day by project</h2><label>Show <select id="metric"><option value="cost">Cost</option><option value="time">Agent time</option><option value="tokens">Tokens</option><option value="sessions">Sessions</option></select></label></div>
<div id="legend"></div><div id="chart" tabindex="0" role="group" aria-label="Per day by project. The left and right arrow keys read each day, Escape closes the reading."></div><div id="tip"></div><span id="tip-live" class="sr" role="status"></span><details><summary>Table of values</summary><div id="chart-table"></div></details></section>
<section id="project-page" aria-labelledby="project-title" hidden><h2 id="project-title"></h2><div id="project-body"></div></section>
<section aria-labelledby="h-tier"><h2 id="h-tier">Tier against outcome</h2><p class="note">n is the sessions a bar rests on. A bar under ${MIN_SAMPLES} is hatched and left out of the highest and lowest line.</p><div id="by-tier"></div></section>
<section aria-labelledby="h-pattern"><h2 id="h-pattern">By pattern</h2><div id="by-pattern"></div></section>
<section aria-labelledby="h-setup"><h2 id="h-setup">By setup</h2><div id="by-setup"></div></section>
<section aria-labelledby="h-prpr"><h2 id="h-prpr">Cost per merged pull request</h2><p class="note">Cost of the week's sessions divided by the pull requests merged that week (by first session); n is the week's sessions.</p><div id="by-prpr"></div></section>
<section aria-labelledby="h-model"><h2 id="h-model">Model mix</h2><div id="by-model"></div></section>
<section aria-labelledby="h-dist"><h2 id="h-dist">Distribution</h2><div class="cmps"><div id="dist-time"></div><div id="dist-turns"></div></div></section>
<section aria-labelledby="h-cal"><h2 id="h-cal">Activity, last 12 weeks</h2><div id="calendar"></div></section>
<section aria-labelledby="h-change"><h2 id="h-change">Moved up</h2><div id="by-change"></div></section>
<section aria-labelledby="h-skills"><h2 id="h-skills">Skills used</h2><div id="skills"></div></section>
<section aria-labelledby="h-sessions"><div class="row"><h2 id="h-sessions">Sessions</h2><label>Search <input id="search" type="search"></label></div><p id="count" class="muted"></p><span id="count-live" class="sr" role="status"></span><div id="sessions"></div></section>
</div>
</div>
</main>
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
