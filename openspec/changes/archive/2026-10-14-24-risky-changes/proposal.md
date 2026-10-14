# Proposal

Issue: [#24](https://github.com/ESchuderer/BenchKeeper/issues/24)

## Why

The tier selection requirement grew past the 500-character limit of `openspec validate --strict` when the risky-change definition was added.

## What Changes

- Move the risky-change definition and its review rule into their own requirement; tier selection refers to it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-routing`: tier selection; new requirement for risky changes.

## Impact

None outside the spec.
