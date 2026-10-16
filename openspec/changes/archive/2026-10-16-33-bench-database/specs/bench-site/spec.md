## ADDED Requirements

### Requirement: Briefs overview

The site SHALL have a page `/bench/` with one entry per brief that has published trials: the brief's first paragraph, the number of trials and arms, the runtimes, models and run dates, and a link to the brief's page.

#### Scenario: New run published

- **WHEN** a run of a new brief is published to `bench/results/` and the site is built
- **THEN** the overview lists the brief without a hand edit

### Requirement: One page per brief

Each brief SHALL have a page `/bench/<brief>/` that lists every trial of that brief from `bench/results/*/round-*/*/`, read at build time: arm, setup, runtime, model, features, robustness, review ratings, follow-ups, tests first, review step, minutes and screenshots. A page SHALL NOT mix briefs or show cost figures.

#### Scenario: Briefs kept apart

- **WHEN** two briefs have published trials
- **THEN** each brief's page lists only its own trials

#### Scenario: No costs

- **WHEN** the pages are built
- **THEN** they contain no USD amounts

### Requirement: Filter and sort

A brief's page SHALL filter its trials by runtime, model, framework, spec tool, BenchKeeper layer and Ponytail, search by text, and sort by any number column; the filter state SHALL be kept in the URL, and the full table SHALL render without JavaScript.

#### Scenario: Shared link

- **WHEN** a visitor opens a link with filter parameters
- **THEN** the page shows only the matching trials

### Requirement: Accessible in both themes

The pages SHALL have no axe violations in light and dark mode and SHALL not scroll horizontally at phone width outside the table's own scroll area.

#### Scenario: Dark mode

- **WHEN** the axe test runs in dark mode
- **THEN** it reports no violations
