# Proposal

Issue: [#19](https://github.com/ESchuderer/BenchKeeper/issues/19)

## Why

Before the Sonnet run, the owner wants a cheap pre-screen: all five arms build one small app (winery tasting bookings) headless on Claude Opus 5.5, to show that installs, the delivery audit and scoring work, and what each stack's workflow does unprompted.

## What Changes

- `bench/PROTOCOL.md` v0.1 for the pre-screen.
- Winery brief, hidden acceptance tests, reference app and a validation script (reference passes, mutants fail their feature).
- Arm images (`bench/image/`), runner `bench/run-brief.sh`, scorer `bench/scorer/`, trial parser with delivery audit and workflow trace, summary table.

## Capabilities

### New Capabilities

- `benchmark-briefs`: how a one-shot product brief is run through the arms and scored.

### Modified Capabilities

None.

## Impact

`bench/` only; no CI change beyond the existing test step for `bench/scripts`.
