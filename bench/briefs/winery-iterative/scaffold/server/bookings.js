// Booking rules: tastings, seats left, validation, bookings. No HTTP here (see server/app.js).
/** @typedef {import('../shared/types.js').Tasting} Tasting */
/** @typedef {import('../shared/types.js').Booking} Booking */
/** @typedef {import('../shared/types.js').FieldErrors} FieldErrors */

/** @returns {import('../shared/types.js').TastingWithSeats[]} */
export function listTastings() { throw new Error('not implemented'); }

/** Seats of a tasting minus its bookings. @param {string} tastingId @returns {number} */
export function seatsLeft(tastingId) { throw new Error('not implemented'); }

/** Validates and stores a booking; never more guests than seats left. @returns {{ booking: Booking } | { errors: FieldErrors }} */
export function book({ tastingId, name, email, guests }) { throw new Error('not implemented'); }

/** @returns {Booking[]} all bookings, for staff */
export function listBookings() { throw new Error('not implemented'); }

/** Removes a booking, which frees its seats. @param {string} ref @returns {boolean} */
export function cancel(ref) { throw new Error('not implemented'); }
