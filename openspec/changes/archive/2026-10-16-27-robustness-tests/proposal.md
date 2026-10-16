# Proposal

Issue: [#27](https://github.com/ESchuderer/BenchKeeper/issues/27)

## Why

The six hidden acceptance tests check only the happy path of each requirement. On the React brief, 35 of 36 trials reached 6 of 6, so the feature score does not separate the arms.

## What Changes

- Robustness tests R1 to R12 in `bench/briefs/winery/hidden/robustness.spec.mjs` (shared with `winery-react`), each derived from a sentence of the brief: concurrent bookings for the last seats, invalid guests (0, 9, 2.5), empty name, empty email, booking data not readable without sign-in (including API responses), names with HTML characters, invalid guests sent without the form (server-side checks), a name of only spaces, names with accents and other scripts, cancelling without a session.
- Test helpers move to `bench/briefs/winery/hidden/helpers.mjs`; the feature tests keep their behavior.
- One mutant per robustness test in both `validate.sh`.
- `trial.json` reports `robustness` and `robustness_passed` next to `features` and `features_passed`; the summary gets a column.
- Saved trials rescored, protocol version bumped.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `benchmark-briefs`: a robustness score next to the feature score.

## Impact

`bench/` only. The hidden tests' hash changes, so all saved trials are rescored with the new tests (agent runs unchanged).
