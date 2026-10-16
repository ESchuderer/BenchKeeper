// Reference app for the cartridges brief: validates the hidden tests, not a model answer.
const DATA = window.CARTRIDGES;
const FAMILIES = ['rimless', 'rimmed', 'belted', 'pistol', 'rimfire'];
const LABELS = { eMin: 'e min', r1Min: 'r1 min', r1Max: 'r1 max', alpha: 'α', alpha1: 'α1', beta: 'β', delta: 'δ', deltaL: 'delta L', L3PlusG: 'L3 + G' };
const UNITS = { Pmax: 'bar', PK: 'bar', PE: 'bar', EE: 'J', M: 'g', Q: 'mm²', N: '', alpha: '', alpha1: '', beta: '', delta: '', i: '' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const deg = (a) => (a == null ? null : typeof a === 'number' ? a : a.degrees + a.minutes / 60 + a.seconds / 3600);
const show = (v) => (typeof v === 'object' ? `${v.degrees}°${v.minutes}'${v.seconds}"` : String(v));
const rad = (d) => (d * Math.PI) / 180;
const app = document.getElementById('app');

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === 'text' ? (e.textContent = v) : e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

function renderList() {
  document.title = 'Cartridges';
  const search = el('input', { id: 'q', type: 'search' });
  const family = el('select', { id: 'f' }, el('option', { value: '', text: 'All' }), ...FAMILIES.map((f) => el('option', { value: f, text: f })));
  const count = el('p', { 'aria-live': 'polite' });
  const list = el('ul', { class: 'list' });
  const update = () => {
    const q = search.value.trim().toLowerCase();
    const shown = DATA.filter((c) => (!family.value || c.family === family.value)
      && [c.name, ...(c.alternativeNames || [])].some((n) => n.toLowerCase().includes(q)));
    list.replaceChildren(...shown.map((c) => el('li', {}, el('a', { href: `#${c.key}`, text: c.name }),
      el('span', { class: 'muted', text: ` ${c.family}, L3 ${c.cartridge.lengths.L3} mm` }))));
    count.textContent = `${shown.length} cartridges`;
  };
  search.addEventListener('input', update);
  family.addEventListener('change', update);
  app.replaceChildren(el('h1', { text: 'Cartridges' }),
    el('p', {}, el('label', { for: 'q', text: 'Search ' }), search, ' ', el('label', { for: 'f', text: 'Family ' }), family),
    count, list);
  update();
}

// The outer half-profile as [z, r] points, head face to mouth (brief rules 1 to 6).
function outline(c) {
  const k = c.cartridge, h = k.caseHead || {}, pc = k.powderChamber || {}, L = k.lengths, col = k.collar || {}, j = k.junctionCone || {};
  const R1 = h.R1 / 2, P1 = pc.P1 / 2;
  const ratio = h.R1 / pc.P1;
  const rim = c.family === 'belted' ? 'belted' : c.family === 'rimfire' ? 'rimfire' : ratio >= 1.05 ? 'rimmed' : ratio < 0.98 ? 'rebated' : 'rimless';
  const pts = [[0, 0]];
  const beta = deg(h.beta);
  if (rim === 'rimfire') {
    const q = Math.min(h.R / 2, (h.R1 - pc.P1) / 2);
    for (let i = 0; i <= 12; i++) { const t = (Math.PI * i) / 12; pts.push([q - q * Math.cos(t), R1 - q + q * Math.sin(t)]); }
    pts.push([h.R, R1 - q]);
  } else if (beta && h.f && beta < 90) {
    pts.push([0, R1 - Math.min(h.f * Math.tan(rad(beta)), R1 / 2)], [h.f, R1], [h.R, R1]);
  } else pts.push([0, R1], [h.R, R1]);
  if (h.E != null && h.E1 != null) {
    const floor = h.R + (h.eMin ?? 0);
    pts.push([h.R, h.E1 / 2], [floor, h.E1 / 2]);
    if (rim === 'belted') {
      const run = (h.R3 - h.E1) / 2 / Math.tan(rad(deg(h.delta) || 90));
      pts.push([floor + run, h.R3 / 2], [h.E, h.R3 / 2], [h.E, P1]);
    } else pts.push([h.E, P1]);
  } else pts.push([h.R, P1]);
  if (j.alpha != null && L.L1 != null && L.L2 != null) {
    pts.push([L.L1, pc.P2 / 2], [L.L2, (L.L2 < L.L3 ? col.H1 : col.H2) / 2]);
  }
  pts.push([L.L3, col.H2 / 2]);
  return { pts, rim };
}

// Exposed bullet from the mouth to L6 (rule 7), as [z, r] points ending on the axis.
function bullet(c) {
  const k = c.cartridge, L = k.lengths, G = k.projectile.G1 / 2, H2 = k.collar.H2 / 2;
  const shape = c.annotations.defaultBulletShape, pistol = c.family === 'pistol';
  const s = { pointy: 1, semi_wadcutter: 0.6 }[shape] ?? (pistol ? 0.4 : 0.8);
  const kk = { pointy: 0.4, semi_wadcutter: 0.78, rounded: pistol ? 0.65 : 0.55, flat: pistol ? 0.7 : 0.6 }[shape];
  const zb = L.L3 - s * 2 * G, zs = Math.max(zb + kk * (L.L6 - zb), L.L3), n = L.L6 - zs;
  const m = shape === 'pointy' ? Math.max(0.08 * 2 * G, 1.27) / 2 : shape === 'rounded' ? 0.15 * G : shape === 'flat' ? 0.55 * G : 0.6 * G;
  const r0 = Math.max(G, H2 - 0.015 <= G ? H2 : G);
  const pts = [[L.L3, r0], [zs, r0]];
  for (let i = 1; i <= 16; i++) {
    const z = zs + (n * i) / 16, d = r0 - m;
    let r;
    if (shape === 'pointy') { const rho = (d * d + n * n) / (2 * d); r = r0 - rho + Math.sqrt(Math.max(rho * rho - (z - zs) ** 2, 0)); }
    else if (shape === 'rounded') r = m + d * Math.sqrt(Math.max(1 - ((z - zs) / n) ** 2, 0));
    else r = r0 - (d * (z - zs)) / n;
    pts.push([z, r]);
  }
  pts.push([L.L6, 0]);
  return pts;
}

function drawingSvg(c) {
  const L = c.cartridge.lengths, h = c.cartridge.caseHead, pc = c.cartridge.powderChamber, col = c.cartridge.collar;
  const { pts } = outline(c), b = bullet(c);
  const maxR = Math.max(...pts.map((p) => p[1]));
  const x0 = 8, top = maxR + 14, W = L.L6 + 20, H = 2 * maxR + 34, x = (z) => x0 + z;
  const path = (ps, sign) => ps.map(([z, r], i) => `${i ? 'L' : 'M'}${x(z).toFixed(2)} ${(top - sign * r).toFixed(2)}`).join(' ');
  const t = (px, py, s, anchor = 'middle') => `<text x="${px.toFixed(2)}" y="${py.toFixed(2)}" text-anchor="${anchor}">${esc(s)}</text>`;
  const hdim = (z1, z2, y, label) => `<line x1="${x(z1)}" y1="${y}" x2="${x(z2)}" y2="${y}" marker-start="url(#a)" marker-end="url(#a)"/>`
    + `<line x1="${x(z2)}" y1="${y - 1}" x2="${x(z2)}" y2="${top}" class="ext"/>` + t(x((z1 + z2) / 2), y - 0.6, label);
  const vdim = (z, d, label) => `<line x1="${x(z)}" y1="${top - d / 2}" x2="${x(z)}" y2="${top + d / 2}" marker-start="url(#a)" marker-end="url(#a)"/>`
    + t(x(z), top + maxR + 4 + (vdim.n++ % 2) * 3, label);
  vdim.n = 0;
  const dims = [hdim(0, L.L3, top - maxR - 3, `L3 ${L.L3}`), hdim(0, L.L6, top - maxR - 8, `L6 ${L.L6}`),
    L.L1 != null ? hdim(0, L.L1, top - maxR - 13, `L1 ${L.L1}`) : '',
    vdim(h.R / 2, h.R1, `R1 ${h.R1}`), vdim(h.E ?? h.R, pc.P1, `P1 ${pc.P1}`),
    pc.P2 != null && L.L1 != null ? vdim(L.L1, pc.P2, `P2 ${pc.P2}`) : '', vdim(L.L3, col.H2, `H2 ${col.H2}`)];
  const j = c.cartridge.junctionCone;
  const alpha = j?.alpha != null && L.L1 != null ? t(x((L.L1 + L.L2) / 2), top - maxR + 2.5, `α ${show(j.alpha)}`) : '';
  return `<svg class="drawing" role="img" aria-label="${esc(c.name)} drawing" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}" xmlns="http://www.w3.org/2000/svg">`
    + '<defs><marker id="a" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="2" markerHeight="2" orient="auto-start-reverse"><path d="M0 0L6 3L0 6z" fill="currentColor"/></marker>'
    + '<pattern id="hatch" width="1" height="1" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1" stroke="currentColor" stroke-width="0.15"/></pattern></defs>'
    + '<g fill="none" stroke="currentColor" stroke-width="0.25">'
    + `<path d="${path(pts, 1)} ${path([...b], 1).replace('M', 'L')}"/>`
    + `<path d="${path(pts, -1)} ${path([...b], -1).replace('M', 'L')}" fill="url(#hatch)"/>`
    + `<line x1="${x0 - 3}" y1="${top}" x2="${x(L.L6) + 3}" y2="${top}" stroke-dasharray="3 1 0.5 1" stroke-width="0.15"/>`
    + `</g><g stroke="currentColor" stroke-width="0.15" font-size="2.2" fill="currentColor" font-family="sans-serif">${dims.join('')}${alpha}</g>`
    + `<text x="${x0}" y="${H - 1}" font-size="2" fill="currentColor">${esc(c.name)}, C.I.P. Tab. ${esc(c.tab)}, revised ${esc(c.revised)}. Dimensions in mm, scale 1 unit = 1 mm.</text></svg>`;
}

function table(title, fields) {
  const rows = Object.entries(fields).filter(([f]) => !f.endsWith('Tol')).map(([f, v]) => el('tr', {},
    el('th', { scope: 'row', text: LABELS[f] ?? f }),
    el('td', { text: show(v) + (fields[`${f}Tol`] != null ? ` ${fields[`${f}Tol`]}` : '') }),
    el('td', { text: UNITS[f] ?? 'mm' })));
  return el('table', {}, el('caption', { text: title }),
    el('thead', {}, el('tr', {}, ...['Symbol', 'Value', 'Unit'].map((s) => el('th', { scope: 'col', text: s })))), el('tbody', {}, ...rows));
}

function renderDetail(c) {
  document.title = `${c.name} - Cartridges`;
  const a = c.annotations, cap = a.publishedCapacity;
  const meta = el('dl', {}, ...[['Alternative names', (c.alternativeNames || []).join(', ') || 'none'], ['Family', c.family], ['Category', a.category],
    ['Primer', a.primerType], ['C.I.P. table', c.tab], ['Country', c.country], ['Published', c.published], ['Revised', c.revised],
    ['Pressure method', c.pressureMethod]].flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v ?? '' })]));
  if (cap) meta.append(el('dt', { text: 'Water capacity' }), el('dd', {}, `${cap.grH2O} gr H2O `, el('a', { href: cap.url, text: cap.source })));
  const fig = el('figure', {});
  fig.innerHTML = drawingSvg(c);
  const print = el('button', { type: 'button', class: 'screen-only', text: 'Print' });
  print.addEventListener('click', () => window.print());
  const tables = el('div', { class: 'tables' },
    ...Object.entries(c.cartridge).map(([s, f]) => table(`Cartridge: ${s}`, f)),
    ...Object.entries(c.chamber || {}).map(([s, f]) => table(`Chamber: ${s}`, f)));
  app.replaceChildren(el('p', { class: 'screen-only' }, el('a', { href: '#', text: 'All cartridges' }), ' ', print),
    el('h1', { text: c.name }), meta, fig, tables, el('p', { text: `Source: C.I.P. TDCC, revised ${c.revised}.` }));
}

function route() {
  const c = DATA.find((x) => x.key === decodeURIComponent(location.hash.slice(1)));
  c ? renderDetail(c) : renderList();
  window.scrollTo(0, 0);
}

addEventListener('DOMContentLoaded', () => {
  addEventListener('hashchange', route);
  route();
});
