# Library quality bar

Category: skill libraries, Checked 2026-10-24 and 2026-10-25, Decision: The 7 skills that fail are removed (issue 151, setup-v6.10); 47 remain: 40 borderline, 7 pass

Result of checking every skill in `plugins/benchkeeper/library/library.json` (54 skills, 12 sources, each at its pinned commit; the four ECC skills added in #247 were checked on 2026-10-25 by one reader, the other 50 on 2026-10-24) against the five-point bar of [issue 151](https://github.com/ESchuderer/BenchKeeper/issues/151). One Sonnet subagent per source read the skill folder at the pin and the source repository's metadata; each failure and borderline result below cites file and line or a URL in the source's evaluation file. The seven that failed are removed from the library (section Decision); the table keeps their results.

## The bar

A skill stays when it passes all five at its pinned commit:

1. **Runs as installed.** Its workflow needs no files outside the skill folder that the skills CLI copies. It downloads no code at run time, fetches no rules from a branch URL and adds no hooks or telemetry. Fail: a file outside the folder, fetched instructions or code, hooks or telemetry. Borderline: unpinned package installs or live reference pages, or optional pointers outside the folder.
2. **License.** Permissive and present. Pass: MIT, Apache-2.0 or similar in the skill folder, its frontmatter or the repository root (the install copies the folder only, so a root-only license ships no notice text; noted per source). Borderline: copyleft or share-alike, or a label that contradicts the repository license. Fail: missing, non-commercial or proprietary.
3. **Authoring checklist** (`evaluations/practices/skill-authoring.md`). Valid `name`, `description` of at most 1,024 characters saying what and when, body under 500 lines or references one level deep, no dead links the workflow relies on, no time-sensitive text. Fail: a hard limit broken or a dead link the workflow relies on. Borderline: soft problems (dated text, 400 to 500 lines, no "use when", nested references).
4. **Earns its place.** A distinct "pick when", no overlap with an own or library skill, and an evaluation file with the evidence found. Pass: distinct and evidence recorded (maintenance, issues, independent results; an independent measurement of the effect is not required, the column "Effect evidence" shows what exists). Borderline: partial overlap, or the maintainer's own data shows no benefit. Fail: duplicates another skill. No evidence at all would be recorded as such, not as a pass: none of the 54 is in that state.
5. **Maintained source.** Repository not archived; the pin is not more than 12 months behind an active default branch without a reason. Borderline: a quiet repository (no commit for 6 to 12 months) or a pin 9 to 12 months old. Fail: archived, or a stale pin on an active branch.

Overall is the worst of the five. Checks ran on 2026-10-24 (50 skills) and 2026-10-25 (the four ECC skills). No code of the audited repositories was run.

## Results

| Skill | Source | 1 Runs as installed | 2 License | 3 Authoring | 4 Earns its place | 5 Maintained | Overall | Effect evidence |
|---|---|---|---|---|---|---|---|---|
| `designing-technical-uis` | `own` | pass | pass | pass | borderline | pass | borderline | author, n = 1 |
| [`frontend-design`](frontend-and-docs-skills.md) | `anthropics/skills` | pass | pass | borderline | borderline | pass | borderline | third-party, earlier versions only |
| [`mcp-builder`](frontend-and-docs-skills.md) | `anthropics/skills` | borderline | pass | borderline | pass | pass | borderline | independent: SWE-Skills-Bench 0.0% (ceiling effect) |
| [`docx`](anthropic-document-skills.md) | `anthropics/skills` | borderline | fail | pass | borderline | pass | fail | independent: DocOps (Codex +2.4 pp, Claude Code -3.3 pp across the four) |
| [`pdf`](anthropic-document-skills.md) | `anthropics/skills` | borderline | fail | fail | borderline | pass | fail | independent: DocOps (as docx) |
| [`pptx`](anthropic-document-skills.md) | `anthropics/skills` | borderline | fail | borderline | borderline | pass | fail | independent: DocOps (as docx) |
| [`xlsx`](anthropic-document-skills.md) | `anthropics/skills` | borderline | fail | pass | borderline | pass | fail | independent: DocOps (as docx) |
| [`scientific-critical-thinking`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | fail | pass | borderline | borderline | pass | fail | none |
| [`experimental-design`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | pass | pass | borderline | pass | pass | borderline | none; community bug fixed (#279, #280) |
| [`hypothesis-generation`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | pass | pass | borderline | pass | pass | borderline | none |
| [`statistical-analysis`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | borderline | pass | borderline | borderline | pass | borderline | none |
| [`statistical-power`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | pass | pass | pass | borderline | pass | borderline | none |
| [`uncertainty-and-units`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | pass | pass | borderline | pass | pass | borderline | none; open PR #350 |
| [`exploratory-data-analysis`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | pass | pass | borderline | pass | pass | borderline | none |
| [`scientific-visualization`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | pass | pass | borderline | pass | pass | borderline | none |
| [`literature-review`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | borderline | pass | borderline | pass | pass | borderline | none; skills.sh scans Fail/Warn |
| [`paper-lookup`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | pass | pass | borderline | borderline | pass | borderline | none; skills.sh Gen Fail, Snyk Warn |
| [`citation-management`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | borderline | pass | borderline | borderline | pass | borderline | none; many open bug reports (#317, #318, #319, #323, #348) |
| [`database-lookup`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | pass | pass | pass | pass | pass | pass | none |
| [`markitdown`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | pass | pass | borderline | borderline | pass | borderline | none; open PR #322 (install commands) |
| [`scientific-writing`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | pass | pass | borderline | borderline | pass | borderline | none |
| [`peer-review`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | pass | pass | borderline | pass | pass | borderline | none |
| [`venue-templates`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | borderline | borderline | borderline | borderline | pass | borderline | none; PR #165 merged |
| [`sympy`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | borderline | borderline | borderline | pass | pass | borderline | none; open PR #307 (dead links) |
| [`pymoo`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | borderline | borderline | borderline | pass | pass | borderline | none |
| [`cantera`](scientific-agent-skills.md) | `K-Dense-AI/scientific-agent-skills` | pass | pass | pass | pass | pass | pass | none; 224 installs, first seen 2026-09-30 |
| [`product-marketing`](marketingskills.md) | `coreyhaines31/marketingskills` | pass | pass | pass | pass | pass | pass | none; skills.sh 83.3K installs, scans pass |
| [`copywriting`](marketingskills.md) | `coreyhaines31/marketingskills` | borderline | pass | pass | borderline | pass | borderline | none; skills.sh 233.8K installs |
| [`copy-editing`](marketingskills.md) | `coreyhaines31/marketingskills` | pass | pass | borderline | borderline | pass | borderline | none; skills.sh 148.1K installs |
| [`seo-audit`](marketingskills.md) | `coreyhaines31/marketingskills` | pass | pass | borderline | pass | pass | borderline | none; skills.sh 236.2K installs, Snyk Warn (W011) |
| [`ai-seo`](marketingskills.md) | `coreyhaines31/marketingskills` | borderline | pass | borderline | pass | pass | borderline | independent issue marketingskills#599 (advice wrong at the pin) |
| [`schema`](marketingskills.md) | `coreyhaines31/marketingskills` | pass | pass | pass | pass | pass | pass | none; skills.sh 77.4K installs, scans pass |
| [`launch`](marketingskills.md) | `coreyhaines31/marketingskills` | borderline | pass | pass | pass | pass | borderline | none; skills.sh 77.3K installs |
| [`site-architecture`](marketingskills.md) | `coreyhaines31/marketingskills` | pass | pass | pass | pass | pass | pass | none; skills.sh 122.0K installs, scans pass |
| [`content-strategy`](marketingskills.md) | `coreyhaines31/marketingskills` | borderline | pass | borderline | pass | pass | borderline | none; skills.sh 162.9K installs, Snyk Warn (W011) |
| [`cro`](marketingskills.md) | `coreyhaines31/marketingskills` | pass | pass | pass | borderline | pass | borderline | none; skills.sh 89.3K installs, Snyk Warn (W011); QA-bot grade C (marketingskills#520) |
| [`directory-submissions`](marketingskills.md) | `coreyhaines31/marketingskills` | borderline | pass | borderline | borderline | pass | borderline | none; skills.sh Gen Agent Trust Hub Fail (CRITICAL, 2026-10-22) |
| [`analytics`](marketingskills.md) | `coreyhaines31/marketingskills` | borderline | pass | pass | pass | pass | borderline | none; skills.sh 83.3K installs, scans pass |
| [`gha-security-review`](security-skills.md) | `getsentry/skills` | pass | pass | pass | pass | pass | pass | none (maintainer PRs only); skills.sh 4.8K installs |
| [`fp-check`](security-skills.md) | `trailofbits/skills` | fail | borderline | borderline | pass | pass | fail | none; open hook issues #143, #289, #342 |
| [`variant-analysis`](security-skills.md) | `trailofbits/skills` | borderline | borderline | pass | borderline | pass | borderline | maintainer eval: no uplift over an unaided model |
| [`sharp-edges`](security-skills.md) | `trailofbits/skills` | pass | borderline | pass | pass | pass | borderline | none |
| [`playwright-best-practices`](playwright-best-practices.md) | `currents-dev/playwright-best-practices-skill` | borderline | pass | borderline | pass | pass | borderline | none; defect reports (open PR #13) |
| [`mermaid-diagrams`](frontend-and-docs-skills.md) | `softaworks/agent-toolkit` | borderline | pass | borderline | pass | borderline | borderline | none; open PR #48 |
| [`accessibility`](frontend-and-docs-skills.md) | `addyosmani/web-quality-skills` | borderline | pass | borderline | pass | pass | borderline | none; third-party defect reports (#4, #5 fixed, #21 open) |
| [`validate-data`](data-and-operations-skills.md) | `anthropics/knowledge-work-plugins` | pass | pass | pass | borderline | pass | borderline | none; skills.sh 3.7K installs |
| [`incident-response`](data-and-operations-skills.md) | `anthropics/knowledge-work-plugins` | borderline | pass | pass | pass | pass | borderline | none; skills.sh 5.8K installs |
| [`compliance-check`](data-and-operations-skills.md) | `anthropics/knowledge-work-plugins` | pass | pass | borderline | borderline | pass | borderline | none; skills.sh 3.3K installs |
| [`synthesize-research`](data-and-operations-skills.md) | `anthropics/knowledge-work-plugins` | borderline | pass | pass | borderline | pass | borderline | none; skills.sh 3.0K installs, Snyk Warn without reason |
| [`gdpr-compliant`](data-and-operations-skills.md) | `github/awesome-copilot` | pass | pass | borderline | borderline | pass | borderline | none; skills.sh 1.6K installs, scans pass |
| [`tdd-workflow`](ecc-skills.md) | `affaan-m/ECC` | fail | pass | fail | borderline | pass | fail | signals only (n = 6, n = 14); open bugs #3530, #3545 |
| [`verification-loop`](ecc-skills.md) | `affaan-m/ECC` | borderline | pass | pass | borderline | pass | borderline | none found; open feedback #3679 |
| [`error-handling`](ecc-skills.md) | `affaan-m/ECC` | pass | pass | pass | pass | pass | pass | none found |
| [`architecture-decision-records`](ecc-skills.md) | `affaan-m/ECC` | borderline | pass | pass | borderline | pass | borderline | none found |

Detail per skill, with file and line or URL for every fail and borderline: the linked evaluation file, section "Quality bar check". The own skill `designing-technical-uis` is recorded here: point 4 borderline because it partly overlaps `frontend-design` on UI text (own `SKILL.md:12-24, 37-38` against `frontend-design/SKILL.md:61-71`, with different empty-state advice) and its only evidence is the author's own check on an earlier text (`evaluations/practices/skill-authoring.md:33`, n = 1; 12 trigger cases in `plugins/benchkeeper/evals/skill-designing-technical-uis.json` without recorded results). Its folder has no license file (root `LICENSE` is MIT), 451 description characters, 57 lines, last folder commit 82da7f1 (2026-10-18).

Totals of the 54 checked: 7 fail, 40 borderline, 7 pass. The library has 47 skills after the removal: 40 borderline, 7 pass.

## Fails (removed from the library)

- `docx`, point 2: `LICENSE.txt` "All rights reserved" (`LICENSE.txt:1`): no copies outside the Services (`:16-17`), no derivative works (`:20`), no distribution or sublicense (`:21`); `SKILL.md:4` says `license: Proprietary.`. The repository has no root license, and its README calls these four "source-available, not open source". `library.json` has no `license` field for them.
- `pdf`, point 2: Same `LICENSE.txt` as `docx` (identical file): `:1` "All rights reserved", `:16-17`, `:20`, `:21`.
- `pdf`, point 3: `SKILL.md:11, 307, 311-314` tell the agent to read `REFERENCE.md` and `FORMS.md`; the folder has `reference.md` and `forms.md` (git tree at the pin), so the links are dead on case-sensitive filesystems and form filling depends on `forms.md`. `forms.md:4` names `scripts/check_fillable_fields` without `.py`.
- `pptx`, point 2: Same `LICENSE.txt` as `docx`: `:1`, `:16-17`, `:20`, `:21`.
- `xlsx`, point 2: Same `LICENSE.txt` as `docx`: `:1`, `:16-17`, `:20`, `:21`.
- `scientific-critical-thinking`, point 1: `SKILL.md:66-72` tells the agent to run `python skills/scientific-schematics/scripts/generate_schematic.py` from the repository root: a sibling skill that is not in this folder or the library, and it needs `OPENROUTER_API_KEY` and sends prompts to OpenRouter (`:78`). The section is optional, the script path is the preferred one. Owner call: fail or borderline.
- `fp-check`, point 1: The deep path delegates phases to `data-flow-analyzer`, `exploitability-verifier` and `poc-builder` (`skills/fp-check/SKILL.md:82`, `references/deep-verification.md:58, 64-70`), which live in `plugins/fp-check/agents/` (405 lines) and are not copied by the skills CLI. The standard path (`SKILL.md:59-69`) is self-contained and the deep phases are written out (`deep-verification.md:74-143`), so the skill degrades instead of stopping (unlike `dimensional-analysis`). The plugin `Stop` and `SubagentStop` hooks (`hooks/hooks.json:4-27`) are outside the folder, so an install adds none. Owner call: strict reading is fail.
- `tdd-workflow`, point 1: Step 0 runs `node scripts/setup-package-manager.js --detect` (`SKILL.md:95`), a script of the ECC plugin outside the folder; step 2 falls back to reading `package.json`, so it degrades. Open upstream [#3530](https://github.com/affaan-m/ECC/issues/3530), [#3545](https://github.com/affaan-m/ECC/issues/3545). Owner call: borderline if degradation counts (the same rule as `fp-check`).
- `tdd-workflow`, point 3: 583 lines, no reference files (`SKILL.md:1-583`).

## Pass

`database-lookup`, `cantera`, `product-marketing`, `schema`, `site-architecture`, `gha-security-review`, `error-handling`.

## Judgment calls

Grades that depend on a reading of the bar. The owner decided on 2026-10-25 to follow the bar as written, so the strict readings below (`fp-check`, `scientific-critical-thinking`, `tdd-workflow`) count as fail and those skills are removed.

- `mcp-builder` point 1 (borderline): it fetches the SDK READMEs from `main` branch URLs on every run (`SKILL.md:61, 65, 212-213`). They are documentation, not rules, but the Vercel skills were left out for fetching from a branch URL (`library-exclusions.md`). Fail if the owner counts documentation.
- `fp-check` point 1 (fail): the strict reading. The standard path is self-contained and the deep phases are written out (`deep-verification.md:74-143`), so it degrades; `dimensional-analysis` could not run at all. Borderline if degradation counts.
- `scientific-critical-thinking` point 1 (fail): the optional schematic step runs a script of a sibling skill (`SKILL.md:66-72`) that needs `OPENROUTER_API_KEY`. Borderline if an optional step does not count.
- Where point 1 separates fail from borderline: the workflow tells the agent to run, or to delegate to, something outside the folder (fail: `fp-check`, `scientific-critical-thinking`, `tdd-workflow`), against a read-only pointer to a document outside the folder or a step that works without it (borderline: the four marketing skills below, `variant-analysis`, `incident-response`, `synthesize-research`, `verification-loop`, `architecture-decision-records`). The subagents graded the four marketing skills fail; they were set to borderline after reading the links, which only point to partner tool guides.
- `ai-seo`, `launch`, `content-strategy`, `analytics` point 1 (borderline): optional links to repo-level partner `tools/` files that are not copied. Fail if the links count; a re-pin turns them into branch URLs.
- Point 2 for root-only licenses: graded pass. If the bar needs the license text inside the installed folder, the root-only skills become borderline: all 12 marketing skills, the five data and operations skills, `gha-security-review`, `mermaid-diagrams`, `designing-technical-uis`, `tdd-workflow`, `error-handling`, `architecture-decision-records`, and the three Trail of Bits skills (already borderline). K-Dense and the Anthropic open skills name the license in the frontmatter or the folder.
- Point 4 without an independent measurement of the effect: graded pass when distinct. If an independent measurement is required, only `mcp-builder` (SWE-Skills-Bench: 100% with and without) and the four Anthropic document skills (DocOps) have one, and almost every other skill becomes borderline.
- The 18 K-Dense skills that end with a "Citing Scientific Agent Skills" section telling the agent to fetch the maintainer paper are not counted against point 1.

Changes to the subagent grades: the four marketing `tools/` skills (fail to borderline), licenses that sit only in the repository root (borderline to pass, per the bar's "permissive and present"), and skills with a distinct trigger whose only gap was a missing independent measurement (borderline to pass on point 4, with the column "Effect evidence" kept).

## Borderline by cause

The counts include the seven removed skills.

- Point 1, Runs as installed (25 borderline, 3 fail): unpinned package installs or live pages in the instructions (most of them), references to files or agents outside the folder that are optional (`variant-analysis`, `incident-response`, `synthesize-research`, `copywriting`, and the partner `tools/` links in `ai-seo`, `launch`, `content-strategy`, `analytics`), a branch-URL README fetch (`mcp-builder`), a script outside the folder (`tdd-workflow`, fail), optional ECC command or agent pointers (`verification-loop`, `architecture-decision-records`), downloads at run time (`venue-templates`, `directory-submissions`)
- Point 2, License (6 borderline, 4 fail): copyleft share-alike (the three Trail of Bits skills), and license labels that do not match the root MIT (`sympy`, `pymoo`, `venue-templates`)
- Point 3, Authoring (30 borderline, 2 fail): time-sensitive text (most K-Dense skills, `ai-seo`, `seo-audit`, `directory-submissions`, `compliance-check`, `mermaid-diagrams`, `pptx`, `frontend-design`, `mcp-builder`), `SKILL.md` over 500 lines (`tdd-workflow`, 583, fail) or of 400 to 500 lines (`statistical-analysis`, `uncertainty-and-units`, `sympy`, `database-lookup`, `copy-editing`, `seo-audit`, `ai-seo`, `content-strategy`, `accessibility`), no "use when" clause (several K-Dense skills), nested references (`fp-check`, `ai-seo`, `playwright-best-practices`), broken reference links (`gdpr-compliant`, `accessibility`)
- Point 4, Earns its place (26 borderline): partial overlap with a library neighbour (`tdd-workflow` and `verification-loop` against the Matt Pocock `tdd` and the own `workflow` checks, `architecture-decision-records` against `domain-modeling`, `statistical-analysis` and `statistical-power`, `paper-lookup` and `citation-management`, `scientific-writing` and `venue-templates`, `scientific-critical-thinking`, `markitdown` and the Anthropic document skills, `copywriting` and `copy-editing` and `cro`, `compliance-check` and `gdpr-compliant`, `validate-data`, `synthesize-research`, `frontend-design` and `designing-technical-uis`), the maintainer's own eval shows no uplift (`variant-analysis`), a CRITICAL scan result (`directory-submissions`)
- Point 5, Maintained (1 borderline): `mermaid-diagrams` only: no repository commit for 233 days

Defects worth the owner's attention among the borderline skills (each is in the source's evaluation file):

- `ai-seo`: the pin still gives robots.txt advice that issue marketingskills#599 reported as wrong; the default branch fixed it (2.10.1). Re-pin before keeping it.
- `directory-submissions`: skills.sh Gen Agent Trust Hub Fail (CRITICAL, 2026-10-22), 27 dead or silent URLs in the tracker CSV the workflow uses.
- `accessibility`: `SKILL.md:105-106` defines large text as 18px and 14px bold, where WCAG says points, so an audit can accept 3:1 contrast where 4.5:1 is required (open fix addyosmani/web-quality-skills#21).
- `playwright-best-practices`: open PR currents-dev/playwright-best-practices-skill#13 reports seven dead links and wrong Playwright API examples in the references.
- `gdpr-compliant`: `SKILL.md:15, 16` point to `references/security.md` (file is `Security.md`) and `references/operations.md` (does not exist).
- `compliance-check`: "June 2021" standard contractual clauses and a 30 plus 60 day figure that differs from GDPR Article 12(3).
- `variant-analysis`: the maintainer's own eval shows no uplift and the main entry (a workflow) is not installed.
- `venue-templates`: six Elsevier LPPL 1.3 files inside an MIT-labelled skill, and the workflow downloads templates.
- `sympy`, `pymoo`: frontmatter license names the library's license, not the skill's.
- The three Trail of Bits skills: CC-BY-SA-4.0 share-alike, no license text in the installed folder.

## Decision

Owner decision on [issue 151](https://github.com/ESchuderer/BenchKeeper/issues/151): follow the bar as written. Removed from `library.json` and the packs: `docx`, `pdf`, `pptx`, `xlsx` (point 2, license forbids redistribution), `scientific-critical-thinking`, `fp-check` and `tdd-workflow` (point 1, files they need outside their folder). Each is in [library exclusions](library-exclusions.md) with the reason and the upstream issue where one exists; a skill can come back when upstream removes the cause. The library has 47 skills: 40 borderline, 7 pass. The borderline skills stay with their recorded defects. Open for the owner: `ai-seo` needs a re-pin for the robots.txt advice, and `mcp-builder` and `directory-submissions` are the first borderline cases to decide.

[All evaluations](../../EVALUATIONS.md)
