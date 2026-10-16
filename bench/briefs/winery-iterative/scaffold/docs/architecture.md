# Architecture

- `shared/types.js`: the data types used by server and interface.
- `server/`: the HTTP server. `server/app.js` holds the routes only; booking rules (seats, validation) live in `server/bookings.js`; staff sign-in lives in `server/auth.js`. Data is kept in memory.
- `src/`: the React interface. Pages: start (tastings), booking form, confirmation, staff. All requests to the server go through `src/api.js`.
- Dependencies flow one way: `src` calls the server through `src/api.js`; `server/app.js` calls `server/bookings.js` and `server/auth.js`; both import types from `shared/types.js`.
