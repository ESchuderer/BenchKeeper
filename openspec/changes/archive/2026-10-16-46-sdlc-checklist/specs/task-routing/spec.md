## ADDED Requirements

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
