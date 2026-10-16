# Proposal

Issue: [#46](https://github.com/ESchuderer/BenchKeeper/issues/46)

## Why

Agents decide structure on their own when nobody fixes it first, patch drifted work instead of starting over, and are reviewed without the intent behind a change. In the benchmark, several apps built with the BenchKeeper layer had no README, which the scope rule ("no extra files") does not prevent.

## What Changes

- Specify (full tier): a checklist of decisions not left to the agent (deployment target, data storage, module boundaries, core types and interfaces); an optional skeleton before Build.
- Discard and restart: a drifted or unexplained run is discarded and restarted in a fresh context with the cause added to the plan.
- Review input: the pre-push reviewer gets the diff and the plan or spec summary; the pull request lists the key decisions.
- Documentation: a new project or app gets a README; changes to setup or behavior update it; the scope rule does not exclude documentation the task needs.
- Opt-in for hard tasks, only on the user's explicit request: best-of-N worktrees and mutation testing on changed files.
- Changelog entry, setup version, a new pinned rules version for the benchmark.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-routing`: decisions before Build, discard and restart, review input, documentation, opt-in checks.

## Impact

`skills/sdlc/SKILL.md`, `rules/global.md`, `CHANGELOG.md`, site facts and README if the SDLC text changes, `bench/arms/` (new pinned rules version).
