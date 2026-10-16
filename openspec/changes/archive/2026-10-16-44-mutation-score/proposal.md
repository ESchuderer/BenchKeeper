# Proposal

Issue: [#44](https://github.com/ESchuderer/BenchKeeper/issues/44)

## Why

Line coverage of the agents' own tests stays near its ceiling and does not tell tests that check behavior from tests that only run code. The benchmark reports whether tests were written and whether they came first, not how much they constrain the app.

## What Changes

- The scorer runs a pinned mutation testing tool (Stryker for JavaScript and TypeScript) against each app's own test suite, on a copy of the workspace, with a time limit per app.
- `trial.json` gets a `mutation` field (score, killed, survived, timeout, no coverage, mutants), or `null` with a reason.
- Fixtures with strong and weak tests validate the step; summary and report show the score.
- All saved trials rescored without new agent runs; protocol version bumped.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `benchmark-briefs`: a mutation score of each app's own tests.

## Impact

`bench/scorer/`, `bench/scripts/trial.mjs`, `bench/scripts/summary.mjs`, `bench/PROTOCOL.md`, the saved results. Scoring takes longer per trial.
