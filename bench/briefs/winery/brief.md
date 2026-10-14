Build a small web app for Weingut Kieselbrunnen, a family winery, so guests can book wine tastings online and staff can see the bookings.

Tastings on offer:

| Tasting | Date and time | Price per guest | Seats |
|---|---|---|---|
| Riesling Evening | 2026-11-06 18:00 | EUR 25 | 12 |
| Red Wine Cellar Tour | 2026-11-14 15:00 | EUR 32 | 8 |
| Winter Tasting | 2026-12-05 17:00 | EUR 28 | 10 |

Guests:
- The start page lists the tastings with title, date and time, price per guest and seats left (shown as "<n> seats left").
- Each tasting has a link or button "Book <tasting title>" (for example "Book Riesling Evening") that opens a booking form for that tasting: fields labelled "Name", "Email" and "Guests" (1 to 8), and a button "Book".
- A booking can never take more seats than are left. Invalid input is rejected with an error message next to the form.
- After booking, the guest sees a confirmation with the heading "Booking confirmed", the tasting, the number of guests, the total price and a booking reference.

Staff:
- The page `/staff` asks for a password ("Password" field, "Sign in" button). The password comes from the environment variable `STAFF_PASSWORD`.
- Signed in, staff see all bookings grouped by tasting (name, email, guests, reference) and can cancel a booking with a "Cancel" button. A cancelled booking frees its seats.

Running it:
- This folder is already inside the project's development container: run installs, builds and tests directly here.
- Node.js 22. `npm install` then `npm start` starts the app on the port in the environment variable `PORT` (default 3000).
- The app starts with no bookings. Bookings may be kept in memory or in a local file; no external services.
- The interface is in English.
