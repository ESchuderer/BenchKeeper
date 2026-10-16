# Proposal

Issue: none (owner request in the session).

## Why

The owner asked for a summary of the benchmarks on the site; the full results stay in the Markdown reports. Owner decision: one summary page, the per-trial pages go away.

## What Changes

- `/bench/` becomes one summary page: per published run (brief and model) one sentence on the brief, the setup facts (model, effort, k, protocol version), per runtime a table of the arms ranked by review (setup, features, robustness, review, minutes), 3 to 5 key findings and a link to the Markdown report; short entries with links for the reports that have no trials.
- The per-brief pages `/bench/<brief>/` with filters, sorting, screenshots and per-trial cards are removed, with the code only they used.
- Tables are generated from `bench/results/*/round-*/*/` at build time; findings are short static text per run. No cost figures.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bench-site`: one summary page instead of an overview and one page per brief.

## Impact

`web/` only: `web/src/pages/bench/`, `web/src/components/Bench.tsx`, `web/src/layouts/BenchLayout.astro`, `web/scripts/bench-data.mjs`, `web/tests/`.
