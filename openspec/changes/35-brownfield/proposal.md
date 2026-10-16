# Proposal

Issue: [#35](https://github.com/ESchuderer/BenchKeeper/issues/35)

## Why

In the greenfield winery brief all 44 Claude Code trials passed every hidden test and the reviews scored 7 to 9, so the arms barely separate. A brownfield brief over several steps measures what greenfield briefs cannot: reuse of existing code, keeping the repository's tests green, following its conventions and the setup an earlier step wrote.

## What Changes

- Brief `bench/briefs/openballistics/`: baseline from PiMetry/OpenBallistics at `e83db43` (`prepare.sh`), steps 1 to 3 (repository setup, compare view, reviewer comment), checks per step, cross-step checks, the repository's own suite, references and mutants (`validate.sh`), a review prompt and schema with criteria per step.
- `brief.json` `"steps": "sessions"`: each step a new session on the prepared baseline, per-step snapshots and usage readings in `bench/run-brief.sh`, per-step scoring in `bench/scorer/score.sh`, per-step results in `bench/scripts/trial.mjs` and `summary.mjs`, two reviews per trial in `bench/review/review.sh`.
- `bench/PROTOCOL.md` 1.13.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `benchmark-briefs`: briefs with steps in separate sessions on a baseline repository.

## Impact

`bench/` only. The winery and cartridges briefs keep their behavior.
