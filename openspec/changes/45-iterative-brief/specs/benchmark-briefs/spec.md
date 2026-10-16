## ADDED Requirements

### Requirement: Checkpoints with regressions counted

An iterative brief SHALL send its change requests in a fixed order as follow-up turns in the same session, score the app after each checkpoint, and count a checkpoint as strictly passed only when the hidden tests of all checkpoints so far pass.

#### Scenario: Regression

- **WHEN** a change request breaks a feature of an earlier checkpoint
- **THEN** that checkpoint does not pass strictly, even if its own tests pass

### Requirement: Code erosion metrics

Each checkpoint SHALL record erosion (the share of cyclomatic complexity in functions above complexity 10), duplication (the share of cloned lines) and source lines, measured with pinned tools on the app's source without dependencies.

#### Scenario: Growing duplication

- **WHEN** an app implements the same logic again in a later checkpoint
- **THEN** its duplication share at that checkpoint is higher than at the previous one

### Requirement: Scaffold condition

The benchmark SHALL be able to start an arm from a prepared skeleton workspace (folders, core types, interfaces, boundary notes) instead of an empty one, and SHALL record the condition in `trial.json`.

#### Scenario: Same arm, two conditions

- **WHEN** an arm runs with and without the skeleton
- **THEN** both trials report the same metrics and are labeled by condition
