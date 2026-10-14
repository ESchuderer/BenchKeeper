# Proposal

Issue: [#24](https://github.com/ESchuderer/BenchKeeper/issues/24)

## Why

A scenario review of the first tier rules found gaps: escalation could land on a tier too small for the work and skipped steps were never made up, skills' own triggers could override the tiers, the tier line added noise to plain questions, a repository without a remote never got a review, and the research evidence bar applied to non-benchmark questions.

## What Changes

- Tier line only before the first edit or subagent.
- An explicit lower tier yields to security, data or production impact after asking.
- A project default tier applies when no other tier clearly matches.
- Escalation moves to the fitting tier and runs its skipped steps first.
- Tiers take precedence over skill triggers.
- Research: one fact answered directly; subagents for two or more items with model and effort set; evidence bar only for benchmark claims.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-routing`: tier selection, tier steps, escalation and research flow.

## Impact

`rules/global.md`, `skills/project-setup/SKILL.md`, `AGENTS.md`, `web/src/data/facts.json`, `web/src/components/Page.tsx`.
