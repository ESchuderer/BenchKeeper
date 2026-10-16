## ADDED Requirements

### Requirement: Targeted task per phase

The benchmark SHALL have at least one targeted task for each phase (plan, specify, develop, test, debug, review, ship): a one-step brief with `"phase"` in `brief.json`, a fixture repository built by `prepare.sh` without network, and checks that run without network and without an LLM judge.

#### Scenario: Offline scoring

- **WHEN** a targeted task's checks score a workspace
- **THEN** every check runs in a container without network, without the task's references and mutants mounted, and writes `ok` true, false or null

### Requirement: Targeted task checks validated

Each targeted task's `validate.sh` SHALL show that the baseline fails the task's checks, the reference and each listed alternative valid solution pass every check, the reference passes the repository's suite, and each mutant fails exactly the checks it names.

#### Scenario: Validation

- **WHEN** `bench/briefs/skill-<phase>-<slug>/validate.sh` runs
- **THEN** it exits 0 and prints the failing checks of each case

### Requirement: Existing tests kept

Every targeted task SHALL include `S1-regressions`: the baseline's test files, copied over the workspace's, pass, unless another check of the task already covers them.

#### Scenario: Test deleted

- **WHEN** an agent deletes or weakens a baseline test and breaks the behavior it covered
- **THEN** `S1-regressions` fails
