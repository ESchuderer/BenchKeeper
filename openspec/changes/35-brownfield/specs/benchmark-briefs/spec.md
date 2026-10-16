## ADDED Requirements

### Requirement: Steps in separate sessions

A brief with `brief.json` `"steps": "sessions"` SHALL start every trial from the same baseline repository built once per run by its `prepare.sh`, SHALL run each step as a new agent session, and SHALL save a snapshot of the repository after each step. Briefs without that setting SHALL behave as before.

#### Scenario: Other briefs unchanged

- **WHEN** a winery-react trial runs after the change
- **THEN** it runs as one session and is scored as before

### Requirement: Scoring per step

The scorer SHALL score each step's snapshot with the brief's checks for that step and the repository's own test suite, and from step 2 on with cross-step checks against the previous snapshot; the trial parser SHALL record checks passed, time, follow-ups and cost per step.

#### Scenario: Reference passes

- **WHEN** the step references are scored
- **THEN** every check of every step passes

### Requirement: Brownfield checks validated

Each mutant of a step reference SHALL fail exactly the check it targets, and the reference SHALL pass every check.

#### Scenario: Validation

- **WHEN** `bench/briefs/openballistics/validate.sh` runs
- **THEN** it exits 0
