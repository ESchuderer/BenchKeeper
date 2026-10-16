## ADDED Requirements

### Requirement: Trigger eval prompt sets

The benchmark SHALL keep, for each model-invocable skill of the benchmarked collections, 8 realistic requests that should load it and 8 that should not, at least 4 of the latter being near-misses that name the sibling skill which should handle them. Skills the model cannot invoke are left out.

#### Scenario: Near-miss of a sibling

- **WHEN** a should-not-trigger query names a sibling skill in `near_miss_of`
- **THEN** that sibling is a tested skill and the query differs from every other query of the same skill

### Requirement: Trigger evals in the arm image

The benchmark SHALL run the vendored skill-creator eval per skill in a container built from the collection's arm image, with the installed copy of the skill hidden from the model, one worker, model and effort as parameters, and the subscription usage gate before each skill.

#### Scenario: Installed copy hidden

- **WHEN** the eval injects the skill's description as a command
- **THEN** the installed skill has `disable-model-invocation: true` in that container and no other injected copy exists

### Requirement: Trigger precision and recall per skill

The benchmark SHALL report per skill, counted per run, recall (triggers on should-trigger runs), precision (share of all triggers that were on should-trigger runs) and false triggers, and n/a where a ratio has no runs or triggers.

#### Scenario: Skill without should-trigger queries

- **WHEN** a skill has only should-not-trigger queries
- **THEN** its recall and precision are n/a and its false triggers are reported
