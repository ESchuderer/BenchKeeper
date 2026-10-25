import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const api = (url, body) => fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);

function Guest() {
  const [tastings, setTastings] = useState(null);
  const [booking, setBooking] = useState(null);
  const [done, setDone] = useState(null);
  const [errors, setErrors] = useState({});
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
    const field = (id, label) => (<p><label htmlFor={id}>{label}</label> <input id={id} name={id} aria-invalid={!!errors[id]} aria-describedby={`${id}-error`} />{errors[id] && <span id={`${id}-error`} role="alert"> {errors[id]}</span>}</p>);
    return (<main><h1>Book {booking.title}</h1><form noValidate onSubmit={submit}>{field('name', 'Name')}{field('email', 'Email')}{field('guests', 'Guests')}<button type="submit">Book</button></form></main>);
  }
  if (!tastings) return <main><p>Loading</p></main>;
  return (<main><h1>Wine tastings</h1><ul>{tastings.map((t) => (<li key={t.id}><h2>{t.title}</h2><p>{t.when}, EUR {t.price} per guest, {t.left} seats left</p><button type="button" onClick={() => setBooking(t)}>Book {t.title}</button></li>))}</ul></main>);
}

function Staff() {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
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
  return (<main><h1>Bookings</h1><ul>{list.map((b) => (<li key={b.ref}>{b.name}, {b.email}, {b.guests} guests, {b.ref} <button type="button" onClick={() => cancel(b.ref)}>Cancel</button></li>))}</ul></main>);
}

createRoot(document.getElementById('root')).render(location.pathname === '/staff' ? <Staff /> : <Guest />);
