## MODIFIED Requirements

### Requirement: Tier selection

The agent SHALL assign each request that leads to an edit or a subagent to one tier (quick, standard, full, research) and state it in one line before the first edit or subagent. A risky change is one to authentication, permissions, secrets or input validation, to production data, deploy or production configuration, or an irreversible action. An explicit tier from the user SHALL win; for a risky change the agent SHALL name the full tier and ask, the user's answer SHALL decide, and the pre-push review SHALL run in every tier. A project default tier SHALL apply when no other tier clearly matches.

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

### Requirement: Change types

The rules SHALL map common change types to a default tier and a check run before reporting done, in addition to the generic verify step. The agent SHALL never run commands that change shared or production systems as a check, such as `terraform apply`, `kubectl apply`, `helm upgrade`, or migrations against shared or production databases.

#### Scenario: Terraform change

- **WHEN** the agent changes a Terraform module
- **THEN** it runs the full tier and `terraform fmt -check`, `validate` and `plan`, and does not run `apply`

#### Scenario: Behavior-preserving refactor

- **WHEN** the agent renames a function across many files of one module without changing behavior
- **THEN** it runs the standard tier and the test suite passes before and after with tests unchanged

#### Scenario: Bug with unknown cause

- **WHEN** the cause of a reported bug is unknown
- **THEN** the agent runs the standard tier, investigates with a reproducer test on the branch, and moves up if the cause needs more

#### Scenario: Security advisory on a patch version

- **WHEN** a dependency update fixes a security advisory
- **THEN** the agent runs the standard tier with a package audit, whatever the version step

#### Scenario: Production data fix

- **WHEN** the change fixes data in production
- **THEN** the agent runs the full tier, dry-runs on a copy, and leaves the production run to the user

### Requirement: Request handling

Several requests in one prompt SHALL each get a tier, and the highest tier SHALL apply on a shared branch. Follow-ups on an open pull request SHALL keep its tier unless the work grows. Work beyond one session SHALL be split into issues first, each with its own tier.

#### Scenario: Typo and feature together

- **WHEN** one prompt asks for a typo fix and a new feature on the same branch
- **THEN** the branch follows the full tier

#### Scenario: Review comment on an open pull request

- **WHEN** a reviewer comments on a standard-tier pull request
- **THEN** the agent adds commits under the standard tier without a new issue or spec

#### Scenario: Review comment adds risk

- **WHEN** a reviewer comment on a standard-tier pull request asks for an authentication change
- **THEN** the agent names the full tier and asks before the next edit

#### Scenario: Multi-session feature

- **WHEN** a request needs several sessions
- **THEN** the agent proposes separate issues before the first edit
