// Constants of the local HTTP API, in a module without schemas, so a browser bundle can import them without zod.

/** The header that carries the session's CSRF token; a page of another origin can neither read the token nor send it. */
export const CSRF_HEADER = "x-cedarloom-csrf";
