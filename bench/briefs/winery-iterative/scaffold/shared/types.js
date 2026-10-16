// Data types shared by the server and the interface (JSDoc).

/** @typedef {{ id: string, title: string, when: string, price: number, seats: number }} Tasting */
/** @typedef {Tasting & { left: number }} TastingWithSeats  seats left after the bookings */
/** @typedef {{ ref: string, tasting: string, name: string, email: string, guests: number }} Booking */
/** @typedef {{ name?: string, email?: string, guests?: string }} FieldErrors  one message per invalid field */

export {};
