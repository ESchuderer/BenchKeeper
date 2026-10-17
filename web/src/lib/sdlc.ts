// Builds the SDLC loop SVG from facts.json at build time.
import facts from '../data/facts.json';

const C = 320;
const R = 220;
const { steps, phases, requirements } = facts.sdlc;

// The ring places the steps evenly (6 steps: 60 degrees each), each phase a contiguous run of steps.
if (steps.length < 4 || steps.length > 10) throw new Error(`facts.sdlc.steps must have 4 to 10 entries, found ${steps.length}`);
const step = 360 / steps.length;
for (const p of phases) {
  const idx = steps.map((s, k) => (s.phase === p.key ? k : -1)).filter((k) => k >= 0);
  if (!idx.length || idx[idx.length - 1] - idx[0] !== idx.length - 1) throw new Error(`phase ${p.key} must own a contiguous, non-empty run of steps`);
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n: number) => n.toFixed(1);

function pt(deg: number, r = R): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
}

function arc(a0: number, a1: number) {
  const [x0, y0] = pt(a0);
  const [x1, y1] = pt(a1);
  const large = (((a1 - a0) % 360) + 360) % 360 > 180 ? 1 : 0;
  return `M${f(x0)} ${f(y0)}A${R} ${R} 0 ${large} 1 ${f(x1)} ${f(y1)}`;
}

const reqTip = esc(`Requirements: ${requirements}`);
const humans = steps.map((s) => (s.human ? `${s.name} (${s.human})` : '')).filter(Boolean).join(', ');

const o: string[] = [
  '<svg class="ring" viewBox="-140 -90 920 750" role="group" aria-labelledby="ring-t ring-d">',
  '<title id="ring-t">BenchKeeper SDLC loop</title>',
  `<desc id="ring-d">${esc(`Requirements from people and from Maintain findings enter at step 1. ${steps.length} steps in a clockwise loop, in four phases: ${phases.map((p) => `${p.name}: ${steps.filter((s) => s.phase === p.key).map((s) => s.name).join(', ')}`).join('. ')}. Human in the loop: ${humans}.`)}</desc>`,
  '<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0L10 5 0 10z"/></marker></defs>',
  `<circle class="track" cx="${C}" cy="${C}" r="${R}"/>`,
];

for (const p of phases) {
  const idx = steps.map((s, k) => (s.phase === p.key ? k : -1)).filter((k) => k >= 0);
  const a0 = idx[0] * step - step * 0.36;
  const a1 = idx[idx.length - 1] * step + step * 0.36;
  const [x, y] = pt((a0 + a1) / 2, 145);
  o.push(`<path class="phase ${p.key}" d="${arc(a0, a1)}"/>`);
  o.push(`<text class="ph-l ${p.key}" x="${f(x)}" y="${f(y + 4)}" text-anchor="middle">${p.name.toUpperCase()}</text>`);
}
steps.forEach((_, k) => {
  const [x, y] = pt(k * step + step / 2);
  o.push(`<path class="chev" d="M-3-5L3 0-3 5" transform="translate(${f(x)} ${f(y)}) rotate(${k * step + step / 2})"/>`);
});

// Requirements box fed by people (right) and Maintain findings (left); both link to step 1, which lists the sources.
o.push(`<a class="req" href="#step-1" data-tip="${reqTip}" aria-label="${reqTip}"><rect x="225" y="-80" width="190" height="48" rx="24"/>`
  + '<text class="req-t" x="320" y="-50" text-anchor="middle">Requirements</text></a>');
o.push('<path class="flow" d="M320 -32V64" marker-end="url(#ah)"/>');
o.push('<path class="flow back" d="M174 114C120 30 160 -56 222 -56" marker-end="url(#ah)"/>');
o.push('<text class="flow-t" x="118" y="20" text-anchor="end">findings</text>');
o.push('<path class="flow" d="M512 -56H426" marker-end="url(#ah)"/>');
o.push(`<a class="human" href="#step-1" data-tip="${reqTip}" aria-label="${reqTip}"><circle class="hit" cx="541" cy="-56" r="28"/><circle class="you-ring" cx="541" cy="-56" r="24"/>`
  + '<g class="person"><circle cx="541" cy="-63" r="6"/><path d="M529 -43a12 11 0 0 1 24 0"/></g></a>');
o.push(`<circle class="you-dot" cx="${C - 62}" cy="${C}" r="10"/>`);
o.push(`<text class="core-s" x="${C - 44}" y="${C + 5}">human in the loop</text>`);

steps.forEach((s, k) => {
  const deg = k * step;
  const [x, y] = pt(deg);
  const tip = esc(`${k + 1}. ${s.name}: ${s.tip}`);
  o.push(`<a class="step" href="#step-${k + 1}" data-tip="${tip}" aria-label="${tip}"><circle class="hit" cx="${f(x)}" cy="${f(y)}" r="40"/>`);
  if (s.human) o.push(`<circle class="you-ring" cx="${f(x)}" cy="${f(y)}" r="35"/>`);
  o.push(`<g class="node"><circle cx="${f(x)}" cy="${f(y)}" r="27"/><text class="n" x="${f(x)}" y="${f(y + 6)}" text-anchor="middle">${k + 1}</text></g>`);
  let lx = 334;
  let ly = 26;
  let anchor = 'start';
  if (k > 0) {
    [lx, ly] = pt(deg, 282);
    const sn = Math.sin((deg * Math.PI) / 180);
    const cs = Math.cos((deg * Math.PI) / 180);
    anchor = Math.abs(sn) < 0.2 ? 'middle' : sn > 0 ? 'start' : 'end';
    if (Math.abs(sn) >= 0.2) lx += sn > 0 ? 8 : -8;
    ly += cs > 0.5 ? -8 : cs < -0.5 ? 14 : 0;
  }
  o.push(`<text class="lbl" x="${f(lx)}" y="${f(ly)}" text-anchor="${anchor}">${esc(s.name)}</text>`);
  o.push(`<text class="sub" x="${f(lx)}" y="${f(ly + 18)}" text-anchor="${anchor}">${esc(s.sub)}</text>`);
  if (s.human) o.push(`<text class="you-t" x="${f(lx)}" y="${f(ly + 35)}" text-anchor="${anchor}">${esc(s.human)}</text>`);
  o.push('</a>');
});
o.push('</svg>');

export const sdlcSvg = o.join('\n');
