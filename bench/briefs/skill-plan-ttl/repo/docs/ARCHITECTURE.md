# Architecture

## Store file

One JSON file per store, written atomically by `save()` (a temporary file, then a rename):

```json
{ "version": 1, "entries": { "<key>": { "value": "<any JSON value>", "updatedAt": 1790000000000 } } }
```

Format version 1 is read by other programs: `tools/export-csv.js`, and through it the nightly billing import, which
expects the CSV header `key,value,updatedAt` exactly. A change to the format adds fields to an entry; it never renames
or removes fields and never changes `version`. Files written by earlier releases stay readable.

## Time

Code in `src/` never calls `Date.now()` or `new Date()` for the current time: it calls the `now` function passed to
`openStore` (default `Date.now`), so tests control the clock. Times are milliseconds since the epoch.
