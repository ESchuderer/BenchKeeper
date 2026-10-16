# benchmark-briefs Specification

## Purpose
Run a one-shot product brief through the benchmark arms headless and score every trial the same way.

## Requirements

### Requirement: Same task for every arm

Every arm SHALL get the brief text unchanged as the only user message, in an empty workspace, with the same model, effort, timeout and scorer; the hidden tests and `bench/` SHALL NOT be mounted into the agent container.

#### Scenario: Agent sandbox

- **WHEN** a trial starts
- **THEN** the agent container mounts only its workspace and log directory

### Requirement: Validated hidden tests

The hidden tests SHALL pass on the reference app and each mutant SHALL fail exactly its feature before a run uses them.

#### Scenario: Mutant

- **WHEN** the capacity check is removed from the reference app
- **THEN** only feature F3 fails

### Requirement: Delivery audit

Each trial SHALL be checked against its arm's expected plugins, marker skills or agents and SessionStart output; a trial that shows another arm's markers or misses its own SHALL be invalid.

#### Scenario: Wrong arm

- **WHEN** a trial of arm D lists the `tdd-workflow` skill from ECC
- **THEN** the audit fails and the trial is excluded and reported

### Requirement: Robustness score

The hidden tests SHALL include robustness tests (titles starting with `R`), each traceable to a sentence of the brief, scored separately from the feature tests (titles starting with `F`); each robustness test SHALL have a mutant of the reference app that fails it.

#### Scenario: Concurrent bookings

- **WHEN** two bookings for the last seats of a tasting are submitted at the same time
- **THEN** exactly one is confirmed and the seats left never go below zero

#### Scenario: Data behind sign-in

- **WHEN** a client without a staff session requests any URL the signed-in staff page loaded
- **THEN** no response contains booking data

#### Scenario: Separate score

- **WHEN** a trial is parsed
- **THEN** `trial.json` holds `features_passed` (of 6) and `robustness_passed` (of 12) separately

### Requirement: Mutation score of the app's own tests

The scorer SHALL run a pinned mutation testing tool against each app's own test suite on a copy of the workspace, within a time limit, and `trial.json` SHALL report the mutation score with killed, survived, timed-out and uncovered mutants, or a `null` score with a reason when it cannot be measured (no test script, failing tests, time limit, or only time-outs).

#### Scenario: Weak tests

- **WHEN** an app's tests call its code without asserting its behavior
- **THEN** its mutation score is lower than the same app's with behavior assertions

#### Scenario: No tests

- **WHEN** an app has no test script or its tests fail before mutation
- **THEN** the mutation score is `null` with the reason
