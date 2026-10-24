# marketingskills

[Repository](https://github.com/coreyhaines31/marketingskills), Category: skill libraries, Checked 2026-10-18 and 2026-10-24, Decision: Not global, per project

## Advertised

- 50 marketing skills (copy, SEO, CRO, launch, analytics, channels), MIT, 55,337 stars on 2026-10-18.
- Each skill is a SKILL.md with references and evals, no scripts, no API keys. The skills read `.agents/product-marketing.md` when it exists.
- No independent task-level evaluation found. The Agentic Leaderboard ranks the repository 79th from static repository data, not from runs ([methodology](https://www.theagenticleaderboard.com/methodology/)).

## User reports

The owner used nine of these skills, installed globally, in one marketing project (PiMetry): 1 call each in the session transcripts of 2026-09-29 to 2026-10-18, `copywriting` 3.

## Quality bar check (issue 151, 2026-10-24)

Source [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) at `ad6903e9b89caa5e06e2032793a0deb5dab2cdb4` (2026-10-15).

Grading used (the same for every source; the bar is in [library quality bar](library-quality-bar.md)): pass, borderline (soft problems only, or a reading of the bar that the owner decides) or fail (a hard limit broken). Overall is the worst point.

| Skill | 1 Runs as installed | 2 License | 3 Authoring | 4 Earns its place | 5 Maintained | Overall |
|---|---|---|---|---|---|---|
| `product-marketing` | pass | pass | pass | pass | pass | pass |
| `copywriting` | borderline | pass | pass | borderline | pass | borderline |
| `copy-editing` | pass | pass | borderline | borderline | pass | borderline |
| `seo-audit` | pass | pass | borderline | pass | pass | borderline |
| `ai-seo` | borderline | pass | borderline | pass | pass | borderline |
| `schema` | pass | pass | pass | pass | pass | pass |
| `launch` | borderline | pass | pass | pass | pass | borderline |
| `site-architecture` | pass | pass | pass | pass | pass | pass |
| `content-strategy` | borderline | pass | borderline | pass | pass | borderline |
| `cro` | pass | pass | pass | borderline | pass | borderline |
| `directory-submissions` | borderline | pass | borderline | borderline | pass | borderline |
| `analytics` | borderline | pass | pass | pass | pass | borderline |

Measured at the pin:

| Skill | Description characters | `SKILL.md` lines | License | Effect evidence |
|---|---|---|---|---|
| `product-marketing` | 549 | 255 | root `LICENSE` MIT | none; skills.sh 83.3K installs, scans pass |
| `copywriting` | 946 | 286 | root `LICENSE` MIT | none; skills.sh 233.8K installs |
| `copy-editing` | 812 | 489 | root `LICENSE` MIT | none; skills.sh 148.1K installs |
| `seo-audit` | 679 | 499 | root `LICENSE` MIT | none; skills.sh 236.2K installs, Snyk Warn (W011) |
| `ai-seo` | 1004 | 487 | root `LICENSE` MIT | independent issue marketingskills#599 (advice wrong at the pin) |
| `schema` | 526 | 179 | root `LICENSE` MIT | none; skills.sh 77.4K installs, scans pass |
| `launch` | 549 | 381 | root `LICENSE` MIT | none; skills.sh 77.3K installs |
| `site-architecture` | 670 | 357 | root `LICENSE` MIT | none; skills.sh 122.0K installs, scans pass |
| `content-strategy` | 659 | 439 | root `LICENSE` MIT | none; skills.sh 162.9K installs, Snyk Warn (W011) |
| `cro` | 654 | 187 | root `LICENSE` MIT | none; skills.sh 89.3K installs, Snyk Warn (W011); QA-bot grade C (marketingskills#520) |
| `directory-submissions` | 905 | 392 | root `LICENSE` MIT | none; skills.sh Gen Agent Trust Hub Fail (CRITICAL, 2026-10-22) |
| `analytics` | 796 | 311 | root `LICENSE` MIT | none; skills.sh 83.3K installs, scans pass |

Findings (every fail and borderline with file and line or URL):

- `product-marketing`: pass.
  - Other: Only outside path is the project file `.agents/product-marketing.md` (`SKILL.md:12, 18, 132, 244`).
- `copywriting`: borderline.
  - Point 1, borderline: `references/ai-tells.md:261` tells the agent to read `references/ai-writing-detection.md` of the `seo-audit` skill, which is not in this folder (optional pointer).
  - Point 4, borderline: Shares "sounds like AI" and "improve this copy" with `copy-editing` (`SKILL.md:3` of both) and landing, pricing and homepage text with `cro` (`cro/SKILL.md:41-63`).
- `copy-editing`: borderline.
  - Point 3, borderline: 489 lines (400 to 500 band); `references/content-refresh.md:15` "in 2024" example.
  - Point 4, borderline: Partial overlap with `copywriting` on the AI-slop trigger; `SKILL.md:3` defers new copy to `copywriting`.
- `seo-audit`: borderline.
  - Point 3, borderline: 499 lines (limit 500, two references); dated text at `SKILL.md:216` ("Google's 2025 stance") and `references/international-seo.md:162, 183-185, 204`.
- `ai-seo`: borderline.
  - Point 1, borderline: `SKILL.md:458` links `../../tools/REGISTRY.md` and the table below it has no in-folder guide (optional partner tool links; owner call: fail or borderline); `SKILL.md:280` and `references/agent-readiness.md:9` run `npx is-agentic <domain>` (unpinned).
  - Point 3, borderline: Description 1,004 of 1,024 characters; 487 lines; 60 dated lines (`SKILL.md:63` "Dec 2025 data", `:255` "Aug 2026", `:324` "June 2026", `:361` "forthcoming protocol", `:371` model-version claims); nested references (`references/positioning-and-consensus.md:59, 90`, `platform-ranking-factors.md:95`, `format-volatility.md:3, 63`).
  - Other: The pin still has the robots.txt advice that issue #599 reported (training bots named as citation bots: `SKILL.md:161-164, 427, 450`, `references/platform-ranking-factors.md:122-127`), fixed at the tip (ai-seo 2.10.1). 11 commits touched the folder since the pin: re-pin before keeping it.
- `schema`: pass.
- `launch`: borderline.
  - Point 1, borderline: `SKILL.md:96` points to `../../tools/integrations/introw.md`, a repo-level file not in the folder; one optional parenthetical, the rest of the workflow is in the folder.
- `site-architecture`: pass.
- `content-strategy`: borderline.
  - Point 1, borderline: `references/headless-cms.md:192-194` links `../../../tools/integrations/{sanity,contentful,strapi}.md`, not in the folder (optional; owner call: fail or borderline).
  - Point 3, borderline: 439 lines (400 to 500 band); `SKILL.md:129` "Foundation Inc.'s ... Report (March 2026 ...)".
- `cro`: borderline.
  - Point 4, borderline: Partial overlap with `copywriting` on page text (headline and CTA rubric `SKILL.md:41-63` against `copywriting/SKILL.md:3`).
- `directory-submissions`: borderline.
  - Point 1, borderline: `references/directory-list.md:186` `brew install mcp-publisher` (unpinned); runs `curl` and `dig` against listed third-party sites (`SKILL.md:130, 140`, `directory-list.md:542`).
  - Point 3, borderline: Dated claims at `SKILL.md:146, 177, 196, 239, 249, 291, 330, 341` ("2026 PH algorithm", "G2 ... as of Feb 2026"); `references/submission-tracker-template.csv` has 14 URLs that return 404 (for example line 6, 79) and 13 with no response (lines 10, 46, 67).
  - Point 4, borderline: Shares "Product Hunt" and launch directories with `launch`. skills.sh Gen Agent Trust Hub Fail (CRITICAL) on 2026-10-22 flagged the domain fitprofessionals.net (`csv:271`) and the csv (FileRepMalware): not verified, scanned a newer version; https://www.skills.sh/coreyhaines31/marketingskills/directory-submissions/security/agent-trust-hub
- `analytics`: borderline.
  - Point 1, borderline: `SKILL.md:292` links `../../tools/REGISTRY.md` and the table at `:296-300` links five files `../../tools/integrations/{ga4,mixpanel,amplitude,posthog,segment}.md`, none in the folder; its own `references/` exist (optional partner tool links; owner call: fail or borderline).

Source notes:

- Point 5: not archived, pin 9 days old, newest commit on `main` 2026-10-19 (e85f3cb). Every skill changed since the pin (first-parent commits touching the folder: `ai-seo` 11, `seo-audit` 5, `analytics` 5, `copywriting` 3, `launch` 3, `content-strategy` 3, `cro` 3, `copy-editing` 2, `schema` 2, `directory-submissions` 2, `product-marketing` 1, `site-architecture` 1).
- License location: no license file and no `license:` frontmatter in any of the 12 folders (frontmatter keys are `name`, `description`, `metadata.version`). The root `LICENSE` is MIT (Copyright (c) 2025 Corey Haines), so an install carries no license text.
- The four `tools/` links (`analytics/SKILL.md:292-300`, `ai-seo/SKILL.md:458`, `launch/SKILL.md:96`, `content-strategy/references/headless-cms.md:192-194`) point to integration guides for partner tools (funded by the partners) (README line 15). At the default branch tip they became links to `tools/` on the `main` branch of the repository, so a re-pin does not clear them.
- Descriptions and related-skill sections name skills that are not in the library (emails, popups, offers, social, signup, onboarding, programmatic-seo, marketing-ideas, competitors, conversion-tracking, attribution, ab-testing): soft, not graded alone.
- skills.sh (2026-10-24): 77.3K (`launch`) to 236.2K (`seo-audit`) installs; all scans pass except Snyk Warn (W011) on `seo-audit`, `content-strategy`, `cro`, and Gen Agent Trust Hub Fail plus Snyk Warn on `directory-submissions`.
- Independent: one practitioner write-up covers CRO and programmatic SEO, not this set ([mejba.me](https://www.mejba.me/blog/claude-code-marketing-powerhouse), 2026-03-05). Third-party issues: #599 (`ai-seo` bot guidance, fixed later), #520 (QA bot grade C), #450, #243. Link check: 368 URLs, dozens of dead directory submit pages (`directory-submissions` only).

Removal: none made. The owner decides on the fails and borderline cases in [issue 151](https://github.com/ESchuderer/BenchKeeper/issues/151).

## Decision

Not global, per project: the BenchKeeper library (setup-v5.0) lists a core set (`product-marketing`, `copywriting`, `copy-editing`, `seo-audit`, `ai-seo`, `schema`, `launch`, `site-architecture`) and an optional set (`content-strategy`, `cro`, `directory-submissions`, `analytics`) for product sites and launches. Channel and funnel skills (ads, email, sales, paywalls) are left to the search. The marketing pack (setup-v6.0) proposes `product-marketing`, `copywriting`, `copy-editing`, `seo-audit` and `launch` together; the other skills stay single choices. No new evidence for the pack.

[All evaluations](../../EVALUATIONS.md)
