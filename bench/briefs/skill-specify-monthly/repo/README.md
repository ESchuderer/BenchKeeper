# reminders

Dates for recurring reminders: `src/schedule.js` returns the dates of a series as calendar dates (`YYYY-MM-DD`).

- The first date of a series is its start date.
- Dates do not depend on the time zone of the machine that computes them.
- An invalid date or count throws a `RangeError`.

```js
import { daily, weekly } from './src/schedule.js';

weekly('2027-03-01', 3); // ['2027-03-01', '2027-03-08', '2027-03-15']
```

Tests: `npm test` (Node.js 22, no dependencies).
