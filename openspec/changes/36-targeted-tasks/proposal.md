# Proposal

Issue: [#36](https://github.com/ESchuderer/BenchKeeper/issues/36), step 4 (targeted tasks per phase).

## Why

The whole-stack arms cannot show which skill helps. Step 4 of #36 needs small tasks on which a skill of one phase should change the outcome, scored without an LLM judge, so that each skill can run with and without itself on the same task.

## What Changes

- Seven targeted tasks, one per phase, as step briefs (`brief.json` `"steps": "sessions"`, one step, `"serve": "none"`, `"phase"`): `skill-plan-ttl`, `skill-specify-monthly`, `skill-develop-duration`, `skill-test-shipping`, `skill-debug-discount`, `skill-review-download`, `skill-ship-release`. Each has a fixture repository built offline by `prepare.sh`, the task text (`steps/1.md`), hidden checks (`checks/checks.mjs`), a reference, mutants and `validate.sh`.
- Shared harness `bench/briefs/skill-common/`: baseline builder, check runner (one process and one workspace copy per check, no network), the repository's suite, validator library. The existing runner, scorer and trial parser run the tasks unchanged.
- Design of the skill toggle (one arm minus one skill, at container start, without rebuilding the image), the paired schedule and the mapping to the per-skill rating (`design.md`). Implemented in a later change on this issue, after the owner's answers.
- `bench/PROTOCOL.md` 1.14: section on the targeted tasks.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `benchmark-briefs`: targeted tasks per phase with validated checks.
- `benchmark-arms`: an arm without one of its skills.

## Impact

`bench/briefs/skill-*`, `bench/PROTOCOL.md`. No change to `bench/run-brief.sh`, `bench/scorer/score.sh` or `bench/scripts/trial.mjs` in this change; the toggle changes them later.
