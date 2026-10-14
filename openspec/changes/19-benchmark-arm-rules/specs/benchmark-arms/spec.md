## Purpose

Derive the global rules for each benchmark arm mechanically, so arms differ only in the skill framework.

## ADDED Requirements

### Requirement: Arm rule variants

For arms that replace agent-skills, the rules SHALL be generated from `rules/global.md` by a committed mapping: each agent-skills skill name referenced in the rules maps to a framework skill, a framework agent, or a neutral phrase, and every mention of agent-skills is renamed. No other text SHALL change.

#### Scenario: Mapped skill

- **WHEN** the rules name `test-driven-development` and the ECC mapping maps it to `tdd-workflow`
- **THEN** the ECC variant names `tdd-workflow` in that place

#### Scenario: No equivalent

- **WHEN** a framework has no equivalent for `security-and-hardening`
- **THEN** the variant reads "any installed security hardening skill"

### Requirement: Variants stay current

CI SHALL fail when a committed variant differs from what the generator produces from the current rules, and when a referenced agent-skills name has no mapping.

#### Scenario: Rules edited

- **WHEN** `rules/global.md` changes and the variants are not regenerated
- **THEN** the CI check fails
