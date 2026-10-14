# Proposal

Issue: [#24](https://github.com/ESchuderer/BenchKeeper/issues/24)

## Why

A review of the change-type table found rows that contradicted the general risk rule, a user override that could remove review from risky changes, an ambiguous ban on `apply`, and spec scenarios that disagreed with the table.

## What Changes

- Define a risky change; risky changes always get the pre-push review, whatever tier the user picks.
- Table rows follow the definition (production and security config, deploy steps full; log lines with user data standard; package audit on every dependency update; unknown-cause bugs investigated on the branch).
- Generated files do not count toward "several files"; pull request follow-ups move up when the work grows.
- Explicit list of commands never run as a check.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-routing`: tier selection, change types, request handling.

## Impact

`rules/global.md`.
