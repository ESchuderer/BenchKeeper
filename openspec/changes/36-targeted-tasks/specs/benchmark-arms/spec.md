## ADDED Requirements

### Requirement: Arm without one skill

The runner SHALL accept an arm `<arm>~<skill>` that runs on `<arm>`'s image with every copy of that skill removed before the first turn, and the audit SHALL fail the trial when the skill, with or without plugin prefix, is still in the init event's skills, slash commands or agents, or in a file under `$HOME/.claude` or the project.

#### Scenario: Skill removed

- **WHEN** a trial runs as `F~debugging-and-error-recovery`
- **THEN** its init event lists every agent-skills skill except `agent-skills:debugging-and-error-recovery`

### Requirement: Paired skill runs

Runs of a targeted task SHALL put the arm and its toggled arms in the same call, so every round has one trial with and one without each skill, in shuffled order.

#### Scenario: Pairs per round

- **WHEN** `bench/run-brief.sh <task> <model> high 5 <seed> "F F~<skill>"` finishes
- **THEN** each of the 5 rounds has a trial of `F` and of `F~<skill>`
