# Proposal

Issue: [#19](https://github.com/ESchuderer/BenchKeeper/issues/19)

## Why

Arms D and E of the paired benchmark run Superpowers or ECC with their own workflow. The global rules set BenchKeeper's workflow (task tiers, SDLC phases with agent-skills, branch and pull request flow), and Superpowers gives user instructions precedence over its skills ([using-superpowers](https://github.com/obra/superpowers/blob/v7.0.0/skills/using-superpowers/SKILL.md)), so the full rules would override the framework's flow.

## What Changes

- Generator `bench/scripts/arm-rules.mjs` writes `bench/arms/base.rules.md`: `rules/global.md` without the sections "Ponytail and agent-skills", "Branches, issues and pull requests", "Task tiers" and "SDLC". Arms D and E use it; arm C uses the full rules.
- `--check` fails when the file is out of date; the test checks that no agent-skills name or workflow section is left and that the other sections are unchanged. CI runs both.

## Capabilities

### New Capabilities

- `benchmark-arms`: how the paired benchmark derives the rules for each arm.

### Modified Capabilities

None.

## Impact

New `bench/` directory, `.github/workflows/links.yml`, `AGENTS.md`.
