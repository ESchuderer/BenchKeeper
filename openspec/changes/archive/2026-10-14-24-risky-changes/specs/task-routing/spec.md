## ADDED Requirements

### Requirement: Risky changes

A risky change SHALL be one to authentication, permissions, secrets or input validation, to production data, deploy or production configuration, or an irreversible action. A risky change SHALL get the pre-push review in every tier.

#### Scenario: Risky change on the quick tier

- **WHEN** the user keeps a production config change on the quick tier
- **THEN** the agent still reviews the commits before push

## MODIFIED Requirements

### Requirement: Tier selection

The agent SHALL assign each request that leads to an edit or a subagent to one tier (quick, standard, full, research) and state it in one line before the first edit or subagent. An explicit tier from the user SHALL win; for a risky change the agent SHALL name the full tier and ask, and the user's answer SHALL decide. A project default tier SHALL apply when no other tier clearly matches.

#### Scenario: Small UI change

- **WHEN** the user asks to change a button label
- **THEN** the agent states the quick tier and skips the issue, spec and plan steps

#### Scenario: User override

- **WHEN** the user writes "full" for a request the agent would rate quick
- **THEN** the agent runs the full tier

#### Scenario: Lower tier with production impact

- **WHEN** the user writes "quick" for a production hotfix
- **THEN** the agent names the full tier and asks, follows the user's answer, and still reviews the commits before push

#### Scenario: Plain question

- **WHEN** the user asks what a function does and no edit or subagent is needed
- **THEN** the agent answers without a tier line

#### Scenario: Project default

- **WHEN** `AGENTS.md` sets the research tier as default and the request is ambiguous between research and a docs edit
- **THEN** the agent uses the research tier
