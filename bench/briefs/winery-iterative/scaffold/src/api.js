// The only module that talks to the server.

/** @returns {Promise<import('../shared/types.js').TastingWithSeats[]>} */
export async function getTastings() { throw new Error('not implemented'); }

/** @returns {Promise<{ booking: import('../shared/types.js').Booking, total: number } | { errors: import('../shared/types.js').FieldErrors }>} */
export async function createBooking(input) { throw new Error('not implemented'); }
