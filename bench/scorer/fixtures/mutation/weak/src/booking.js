// Fixture for bench/scorer/validate-mutation.sh: the same module for every fixture app.
export function seatsLeft(capacity, booked) {
  return capacity - booked.reduce((n, b) => n + b.guests, 0);
}

export function validate({ name, email, guests }, left) {
  const errors = {};
  if (!name || !name.trim()) errors.name = 'Enter your name.';
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email || '')) errors.email = 'Enter a valid email address.';
  if (!Number.isInteger(guests) || guests < 1 || guests > 8) errors.guests = 'Guests must be 1 to 8.';
  else if (guests > left) errors.guests = `Only ${left} seats left.`;
  return errors;
}
