# Proposal

Issue: [#31](https://github.com/ESchuderer/BenchKeeper/issues/31)

## Why

The winery briefs test a small server app. The owner wants a second brief that tests presentation, a print view and computed 2D technical drawings: a static cartridge database of 25 C.I.P. cartridges from OpenBallistics.

## What Changes

- Brief `bench/briefs/cartridges/`: brief text with the 25 records pinned to OpenBallistics commit `e83db43` and the drawing rules, hidden tests C1 to C6, reference app, `validate.sh`, review prompt and reference drawings.
- Optional per-brief settings `bench/briefs/<name>/brief.json`: static serving in the scorer, the follow-up check and message in `bench/run-brief.sh`, the axe pages in `bench/scripts/trial.mjs`, the review prompt in `bench/review/review.sh`. Without the file every script keeps its winery behavior.
- `bench/PROTOCOL.md` and `bench/SCENARIOS.md` entries; Haiku 5.5 and Sonnet 5.5 runs of all 29 arms.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `benchmark-briefs`: per-brief settings for static apps.

## Impact

`bench/` only.
