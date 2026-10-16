## ADDED Requirements

### Requirement: Benchmark summary page

The site SHALL have one page `/bench/` with an entry per published run (brief and model): one sentence on the brief, the model, effort, k and protocol version, a ranked table per runtime, up to 5 key findings, and a link to the run's Markdown report on GitHub. The page SHALL also link the benchmark reports that have no trials, and SHALL NOT show cost figures or excluded components.

#### Scenario: No costs

- **WHEN** the page is built
- **THEN** it contains no USD amounts

### Requirement: Ranked tables from the data

Each table SHALL be generated at build time from `bench/results/*/round-*/*/` and list the run's arms of one runtime ranked by review overall, then features, robustness and fewer minutes: rank, arm, setup in plain words, features, robustness, review, minutes.

#### Scenario: New run published

- **WHEN** a new run is published to `bench/results/` and the site is built
- **THEN** the page shows its setup and ranked table without a hand edit

## MODIFIED Requirements

### Requirement: Accessible in both themes

The summary page SHALL have no axe violations in light and dark mode and SHALL not scroll horizontally at phone width outside the tables' own scroll areas.

#### Scenario: Dark mode

- **WHEN** the axe test runs in dark mode
- **THEN** it reports no violations

## REMOVED Requirements

### Requirement: Briefs overview

**Reason**: replaced by the benchmark summary page (owner decision).

**Migration**: `/bench/` shows the summary; the full results stay in `bench/results/*.md`.

### Requirement: One page per brief

**Reason**: owner decision: one summary page, the per-trial pages go away.

**Migration**: per-trial data stays in `bench/results/<run>/round-<n>/<arm>/` and the Markdown reports.

### Requirement: Filter and sort

**Reason**: the per-brief pages that had the filters are removed.

**Migration**: none.
