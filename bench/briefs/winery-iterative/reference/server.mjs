// Reference for the winery-iterative brief: the React winery app with all four change requests. Validates the hidden
// tests of every checkpoint (bench/briefs/winery-iterative/validate.sh). Not shown to agents.
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
// Change request 1: 10% off for 6 or more guests.
const total = (t, guests) => Math.round(guests * t.price * (guests >= 6 ? 0.9 : 1) * 100) / 100;
const csv = (v) => `"${String(v).replace(/"/g, '""')}"`;

const app = express();
app.use(express.json());
app.get('/api/tastings', (req, res) => res.json(tastings.map((t) => ({ ...t, left: left(t) }))));
app.post('/api/bookings', (req, res) => {
  const t = tastings.find((x) => x.id === req.body.tasting);
  const { name = '', email = '' } = req.body;
  const guests = Number(req.body.guests);
  const errors = {};
  if (!name.trim()) errors.name = 'Enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';
  if (!Number.isInteger(guests) || guests < 1 || guests > 8) errors.guests = 'Guests must be 1 to 8.';
  else if (t && guests > left(t)) errors.guests = `Only ${left(t)} seats left.`;
  if (!t || Object.keys(errors).length) return res.status(422).json({ errors });
  const b = { ref: randomUUID().slice(0, 8).toUpperCase(), tasting: t.id, name: name.trim(), email, guests };
  bookings.push(b);
  res.json({ ...b, title: t.title, total: total(t, guests) });
});
// Change request 3: guests cancel with reference and email.
app.post('/api/cancel', (req, res) => {
  const ref = String(req.body.ref || '').trim().toUpperCase();
  const email = String(req.body.email || '').trim().toLowerCase();
  const i = bookings.findIndex((b) => b.ref === ref && b.email.toLowerCase() === email);
  if (i < 0) return res.status(404).json({ error: 'No booking with this reference and email.' });
  bookings.splice(i, 1);
  res.json({ ok: true });
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
// Change request 2: staff add tastings.
app.post('/api/staff/tastings', (req, res) => {
  if (!staff(req)) return res.status(401).json({});
  const { title = '', when = '' } = req.body;
  const price = Number(req.body.price), seats = Number(req.body.seats);
  const errors = {};
  if (!title.trim()) errors.title = 'Enter a title.';
  if (!when.trim()) errors.when = 'Enter the date and time.';
  if (!(price >= 1)) errors.price = 'Price must be at least 1.';
  if (!Number.isInteger(seats) || seats < 1) errors.seats = 'Seats must be at least 1.';
  if (Object.keys(errors).length) return res.status(422).json({ errors });
  const t = { id: randomUUID().slice(0, 8), title: title.trim(), when: when.replace('T', ' '), price, seats };
  tastings.push(t);
  res.json(t);
});
// Change request 4: CSV export for staff.
app.get('/api/staff/bookings.csv', (req, res) => {
  if (!staff(req)) return res.status(401).send('Sign in first.');
  const title = (id) => tastings.find((t) => t.id === id)?.title || id;
  const rows = [['tasting', 'name', 'email', 'guests', 'reference'], ...bookings.map((b) => [title(b.tasting), b.name, b.email, b.guests, b.ref])];
  res.type('text/csv').setHeader('content-disposition', 'attachment; filename="bookings.csv"').send(rows.map((r) => r.map(csv).join(',')).join('\n') + '\n');
});
app.use(express.static('dist'));
app.get('/{*path}', (req, res) => res.sendFile('index.html', { root: 'dist' }));
app.listen(Number(process.env.PORT) || 3000);
