# Proposal

Issue: [#36](https://github.com/ESchuderer/BenchKeeper/issues/36)

## Why

The whole-stack arms cannot show which skill helps. Each skill of the evaluated frameworks needs its own evidence: whether it triggers when it should and whether it changes outcomes on a task where it should matter.

## What Changes

- Step 1, inventory: every skill each framework adds, with phase, size and description, generated from the arm images.
- Step 2, usage from saved trials: in how many trials each skill fired, of the trials whose arm had it.
- Later steps (separate changes on this issue): trigger evals per skill, targeted tasks per phase with paired runs, leave-one-out ablation for the finalist stack, rating table.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `benchmark-briefs`: a skills inventory with usage from the saved trials.

## Impact

`bench/scripts/skills-inventory.sh`, `bench/scripts/skills-inventory.mjs` with a test, a results report.
