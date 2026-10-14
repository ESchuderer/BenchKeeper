## Purpose

Assign each request to a task tier so the agent runs only the SDLC steps and research flow the request needs.

## ADDED Requirements

### Requirement: Tier selection

The agent SHALL assign each request to one tier (quick, standard, full, research) before the first edit or search and state it in one line. An explicit tier from the user SHALL win; otherwise a default tier in the project's `AGENTS.md` SHALL apply when the request fits it.

#### Scenario: Small UI change

- **WHEN** the user asks to change a button label
- **THEN** the agent states the quick tier and skips the issue, spec and plan steps

#### Scenario: User override

- **WHEN** the user writes "full" for a request the agent would rate quick
- **THEN** the agent runs the full tier

#### Scenario: Project default

- **WHEN** `AGENTS.md` sets the research tier as default and the request asks a question without a code change
- **THEN** the agent uses the research tier

### Requirement: Tier steps

Quick SHALL run branch, edit, verify and commit, with a draft pull request. Standard SHALL add an issue, a failing test first where a test suite exists, and code review before push. Full SHALL add the spec (OpenSpec change when the repository has `openspec/`) and the task plan.

#### Scenario: Standard change in an OpenSpec repository

- **WHEN** a standard-tier change runs in a repository with `openspec/`
- **THEN** no OpenSpec change is created

#### Scenario: Full change in an OpenSpec repository

- **WHEN** a full-tier change runs in a repository with `openspec/`
- **THEN** the spec is written as an OpenSpec change and archived on the branch before merge

### Requirement: Escalation

The agent SHALL move to a higher tier and say so in one line when the work exceeds the current tier: more than one behavior, an uncertain approach, or security, data or production impact.

#### Scenario: Quick change grows

- **WHEN** a quick-tier change turns out to touch authentication
- **THEN** the agent states the full tier and continues with its steps

### Requirement: Research flow

The research tier SHALL answer without repository edits unless asked. For several items it SHALL run one subagent per item in parallel with the same evidence bar in each prompt: independent versus vendor results, version, setup, task count, runs per arm, deltas, advertised claims, and unverified items labeled.

#### Scenario: Several tools compared

- **WHEN** the user asks whether three tools improve cost
- **THEN** the agent runs three parallel subagents with the evidence bar and merges their results into one answer
