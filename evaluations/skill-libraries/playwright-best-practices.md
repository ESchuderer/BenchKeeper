# playwright-best-practices

[Repository](https://github.com/currents-dev/playwright-best-practices-skill), Category: skill libraries, Checked 2026-10-22, Decision: Per project, testing pack

## Advertised

- Vendor: Currents.dev (Playwright test reporting). Structural counts only, no performance claim: 57 reference documents in 8 categories ([README](https://github.com/currents-dev/playwright-best-practices-skill)), 35 topics in the [launch post](https://currents.dev/posts/playwright-best-practices-skill). The two counts differ.

## Independent evidence

- None for this skill.
- General: [SkillsBench](https://arxiv.org/abs/2602.12670) (87 tasks, 18 model-harness configurations) measured +16.6 percentage points for curated skills, with focused skills (3 modules or fewer) ahead of exhaustive bundles. This skill is large (SKILL.md 303 lines plus 57 reference files), so the result is context, not evidence for it.

## User reports

- 97.1K installs, first seen 2026-01-29, Snyk, Socket and Gen Agent Trust Hub checks passed ([skills.sh](https://skills.sh/currents-dev/playwright-best-practices-skill/playwright-best-practices)). [Show HN](https://news.ycombinator.com/item?id=46903511): 7 points, no comments.

## Skill authoring check

- Commit `283d5cbc5d11aac1abda058b16ad22c317d54dc0` (2026-07-21), MIT. No scripts. SKILL.md runs only `npx playwright test` variants and `show-trace`. No downloads, telemetry, credential requests or product links in SKILL.md and the reference files (grep). The README carries a tracked product link, which the install does not copy.

## Decision

Per project, testing pack (setup-v6.0): proposed only when the repository has or adds Playwright tests. Retest with a browser-test brief before it moves into any default.

[All evaluations](../../EVALUATIONS.md)
