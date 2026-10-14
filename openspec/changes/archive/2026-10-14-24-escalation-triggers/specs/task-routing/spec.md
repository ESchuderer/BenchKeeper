## MODIFIED Requirements

### Requirement: Escalation

The agent SHALL move to the tier the work now fits and say so when it exceeds the current tier: more than one behavior, several files not counting generated ones such as lockfiles, code not yet read, an uncertain approach, or a risky change. It SHALL run the new tier's skipped steps before the next edit.

#### Scenario: Quick change grows

- **WHEN** a quick-tier change turns out to touch authentication
- **THEN** the agent states the full tier and creates the issue, spec and plan before the next edit

#### Scenario: Lockfile does not count

- **WHEN** a quick-tier dependency patch changes the manifest and the lockfile
- **THEN** the agent stays on the quick tier
