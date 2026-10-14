# Proposal

Issue: [#19](https://github.com/ESchuderer/BenchKeeper/issues/19)

## Why

Arms D and E of the paired benchmark run BenchKeeper with agent-skills replaced by Superpowers or ECC. The global rules name agent-skills skills; in D and E those names do not exist, which would penalize those arms for a reason unrelated to the frameworks.

## What Changes

- Mapping files per arm (`bench/arms/superpowers.json`, `bench/arms/ecc.json`): each agent-skills name used in the rules maps to the closest skill or agent of the framework, or to a neutral phrase when none exists.
- Generator `bench/scripts/arm-rules.mjs` writes `bench/arms/<arm>.rules.md` from `rules/global.md`; `--check` fails when a variant is out of date.
- Test that every referenced agent-skills name is mapped and none is left in the output; CI runs the test and the check.

## Capabilities

### New Capabilities

- `benchmark-arms`: how the paired benchmark derives the rules for each arm.

### Modified Capabilities

None.

## Impact

New `bench/` directory, `.github/workflows/links.yml`, `AGENTS.md`.
