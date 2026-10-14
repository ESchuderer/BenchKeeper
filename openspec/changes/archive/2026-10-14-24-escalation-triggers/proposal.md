# Proposal

Issue: [#24](https://github.com/ESchuderer/BenchKeeper/issues/24)

## Why

The escalation requirement still listed the old triggers after the rules defined risky changes and excluded generated files from "several files".

## What Changes

- Escalation triggers match `rules/global.md`: risky change, several files not counting generated ones.
- The pre-push review applies to pushes with code or risky changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-routing`: escalation.

## Impact

`rules/global.md`.
