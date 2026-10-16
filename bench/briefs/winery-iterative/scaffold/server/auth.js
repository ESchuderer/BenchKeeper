// Staff sign-in: the password comes from STAFF_PASSWORD; sessions in memory, sent as an HTTP-only cookie.

/** @param {string} password @returns {string | null} a new session id, or null for a wrong password */
export function signIn(password) { throw new Error('not implemented'); }

/** @param {string | undefined} sessionId @returns {boolean} */
export function isStaff(sessionId) { throw new Error('not implemented'); }
