## Purpose

Derive the rules for each benchmark arm mechanically, so arms C, D and E share the same base rules and differ in the workflow that drives them.

## ADDED Requirements

### Requirement: Base rules for framework arms

Arms that run another framework's workflow (D: Superpowers, E: ECC) SHALL get `bench/arms/base.rules.md`, generated from `rules/global.md` by removing the sections "Ponytail and agent-skills", "Branches, issues and pull requests", "Task tiers" and "SDLC". No other text SHALL change.

#### Scenario: Workflow sections removed

- **WHEN** the base rules are generated
- **THEN** they name no agent-skills skill and contain no task tier or SDLC text

#### Scenario: Other sections kept

- **WHEN** the base rules are generated
- **THEN** the section "Ask, do not assume", including its non-interactive clause, is identical to `rules/global.md`

### Requirement: Base rules stay current

CI SHALL fail when the committed base rules differ from what the generator produces from the current rules, and when a section to remove is missing from the rules.

#### Scenario: Rules edited

- **WHEN** `rules/global.md` changes and the base rules are not regenerated
- **THEN** the CI check fails
