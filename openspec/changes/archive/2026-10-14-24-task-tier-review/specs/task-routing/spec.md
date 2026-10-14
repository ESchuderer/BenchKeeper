## MODIFIED Requirements

### Requirement: Tier selection

The agent SHALL assign each request that leads to an edit or a subagent to one tier (quick, standard, full, research) and state it in one line before the first edit or subagent. An explicit tier from the user SHALL win, except that security, data or production impact SHALL require the full tier after asking. A project default tier SHALL apply when no other tier clearly matches.

#### Scenario: Small UI change

- **WHEN** the user asks to change a button label
- **THEN** the agent states the quick tier and skips the issue, spec and plan steps

#### Scenario: User override

- **WHEN** the user writes "full" for a request the agent would rate quick
- **THEN** the agent runs the full tier

#### Scenario: Lower tier with production impact

- **WHEN** the user writes "quick" for a change that alters production data
- **THEN** the agent names the full tier and asks before continuing

#### Scenario: Plain question

- **WHEN** the user asks what a function does and no edit or subagent is needed
- **THEN** the agent answers without a tier line

#### Scenario: Project default

- **WHEN** `AGENTS.md` sets the research tier as default and the request is ambiguous between research and a docs edit
- **THEN** the agent uses the research tier

### Requirement: Tier steps

Quick SHALL run branch, edit, verify and commit, with a draft pull request, and no test first or pre-push review. Standard SHALL add an issue, a failing test first where a test suite exists, and code review before push, or before reporting done without a remote. Full SHALL add the spec (OpenSpec change when the repository has `openspec/`) and the task plan. The tiers SHALL take precedence over a skill's own triggers.

#### Scenario: Standard change in an OpenSpec repository

- **WHEN** a standard-tier change runs in a repository with `openspec/`
- **THEN** no OpenSpec change is created

#### Scenario: Full change in an OpenSpec repository

- **WHEN** a full-tier change runs in a repository with `openspec/`
- **THEN** the spec is written as an OpenSpec change and archived on the branch before merge

#### Scenario: Skill asks for more

- **WHEN** a loaded skill asks for a review on every change and the tier is quick
- **THEN** the agent skips the review

### Requirement: Escalation

The agent SHALL move to the tier the work now fits and say so when it exceeds the current tier: more than one behavior, several files, code not yet read, an uncertain approach, or security, data or production impact. It SHALL run the new tier's skipped steps before the next edit.

#### Scenario: Quick change grows

- **WHEN** a quick-tier change turns out to touch authentication
- **THEN** the agent states the full tier and creates the issue, spec and plan before the next edit

### Requirement: Research flow

The research tier SHALL answer without repository edits; edits asked for afterwards SHALL get their own tier. One fact SHALL be answered directly. Two or more independent items SHALL get one parallel subagent each, with the objective, output format and sources in each prompt, and the evidence bar where claims rest on benchmarks.

#### Scenario: Several tools compared

- **WHEN** the user asks whether three tools improve cost
- **THEN** the agent runs three parallel subagents with the evidence bar and merges their results into one answer

#### Scenario: Results recorded afterwards

- **WHEN** the user asks to record the research results in a file
- **THEN** the agent states a tier for that edit and follows it
