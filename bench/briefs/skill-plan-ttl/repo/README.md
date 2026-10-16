# tinykv

A key-value store kept in one JSON file.

```js
import { openStore } from './src/store.js';

const store = openStore('data.json');
store.set('greeting', 'hello');
store.get('greeting'); // 'hello'
store.save();
```

Export a store file as CSV: `node tools/export-csv.js data.json`.

Tests: `npm test`. See `CONTRIBUTING.md` and `docs/ARCHITECTURE.md`.
