## ADDED Requirements

### Requirement: Skills inventory with usage

The benchmark SHALL list every skill each framework adds to its arm (the arm's init skills minus the plain arm's), with phase, estimated size and description from the installed skill file, and the number of saved trials in which the skill fired out of the trials whose arm had it installed.

#### Scenario: Skill not installed in an arm

- **WHEN** a trial's arm does not have a skill installed
- **THEN** that trial does not count toward the skill's usage
