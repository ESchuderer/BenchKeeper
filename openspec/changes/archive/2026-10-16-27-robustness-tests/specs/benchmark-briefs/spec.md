## ADDED Requirements

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
