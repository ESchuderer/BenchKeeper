# task-routing Specification

## Purpose
Assign each request to a task tier so the agent runs only the SDLC steps and research flow the request needs.

## Requirements

### Requirement: Tier selection

The agent SHALL assign each request that leads to an edit or a subagent to one tier (quick, standard, full, research) and state it in one line before the first edit or subagent. An explicit tier from the user SHALL win; for a risky change the agent SHALL name the full tier and ask, and the user's answer SHALL decide. A project default tier SHALL apply when no other tier clearly matches.

#### Scenario: Small UI change

- **WHEN** the user asks to change a button label
- **THEN** the agent loads `following-dev-workflow`, states the quick tier and skips the issue, spec and plan steps

#### Scenario: User override

- **WHEN** the user writes "full" for a request the agent would rate quick
- **THEN** the agent runs the full tier

#### Scenario: Lower tier with production impact

- **WHEN** the user writes "quick" for a production hotfix
- **THEN** the agent names the full tier and asks, follows the user's answer, and still reviews the commits before push

#### Scenario: Plain question

- **WHEN** the user asks what a function does and no edit or subagent is needed
- **THEN** the agent answers without loading `following-dev-workflow` and without a tier line

#### Scenario: Project default

- **WHEN** `AGENTS.md` sets the research tier as default and the request is ambiguous between research and a docs edit
- **THEN** the agent uses the research tier

#### Scenario: Research with several items

- **WHEN** the user asks to compare three tools
- **THEN** the agent loads `following-dev-workflow` and runs one subagent per tool

### Requirement: Skill loading

The agent SHALL load the `following-dev-workflow` skill before any edit in a repository, before creating or editing a GitHub issue, before pushing or opening a pull request, and before research with two or more independent items; plain questions SHALL need neither.

#### Scenario: Push without an edit

- **WHEN** the user asks to push the current branch and open a pull request
- **THEN** the agent loads `following-dev-workflow` first and runs its pre-push review

#### Scenario: Question

- **WHEN** the user asks what a function does
- **THEN** the agent answers without loading `following-dev-workflow`

### Requirement: Workflow location

Tier steps, escalation, the research flow, change types, request handling and risky changes SHALL be defined in `following-dev-workflow`. The always-on rules SHALL keep only the trigger and the limits that hold without it: no commit, push or merge on the default branch and no pull request merge without the user's instruction. The Maintain pass SHALL run only when the user invokes it.

#### Scenario: Skill not loaded

- **WHEN** the agent has not loaded `following-dev-workflow` and is about to push to the default branch
- **THEN** it does so only on the user's instruction

#### Scenario: Maintain

- **WHEN** a milestone is merged
- **THEN** the agent suggests `/maintaining-repos` and does not run it

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

The agent SHALL move to the tier the work now fits and say so when it exceeds the current tier: more than one behavior, several files not counting generated ones such as lockfiles, code not yet read, an uncertain approach, or a risky change. It SHALL run the new tier's skipped steps before the next edit.

#### Scenario: Quick change grows

- **WHEN** a quick-tier change turns out to touch authentication
- **THEN** the agent states the full tier and creates the issue, spec and plan before the next edit

#### Scenario: Lockfile does not count

- **WHEN** a quick-tier dependency patch changes the manifest and the lockfile
- **THEN** the agent stays on the quick tier

### Requirement: Research flow

The research tier SHALL answer without repository edits; scratch files outside the repository SHALL be allowed for spikes; edits asked for afterwards SHALL get their own tier. One fact SHALL be answered directly. Two or more independent items SHALL get one parallel subagent each, with the objective, output format and sources in each prompt, and the evidence bar where claims rest on benchmarks.

#### Scenario: Several tools compared

- **WHEN** the user asks whether three tools improve cost
- **THEN** the agent runs three parallel subagents with the evidence bar and merges their results into one answer

#### Scenario: Results recorded afterwards

- **WHEN** the user asks to record the research results in a file
- **THEN** the agent states a tier for that edit and follows it

#### Scenario: Spike

- **WHEN** answering a question needs a throwaway prototype
- **THEN** the agent writes it outside the repository and makes no repository edit

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

### Requirement: Risky changes

A risky change SHALL be one to authentication, permissions, secrets or input validation, to production data, deploy or production configuration, or an irreversible action. A risky change SHALL get the pre-push review in every tier.

#### Scenario: Risky change on the quick tier

- **WHEN** the user keeps a production config change on the quick tier
- **THEN** the agent still reviews the commits before push

### Requirement: Decisions before Build

In the full tier, the Specify step SHALL record the deployment target, data storage, module boundaries and core types and interfaces before Build; a skeleton of folders, interfaces and boundary notes SHALL be written first only when the user asks for it or the repository has no structure yet.

#### Scenario: New service

- **WHEN** a full-tier task creates a new service
- **THEN** the spec names its deployment target, storage and module boundaries before any implementation

### Requirement: Discard and restart

When an agent's work drifts materially from the plan or spec (a different design or scope), or its result cannot be explained against them, the worktree or local branch created for the task and not yet pushed SHALL be discarded and the task restarted in a fresh context with the cause added to the plan, instead of being patched; a pushed branch is deleted only after confirmation.

#### Scenario: Drifted worktree

- **WHEN** a review finds that an unpushed worktree implements a different design than the plan
- **THEN** the worktree is discarded and the task restarts with the corrected plan

### Requirement: Review with intent

The pre-push review SHALL receive the diff together with the plan or spec summary, and the pull request body SHALL list the key decisions.

#### Scenario: Pre-push review

- **WHEN** the reviewer is started before a push
- **THEN** its input contains the diff and the plan summary, not the whole repository

### Requirement: Documentation in scope

A new project or app SHALL get a README with setup, run, test and configuration, and a change to setup or behavior SHALL update it; the scope rule SHALL NOT exclude documentation the task needs.

#### Scenario: New app

- **WHEN** an agent creates a new app
- **THEN** the change includes a README with setup, run and test instructions

### Requirement: Opt-in checks for hard tasks

Best-of-N (2 or 3 worktrees with the same task, selection by tests first, then review) and mutation testing on changed files SHALL run only when the user explicitly asks for them.

#### Scenario: Not asked

- **WHEN** a full-tier task runs and the user did not ask for best-of-N or mutation testing
- **THEN** neither runs
