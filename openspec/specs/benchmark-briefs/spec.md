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
