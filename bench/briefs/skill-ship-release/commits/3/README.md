# unitconv

Unit conversion library and command line tool.

```sh
unitconv 100 c f --digits 1   # 212.0
```

```js
import { convert } from 'unitconv';
convert(100, 'c', 'f'); // 212
```

Units: temperature `c`, `f`, `k`; length `m`, `ft`, `in`. Tests: `npm test` (Node.js 22, no dependencies). Releases: `RELEASING.md`.
