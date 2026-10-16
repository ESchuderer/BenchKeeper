## ADDED Requirements

### Requirement: Mutation score of the app's own tests

The scorer SHALL run a pinned mutation testing tool against each app's own test suite on a copy of the workspace, within a time limit, and `trial.json` SHALL report the mutation score with killed, survived, timed-out and uncovered mutants, or a `null` score with a reason when it cannot be measured (no test script, failing tests, time limit, or only time-outs).

#### Scenario: Weak tests

- **WHEN** an app's tests call its code without asserting its behavior
- **THEN** its mutation score is lower than the same app's with behavior assertions

#### Scenario: No tests

- **WHEN** an app has no test script or its tests fail before mutation
- **THEN** the mutation score is `null` with the reason
