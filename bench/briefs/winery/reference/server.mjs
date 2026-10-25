// Reference implementation of the winery brief; validates the hidden tests (all must pass). Not shown to agents.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const tastings = [
  { id: 'riesling', title: 'Riesling Evening', when: '2026-11-06 18:00', price: 25, seats: 12 },
  { id: 'cellar', title: 'Red Wine Cellar Tour', when: '2026-11-14 15:00', price: 32, seats: 8 },
  { id: 'winter', title: 'Winter Tasting', when: '2026-12-05 17:00', price: 28, seats: 10 },
];
const bookings = [];
const sessions = new Set();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const left = (t) => t.seats - bookings.filter((b) => b.tasting === t.id).reduce((n, b) => n + b.guests, 0);
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body><main>${body}</main></body></html>`;
const form = (t, error = '', v = {}) => page(`Book ${t.title}`, `<h1>Book ${esc(t.title)}</h1>${error ? `<p role="alert">${esc(error)}</p>` : ''}
<form method="post" action="/book/${t.id}">
<label for="n">Name</label><input id="n" name="name" value="${esc(v.name || '')}">
<label for="e">Email</label><input id="e" name="email" value="${esc(v.email || '')}">
<label for="g">Guests</label><input id="g" name="guests" value="${esc(v.guests || '')}">
<button>Book</button></form>`);

async function body(req) {
  let s = '';
  for await (const c of req) s += c;
  return Object.fromEntries(new URLSearchParams(s));
}

createServer(async (req, res) => {
  const send = (html, code = 200, h = {}) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', ...h }); res.end(html); };
  const url = new URL(req.url, 'https://x');
  const sid = /sid=([\w-]+)/.exec(req.headers.cookie || '')?.[1];
  const staff = sid && sessions.has(sid);
  const [, kind, id] = url.pathname.split('/');
  const t = tastings.find((x) => x.id === id);
  if (url.pathname === '/') {
    return send(page('Weingut Kieselbrunnen', `<h1>Wine tastings</h1><ul>${tastings.map((x) => `<li><h2>${x.title}</h2><p>${x.when}, EUR ${x.price} per guest, ${left(x)} seats left</p><a href="/book/${x.id}">Book ${x.title}</a></li>`).join('')}</ul>`));
  }
  if (kind === 'book' && t && req.method === 'GET') return send(form(t));
  if (kind === 'book' && t && req.method === 'POST') {
    const v = await body(req);
    const guests = Number(v.guests);
    const error = !v.name?.trim() ? 'Enter your name.'
      : !/^[^\s@]+@[^\s@][^\s@.]*\.[^\s@]+$/.test(v.email || '') ? 'Enter a valid email address.'
      : !Number.isInteger(guests) || guests < 1 || guests > 8 ? 'Guests must be 1 to 8.'
      : guests > left(t) ? `Only ${left(t)} seats left.` : '';
    if (error) return send(form(t, error, v), 422);
    const b = { ref: randomUUID().slice(0, 8).toUpperCase(), tasting: t.id, name: v.name.trim(), email: v.email, guests };
    bookings.push(b);
    return send(page('Booking confirmed', `<h1>Booking confirmed</h1><p>${esc(t.title)}, ${guests} guests, total EUR ${guests * t.price}. Reference ${b.ref}.</p><a href="/">Back</a>`));
  }
  if (url.pathname === '/staff' && req.method === 'POST') {
    const v = await body(req);
    if (v.password && v.password === process.env.STAFF_PASSWORD) {
      const s = randomUUID(); sessions.add(s);
      return send('', 303, { location: '/staff', 'set-cookie': `sid=${s}; HttpOnly; SameSite=Strict; Path=/` });
    }
    return send(page('Staff', '<h1>Staff</h1><p role="alert">Wrong password.</p><a href="/staff">Try again</a>'), 401);
  }
  if (url.pathname === '/staff') {
    if (!staff) return send(page('Staff', '<h1>Staff sign-in</h1><form method="post" action="/staff"><label for="p">Password</label><input id="p" type="password" name="password"><button>Sign in</button></form>'));
    return send(page('Bookings', `<h1>Bookings</h1>${tastings.map((x) => `<h2>${x.title}</h2><ul>${bookings.filter((b) => b.tasting === x.id).map((b) => `<li>${esc(b.name)}, ${esc(b.email)}, ${b.guests} guests, ${b.ref} <form method="post" action="/cancel/${b.ref}"><button>Cancel</button></form></li>`).join('')}</ul>`).join('')}`));
  }
  if (kind === 'cancel' && req.method === 'POST' && staff) {
    const i = bookings.findIndex((b) => b.ref === id);
    if (i >= 0) bookings.splice(i, 1);
    return send('', 303, { location: '/staff' });
  }
  send(page('Not found', '<h1>Not found</h1>'), 404);
}).listen(Number(process.env.PORT) || 3000);
