# Proposal

Issue: [#33](https://github.com/ESchuderer/BenchKeeper/issues/33)

## Why

The benchmark results live in Markdown reports and per-trial JSON files in `bench/results/`. The owner wants them on the site as a filterable database with the screenshots and ratings of every trial.

## What Changes

- A subpage `/bench/` of the Pages site with an overview of the briefs, and one page per brief, `/bench/<brief>/` (briefs are not mixed): one entry per trial with arm and setup, runtime, model, hidden test scores (features, robustness), the Opus review ratings, follow-ups, tests first, review step, minutes and the four screenshots.
- No cost figures on the page (owner decision; costs stay in the bench reports).
- Data read at build time from `bench/results/*/round-*/*/` by `web/scripts/bench-data.mjs` (with a node test); screenshots resized by Astro's image service.
- Filters per brief (runtime, model, framework, spec tool, BenchKeeper layer, Ponytail), text search and sorting in a small inline script; the filter state in the URL; the table renders without JavaScript.
- A link from the main page.

## Capabilities

### New Capabilities

- `bench-site`: the benchmark database page of the Pages site.

### Modified Capabilities

None.

## Impact

`web/` (new page, data module, test) and `.github/workflows/pages.yml` (node test step). The Pages build reads `bench/results/`.
