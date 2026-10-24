# playwright-best-practices

[Repository](https://github.com/currents-dev/playwright-best-practices-skill), Category: skill libraries, Checked 2026-10-22 and 2026-10-24, Decision: Per project, testing pack

## Advertised

- Vendor: Currents.dev (Playwright test reporting). Structural counts only, no performance claim: 57 reference documents in 8 categories ([README](https://github.com/currents-dev/playwright-best-practices-skill)), 35 topics in the [launch post](https://currents.dev/posts/playwright-best-practices-skill). The two counts differ.

## Independent evidence

- None for this skill.
- General: [SkillsBench](https://arxiv.org/abs/2602.12670) (87 tasks, 18 model-harness configurations) measured +16.6 percentage points for curated skills, with focused skills (3 modules or fewer) ahead of exhaustive bundles. This skill is large (SKILL.md 303 lines plus 57 reference files), so the result is context, not evidence for it.

## User reports

- 98.0K installs (2026-10-24), first seen 2026-01-29, Snyk, Socket and Gen Agent Trust Hub checks passed ([skills.sh](https://skills.sh/currents-dev/playwright-best-practices-skill/playwright-best-practices)). [Show HN](https://news.ycombinator.com/item?id=46903511): 7 points, no comments.

## Skill authoring check

- Commit `283d5cbc5d11aac1abda058b16ad22c317d54dc0` (2026-07-21), MIT. No scripts. SKILL.md runs only `npx playwright test` variants and `show-trace`. No downloads, telemetry, credential requests or product links in SKILL.md and the reference files (grep). The README carries a tracked product link, which the install does not copy.

## Quality bar check (issue 151, 2026-10-24)

Source [currents-dev/playwright-best-practices-skill](https://github.com/currents-dev/playwright-best-practices-skill) at `283d5cbc5d11aac1abda058b16ad22c317d54dc0` (2026-07-21, tip of `main`).

Grading used (the same for every source; the bar is in [library quality bar](library-quality-bar.md)): pass, borderline (soft problems only, or a reading of the bar that the owner decides) or fail (a hard limit broken). Overall is the worst point.

| Skill | 1 Runs as installed | 2 License | 3 Authoring | 4 Earns its place | 5 Maintained | Overall |
|---|---|---|---|---|---|---|
| `playwright-best-practices` | borderline | pass | borderline | pass | pass | borderline |

Measured at the pin:

| Skill | Description characters | `SKILL.md` lines | License | Effect evidence |
|---|---|---|---|---|
| `playwright-best-practices` | 984 | 303 | frontmatter and root MIT | none; defect reports (open PR #13) |

Findings (every fail and borderline with file and line or URL):

- `playwright-best-practices`: borderline.
  - Point 1, borderline: Reference files install unpinned packages: `@axe-core/playwright` (`testing-patterns/accessibility.md:16`), `playwright-lighthouse lighthouse` (`performance-testing.md:327`), `nyc` (`infrastructure-ci-cd/test-coverage.md:21`), `electron` (`testing-patterns/electron.md:18`), `npm init playwright@latest` (`frameworks/vue.md:19-20`), `dotenv`, `@faker-js/faker`; `testing-patterns/performance-testing.md:68` loads `unpkg.com/web-vitals@3` at test run time. `SKILL.md:296-303` itself runs only `npx playwright test` and `show-trace`.
  - Point 3, borderline: Description 984 of 1,024 characters. 195 links between the 58 reference files (not one level deep, not needed by the workflow); 7 dead cross-links (`advanced/network-advanced.md:401-402`, `browser-apis/service-workers.md:257, 501`, `debugging/error-testing.md:165`, `debugging/flaky-tests.md:202`, `infrastructure-ci-cd/performance.md:131`); image tags v1.40.0 and v1.48.0 (`ci-cd.md:140`, `docker.md:24`).
  - Other: Open outside PR currents-dev/playwright-best-practices-skill#13 reports the 7 dead links and wrong Playwright API examples (soft assertions, `waitForFunction`, shadow locators, GraphQL parsing, WebSocket routing, service workers) checked against Playwright 1.64.1. Pin is the tip of `main` (2026-07-21).

Source notes:

- Point 5: not archived, 0 commits since the pin, 26 commits in total since 2026-01-28.
- Point 2: `license: MIT` in the frontmatter (`SKILL.md:4`) and the MIT `LICENSE.md` at the root; no license file in the skill folder.
- Measured at the pin, correcting the counts above: 58 reference files (26,051 lines, 16 of them over 500 lines), not 57. skills.sh showed 97.1K installs before this check.
- Install history: issues 9 and 11 (the skills CLI installed only `SKILL.md`, leaving reference links broken) were fixed by moving the skill into `playwright-best-practices/` (commit 283d5cb, the pin). Issue 14 (2026-10-23, open) is an anecdotal user report.

Removal: none made. The owner decides on the fails and borderline cases in [issue 151](https://github.com/ESchuderer/BenchKeeper/issues/151).

## Decision

Per project, testing pack (setup-v6.0): proposed only when the repository has or adds Playwright tests. Retest with a browser-test brief before it moves into any default.

[All evaluations](../../EVALUATIONS.md)
