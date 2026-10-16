## ADDED Requirements

### Requirement: Arm without one skill

The runner SHALL accept an arm `<arm>~<skill>` that runs on `<arm>`'s image with that one skill removed in the trial's container before the first turn, and the delivery audit SHALL fail the trial when the skill is still listed or another expected skill is missing.

#### Scenario: Skill removed

- **WHEN** a trial runs as `F~debugging-and-error-recovery`
- **THEN** its init event lists every agent-skills skill except `agent-skills:debugging-and-error-recovery`

### Requirement: Paired skill runs

Runs of a targeted task SHALL put the arm and its toggled arms in the same call, so every round has one trial with and one without each skill, in shuffled order.

#### Scenario: Pairs per round

- **WHEN** `bench/run-brief.sh <task> <model> high 5 <seed> "F F~<skill>"` finishes
- **THEN** each of the 5 rounds has a trial of `F` and of `F~<skill>`
