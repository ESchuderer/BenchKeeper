# Proposal

Issue: [#45](https://github.com/ESchuderer/BenchKeeper/issues/45)

## Why

On the one-shot React winery brief, nearly every app passes every hidden test, so the scores do not separate the arms. Real work changes an existing app: later requirements can break earlier ones, and code can erode as features are added.

## What Changes

- A brief `winery-iterative`: the base brief plus 3 to 5 change requests in a fixed order, each a follow-up turn in the same session.
- Hidden tests per checkpoint, validated with reference apps and mutants; strict pass counts regressions.
- Metrics per checkpoint: strict pass, tests passed, erosion (share of cyclomatic complexity in functions above complexity 10), duplication (share of cloned lines), source lines.
- A scaffold variant: the same arms start from a prepared skeleton workspace.
- A pilot for the cost estimate, then a Haiku run of an owner-approved subset of arms.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `benchmark-briefs`: iterative briefs with checkpoints, erosion and duplication metrics, and a scaffold condition.

## Impact

`bench/briefs/winery-iterative/`, `bench/run-brief.sh`, `bench/scorer/`, `bench/scripts/`, `bench/PROTOCOL.md`; new runs billed per the owner's decision.
