# Proposal

Issue: [#24](https://github.com/ESchuderer/BenchKeeper/issues/24)

## Why

The tiers say how much process a change gets, not what to check for its type. Infrastructure, migrations and dependency updates need checks that a generic Verify step does not name, and a scenario review found unclear outcomes for refactors, unknown-cause bugs, hotfixes, pull request follow-ups, mixed requests, work beyond one session and spikes.

## What Changes

- A change-type table in `rules/global.md`: default tier and the check before reporting done per type.
- Rules for mixed requests, pull request follow-ups, irreversible impact, work beyond one session, refactors and spikes.
- The user's answer decides after the agent names the full tier for a risky change.
- Site and README describe the sized SDLC.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-routing`: tier selection, tier steps and research flow; new requirements for change types and request handling.

## Impact

`rules/global.md`, `web/src/data/facts.json`, `web/src/components/Page.tsx`, `README.md`, `evaluations/studies.md`.
