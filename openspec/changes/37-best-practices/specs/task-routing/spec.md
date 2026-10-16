## MODIFIED Requirements

### Requirement: Tier selection

The agent SHALL load the `sdlc` skill before any edit in a repository, before creating or editing a GitHub issue, before pushing or opening a pull request, and before research with two or more independent items; plain questions SHALL need neither. Following `sdlc`, the agent SHALL assign each request that leads to an edit or a subagent to one tier (quick, standard, full, research) and state it in one line before the first edit or subagent. An explicit tier from the user SHALL win; for a risky change the agent SHALL name the full tier and ask, and the user's answer SHALL decide. A project default tier SHALL apply when no other tier clearly matches. Tier steps, escalation, the research flow, change types, request handling and risky changes SHALL be defined in `sdlc`; the always-on rules SHALL keep only the trigger and the limits that hold without it (no commit, push or merge on the default branch and no pull request merge without the user's instruction). The Maintain pass SHALL run only when the user invokes it.

#### Scenario: Small UI change

- **WHEN** the user asks to change a button label
- **THEN** the agent loads `sdlc`, states the quick tier and skips the issue, spec and plan steps

#### Scenario: User override

- **WHEN** the user writes "full" for a request the agent would rate quick
- **THEN** the agent runs the full tier

#### Scenario: Lower tier with production impact

- **WHEN** the user writes "quick" for a production hotfix
- **THEN** the agent names the full tier and asks, follows the user's answer, and still reviews the commits before push

#### Scenario: Plain question

- **WHEN** the user asks what a function does and no edit or subagent is needed
- **THEN** the agent answers without loading `sdlc` and without a tier line

#### Scenario: Project default

- **WHEN** `AGENTS.md` sets the research tier as default and the request is ambiguous between research and a docs edit
- **THEN** the agent uses the research tier

#### Scenario: Research with several items

- **WHEN** the user asks to compare three tools
- **THEN** the agent loads `sdlc` and runs one subagent per tool

## ADDED Requirements

### Requirement: Permission rules

In Claude Code, native ask rules installed by `global-setup` SHALL prompt before skipping git hooks and before destructive or shared-history git and GitHub actions, including `git -C <path>` forms of the most destructive ones. These limits SHALL use no hooks; what a rule cannot see SHALL stay a prose rule and be listed in `global-setup` as not covered.

#### Scenario: Force push through git -C

- **WHEN** the agent runs `git -C ../repo push --force origin fix/x`
- **THEN** Claude Code asks before it runs

#### Scenario: Skipped hooks

- **WHEN** the agent runs `git commit -n -m x`
- **THEN** Claude Code asks before it runs

#### Scenario: Ordinary work

- **WHEN** the agent runs `git push origin fix/x`, `git commit --amend --no-edit`, or `git commit -m "chore: clean up docs"`
- **THEN** no rule matches and the command runs
