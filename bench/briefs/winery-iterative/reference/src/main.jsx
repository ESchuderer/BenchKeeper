import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const api = (url, body) => fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
const total = (price, guests) => Math.round(guests * price * (guests >= 6 ? 0.9 : 1) * 100) / 100;
const field = (errors, id, label, props = {}) => (<p><label htmlFor={id}>{label}</label> <input id={id} name={id} aria-invalid={!!errors[id]} aria-describedby={`${id}-error`} {...props} />{errors[id] && <span id={`${id}-error`} role="alert"> {errors[id]}</span>}</p>);

function Guest() {
  const [tastings, setTastings] = useState(null);
  const [booking, setBooking] = useState(null);
  const [done, setDone] = useState(null);
  const [errors, setErrors] = useState({});
  const [guests, setGuests] = useState('');
  useEffect(() => { void api('/api/tastings').then((r) => r.json()).then(setTastings); }, []);
  if (done) return (<main><h1>Booking confirmed</h1><p>{done.title}, {done.guests} guests, total EUR {done.total}, reference {done.ref}.</p></main>);
  if (booking) {
    const submit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const r = await api('/api/bookings', { ...f, tasting: booking.id });
      const j = await r.json();
      if (r.ok) setDone(j); else setErrors(j.errors || {});
    };
    const n = Number(guests);
    return (<main><h1>Book {booking.title}</h1><form noValidate onSubmit={submit}>{field(errors, 'name', 'Name')}{field(errors, 'email', 'Email')}{field(errors, 'guests', 'Guests', { value: guests, onChange: (e) => setGuests(e.target.value) })}
      {Number.isInteger(n) && n >= 1 && n <= 8 && <p>Total EUR {total(booking.price, n)}{n >= 6 && ' (10% group discount)'}</p>}<button type="submit">Book</button></form></main>);
  }
  if (!tastings) return <main><p>Loading</p></main>;
  return (<main><h1>Wine tastings</h1><ul>{tastings.map((t) => (<li key={t.id}><h2>{t.title}</h2><p>{t.when}, EUR {t.price} per guest, {t.left} seats left</p><button type="button" onClick={() => setBooking(t)}>Book {t.title}</button></li>))}</ul><p><a href="/cancel">Cancel a booking</a></p></main>);
}

function Cancel() {
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  if (done) return <main><h1>Booking cancelled</h1></main>;
  const submit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const r = await api('/api/cancel', f);
    if (r.ok) setDone(true); else setError((await r.json()).error || 'Cancelling failed.');
  };
  return (<main><h1>Cancel a booking</h1><form noValidate onSubmit={submit}><p><label htmlFor="ref">Booking reference</label> <input id="ref" name="ref" /></p><p><label htmlFor="cemail">Email</label> <input id="cemail" name="email" /></p><button type="submit">Cancel booking</button></form>{error && <p role="alert">{error}</p>}</main>);
}

function Staff() {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const load = () => api('/api/staff/bookings').then((r) => (r.ok ? r.json().then(setList) : setList(null)));
  useEffect(() => { void load(); }, []);
  if (!list) {
    const submit = async (e) => {
      e.preventDefault();
      const r = await api('/api/staff/login', { password: new FormData(e.target).get('password') });
      if (r.ok) void load(); else setError('Wrong password.');
    };
    return (<main><h1>Staff sign-in</h1><form onSubmit={submit}><label htmlFor="p">Password</label> <input id="p" name="password" type="password" /><button type="submit">Sign in</button></form>{error && <p role="alert">{error}</p>}</main>);
  }
  const cancel = (ref) => api(`/api/staff/bookings/${ref}/cancel`, {}).then(load);
  const add = async (e) => {
    e.preventDefault();
    const r = await api('/api/staff/tastings', Object.fromEntries(new FormData(e.target)));
    if (r.ok) { setErrors({}); e.target.reset(); } else setErrors((await r.json()).errors || {});
  };
  return (<main><h1>Bookings</h1><p><a href="/api/staff/bookings.csv" download="bookings.csv">Export CSV</a></p>
    <ul>{list.map((b) => (<li key={b.ref}>{b.name}, {b.email}, {b.guests} guests, {b.ref} <button type="button" onClick={() => cancel(b.ref)}>Cancel</button></li>))}</ul>
    <h2>Add a tasting</h2><form noValidate onSubmit={add}>{field(errors, 'title', 'Title')}{field(errors, 'when', 'Date and time', { type: 'datetime-local' })}{field(errors, 'price', 'Price per guest')}{field(errors, 'seats', 'Seats')}<button type="submit">Add tasting</button></form></main>);
}

const page = location.pathname === '/staff' ? <Staff /> : location.pathname === '/cancel' ? <Cancel /> : <Guest />;
createRoot(document.getElementById('root')).render(page);
