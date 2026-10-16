## ADDED Requirements

### Requirement: Every published trial on the page

The site SHALL have a page `/bench/` that lists every trial in `bench/results/*/round-*/*/` with its arm, setup, runtime, model, features passed, robustness passed, review ratings, follow-ups, tests first, review step, minutes and screenshots, read at build time; it SHALL NOT show cost figures.

#### Scenario: New run published

- **WHEN** a run is published to `bench/results/` and the site is built
- **THEN** the page lists its trials without a hand edit

#### Scenario: No costs

- **WHEN** the page is built
- **THEN** it contains no USD amounts

### Requirement: Filter and sort

The page SHALL filter the trials by brief, runtime, model, framework, spec tool, BenchKeeper layer and Ponytail, search by text, and sort by any number column; the filter state SHALL be kept in the URL, and the full table SHALL render without JavaScript.

#### Scenario: Shared link

- **WHEN** a visitor opens a link with filter parameters
- **THEN** the page shows only the matching trials

### Requirement: Accessible in both themes

The page SHALL have no axe violations in light and dark mode and SHALL not scroll horizontally at phone width outside the table's own scroll area.

#### Scenario: Dark mode

- **WHEN** the axe test runs in dark mode
- **THEN** it reports no violations
