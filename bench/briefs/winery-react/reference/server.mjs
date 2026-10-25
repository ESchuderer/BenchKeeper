// React reference for the winery-react brief: validates the hidden tests against a single-page app. Not shown to agents.
import express from 'express';
import { randomUUID } from 'node:crypto';

const tastings = [
  { id: 'riesling', title: 'Riesling Evening', when: '2026-11-06 18:00', price: 25, seats: 12 },
  { id: 'cellar', title: 'Red Wine Cellar Tour', when: '2026-11-14 15:00', price: 32, seats: 8 },
  { id: 'winter', title: 'Winter Tasting', when: '2026-12-05 17:00', price: 28, seats: 10 },
];
const bookings = [];
const sessions = new Set();
const left = (t) => t.seats - bookings.filter((b) => b.tasting === t.id).reduce((n, b) => n + b.guests, 0);
const staff = (req) => sessions.has(/sid=([\w-]+)/.exec(req.headers.cookie || '')?.[1]);

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.get('/api/tastings', (req, res) => res.json(tastings.map((t) => ({ ...t, left: left(t) }))));
app.post('/api/bookings', (req, res) => {
  const t = tastings.find((x) => x.id === req.body.tasting);
  const { name = '', email = '' } = req.body;
  const guests = Number(req.body.guests);
  const errors = {};
  if (!name.trim()) errors.name = 'Enter your name.';
  if (!/^[^\s@]+@[^\s@][^\s@.]*\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';
  if (!Number.isInteger(guests) || guests < 1 || guests > 8) errors.guests = 'Guests must be 1 to 8.';
  else if (t && guests > left(t)) errors.guests = `Only ${left(t)} seats left.`;
  if (!t || Object.keys(errors).length) return res.status(422).json({ errors });
  const b = { ref: randomUUID().slice(0, 8).toUpperCase(), tasting: t.id, name: name.trim(), email, guests };
  bookings.push(b);
  res.json({ ...b, title: t.title, total: guests * t.price });
});
app.post('/api/staff/login', (req, res) => {
  if (!req.body.password || req.body.password !== process.env.STAFF_PASSWORD) return res.status(401).json({ error: 'Wrong password.' });
  const s = randomUUID(); sessions.add(s);
  res.setHeader('set-cookie', `sid=${s}; HttpOnly; SameSite=Strict; Path=/`).json({ ok: true });
});
app.get('/api/staff/bookings', (req, res) => (staff(req) ? res.json(bookings) : res.status(401).json({})));
app.post('/api/staff/bookings/:ref/cancel', (req, res) => {
  if (!staff(req)) return res.status(401).json({});
  const i = bookings.findIndex((b) => b.ref === req.params.ref);
  if (i >= 0) bookings.splice(i, 1);
  res.json({ ok: true });
});
app.use(express.static('dist'));
app.get('/{*path}', (req, res) => res.sendFile('index.html', { root: 'dist' }));
app.listen(Number(process.env.PORT) || 3000);
