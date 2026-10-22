# Data and operations skills (Anthropic knowledge-work plugins, awesome-copilot)

Category: skill libraries, Checked 2026-10-22, Decision: Per project. `validate-data` in the data pack, `incident-response`, `compliance-check` and `gdpr-compliant` in the operations pack, `synthesize-research` as a single skill. `gdpr-compliant` ships with two broken reference paths (see its check).

Five skills from two sources. Pinned commits are the `ref` fields in `plugins/benchkeeper/library/library.json`.

| Skill | Source and pin | License | Pack |
|---|---|---|---|
| `validate-data` | [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins/tree/f652327d4e953d7957d99e735c3c7f9964e9d2e5/data/skills/validate-data) at `f652327` (2026-10-14), plugin `data` 1.1.0 | Apache-2.0 | data |
| `incident-response` | same commit, [engineering/skills/incident-response](https://github.com/anthropics/knowledge-work-plugins/tree/f652327d4e953d7957d99e735c3c7f9964e9d2e5/engineering/skills/incident-response) | Apache-2.0 | operations |
| `compliance-check` | same commit, [legal/skills/compliance-check](https://github.com/anthropics/knowledge-work-plugins/tree/f652327d4e953d7957d99e735c3c7f9964e9d2e5/legal/skills/compliance-check), plugin `legal` 1.3.0 | Apache-2.0 | operations |
| `synthesize-research` | same commit, [product-management/skills/synthesize-research](https://github.com/anthropics/knowledge-work-plugins/tree/f652327d4e953d7957d99e735c3c7f9964e9d2e5/product-management/skills/synthesize-research) | Apache-2.0 | none (single skill) |
| `gdpr-compliant` | [github/awesome-copilot](https://github.com/github/awesome-copilot/tree/772e23900abaff43ccd3ea7c4e048cb5d8cae8da/skills/gdpr-compliant) at `772e239` (2026-10-15) | MIT | operations |

## Advertised

- Anthropic, the four knowledge-work skills: no performance claim. The plugin descriptions are scope statements only: `data` ("Write SQL, explore datasets, and generate insights faster", [plugin.json](https://github.com/anthropics/knowledge-work-plugins/blob/f652327d4e953d7957d99e735c3c7f9964e9d2e5/data/.claude-plugin/plugin.json)) and `legal` ("Speed up contract review, NDA triage, and compliance workflows for in-house legal teams", [plugin.json](https://github.com/anthropics/knowledge-work-plugins/blob/f652327d4e953d7957d99e735c3c7f9964e9d2e5/legal/.claude-plugin/plugin.json)). The skills are written for knowledge workers inside Cowork and Claude Code plugins, not for repositories: `compliance-check` is framed for "in-house legal teams" and states it "does not provide legal advice" ([SKILL.md](https://github.com/anthropics/knowledge-work-plugins/blob/f652327d4e953d7957d99e735c3c7f9964e9d2e5/legal/skills/compliance-check/SKILL.md)).
- GitHub (awesome-copilot), `gdpr-compliant`: "Actionable GDPR reference for engineers, architects, DevOps, and tech leads", "Inspired by CNIL developer guidance and GDPR Articles 5, 25, 32, 33, 35" ([SKILL.md](https://github.com/github/awesome-copilot/blob/772e23900abaff43ccd3ea7c4e048cb5d8cae8da/skills/gdpr-compliant/SKILL.md)). No performance claim. The repository is a community collection (added in [PR #1230](https://github.com/github/awesome-copilot/pull/1230), merged, 2026-03-30).

## Independent evidence

- None found for any of the five skills. Searches for benchmarks naming the repositories or skills (web search 2026-10-22, GitHub issue search in both repositories) returned no evaluation.
- General context, not evidence for these skills:
  - [SkillsBench](https://arxiv.org/abs/2602.12670): 87 tasks, 18 model-harness configurations, curated skills +16.6 percentage points (33.9% to 50.5%), focused skills with at most three modules ahead of exhaustive bundles. `validate-data` (383 lines), `synthesize-research` (312 lines) and `gdpr-compliant` (283 lines plus two reference files) are long single-file references; `incident-response` (158 lines) is the shortest.
  - [SWE-Skills-Bench](https://arxiv.org/abs/2603.15401): 49 public software-engineering skills, about 565 task instances, 39 of 49 gave zero pass-rate improvement, average +1.2%. Its tasks are software-engineering tasks, so it bears on `gdpr-compliant` and `incident-response` at most loosely. The page does not name the models.
- No BenchKeeper trial ran any of these skills.

## User reports

- skills.sh (fetched 2026-10-22; install counts are the rounded figures the page shows):

| Skill | Installs | First seen | Gen Agent Trust Hub | Socket | Snyk |
|---|---|---|---|---|---|
| [validate-data](https://skills.sh/anthropics/knowledge-work-plugins/validate-data) | 3.7K | 2026-03-13 | Pass | Pass | Pass |
| [incident-response](https://skills.sh/anthropics/knowledge-work-plugins/incident-response) | 5.8K | 2026-02-24 | Pass | Pass | Pass |
| [compliance-check](https://skills.sh/anthropics/knowledge-work-plugins/compliance-check) | 3.2K | 2026-03-13 | Pass | Pass | Pass |
| [synthesize-research](https://skills.sh/anthropics/knowledge-work-plugins/synthesize-research) | 3.0K | 2026-03-13 | Pass | Pass | Warn |
| [gdpr-compliant](https://skills.sh/github/awesome-copilot/gdpr-compliant) | 1.6K | 2026-03-31 | Pass | Pass | Pass |

- The Snyk Warn on `synthesize-research` has no reason on the page. The skill has no scripts, URLs or network calls (grep of SKILL.md), so the warning is probably prompt-level (unverified).
- Repository popularity (GitHub API, 2026-10-22): knowledge-work-plugins 31.4K stars, Apache-2.0; awesome-copilot 40.3K stars, MIT.
- GitHub issues: none found about these five skills. The open issues of knowledge-work-plugins concern other plugins (for example [#166](https://github.com/anthropics/knowledge-work-plugins/issues/166), an SSRF report in `bio-research`). `gdpr-compliant` has one commit and no issue or PR besides the one that added it.
- Hacker News, forums: None found.

## Skill authoring check

Method: SKILL.md and every file in the skill folder fetched at the pinned commit; grep for URLs, `curl`, install commands, scripts, hooks, credentials, telemetry, `~~` placeholders.

Common to the four knowledge-work skills:

- Each skill folder holds only SKILL.md (tree listing at the pinned commit). No scripts, no hooks, no downloads or network calls at run time, no credential requests, no telemetry. Plain prompts and output templates.
- Outside-the-folder reference: every SKILL.md starts with a link to `../../CONNECTORS.md` (the plugin's connector list), which the skills CLI does not copy. The link breaks after install, and nothing in the skill depends on it.
- Connector placeholders (`~~`), checked per skill:
  - `validate-data`: none. Works on pasted text, files, SQL and results.
  - `compliance-check`: none. Works on the user's description.
  - `incident-response`: three optional blocks under "If Connectors Available" (`~~monitoring`, `~~incident management`, `~~chat`: pull alerts, page on-call, post to a channel). Without connectors the skill still does triage, severity table, status update and postmortem templates from what the user pastes. The plugin's MCP servers (for example Slack, Box and Atlassian entries in `legal/.mcp.json`) are plugin-level and not installed by a skill-only install, so the agent never offers these actions.
  - `synthesize-research`: four optional inputs in step 1 (`~~knowledge base`, `~~user feedback`, `~~product analytics`, `~~meeting transcription`, each "if connected"). Without them the skill takes pasted text and uploaded files, which is its first listed input.
- Slash-command wording: the bodies say `/validate-data $ARGUMENTS` or `/incident-response new [description]`. The `argument-hint` front matter is Claude Code's; Codex does not substitute `$ARGUMENTS` (unverified), so the agent reads the user's request instead. Harmless.
- Front matter `description` is unquoted and contains colons or em dashes in `incident-response` (an em dash) and `validate-data` (a double hyphen only). BenchKeeper's `skill-lint.mjs` runs on own skills only, so this does not fail CI.
- Em dashes: 37 lines across the five skills contain one (grep). The CI em-dash check exempts the vendored `.agents/` and `.claude/` folders ([AGENTS.md](https://github.com/ESchuderer/BenchKeeper/blob/main/AGENTS.md)), where the skills CLI installs them. Not an issue for the install.
- License: Apache-2.0, with a LICENSE file at the repository root and in each plugin folder (`data/LICENSE`, `legal/LICENSE`), neither inside the skill folder, so an install copies no license text. Apache-2.0 allows redistribution with the license text; the library only records the source and ref, the user's project gets the skill from the source repository.

Per skill:

- `validate-data` (383 lines): methodology review, QA checklist, pitfall list (join explosion, survivorship bias, average of averages), sanity checks, reproducibility template, three-level confidence rating. Stays within its purpose. Domain is business analytics (revenue, MAU, dashboards), so for a research or science repository roughly half of the examples do not apply. Overlaps in part with the science set's statistical skills (separate evaluation).
- `incident-response` (158 lines): SEV1 to SEV4 table with fixed response times (immediate, 15 min, 1 hour, next business day) that are the skill's own defaults, not a standard (unverified against an official source, each team sets its own). Status-update and postmortem templates, 5 whys. Box drawing and check mark characters in the diagram. Pick-when "deployed service with on-call" is accurate.
- `compliance-check` (274 lines): output template plus reference sections on GDPR, CCPA/CPRA, a regulation table (LGPD, POPIA, PIPEDA, PDPA, Privacy Act, PIPL, UK GDPR), DPA review checklist, data subject request handling, regulatory monitoring. Written for a legal team reviewing business initiatives, not code review. Facts checked:
  - GDPR response time: the skill says "30 days (extendable by 60 days)"; Article 12(3) says one month, extendable by two further months ([EUR-Lex](https://eur-lex.europa.eu/eli/reg/2016/679/oj), text read at [gdpr-info.eu Art. 12](https://gdpr-info.eu/art-12-gdpr/), an unofficial mirror). Close, not exact.
  - 72-hour breach notification matches Article 33 (not re-fetched, unverified).
  - CCPA/CPRA timelines (10 business days, 45 days plus 45), LGPD 15 days, SCC modules and the "June 2021" SCCs: unverified.
  - The skill itself says to verify current requirements with authoritative sources and to have counsel review.
- `synthesize-research` (312 lines): thematic analysis, affinity mapping, triangulation, interview and survey analysis, personas, opportunity sizing. Product-management method text. Step 5 tells the agent to "offer" follow-up artifacts (personas, roadmap implications), which adds an offer to every run (the global writing rule leaves offers out; the user can ignore it). No code or files written.
- `gdpr-compliant` (283 lines plus `references/Security.md` 266 lines and `references/data-rights.md` 177 lines, 11.9 KB, 11.9 KB, 6.5 KB): MUST and MUST NOT rules for data model, API, logging, errors, encryption, hashing, secrets, retention, test data, plus a PR review checklist. Findings:
  - Broken references. SKILL.md lists `references/security.md` and `references/operations.md` ([SKILL.md lines 13 to 16](https://github.com/github/awesome-copilot/blob/772e23900abaff43ccd3ea7c4e048cb5d8cae8da/skills/gdpr-compliant/SKILL.md)). The folder holds `Security.md` (capital S) and `data-rights.md`, and no `operations.md` at the pinned commit or on `main` ([folder listing](https://github.com/github/awesome-copilot/tree/main/skills/gdpr-compliant/references)). On a case-sensitive file system (Linux, the dev container) the `security.md` path does not resolve, and the cloud, CI/CD and incident-response reference does not exist. SKILL.md alone is self-contained for the core rules, so the skill still works, but its own pointers fail. No upstream issue found.
  - Lost markers. The "do" and "do not" example pairs have no marker left in the text: `"Column 'email' violates unique constraint on table 'users'"` and `"A user with this email address already exists."` sit under "Return generic error messages" as two identical-looking bullets, and `GET /users/{userId}` and `192.168.1.xxx` stand without a label (SKILL.md lines 109, 129, 145, 146). An agent can read the bad example as the instruction.
  - Stack bias. Examples name .NET tools (Hangfire, Bogus, `dotnet list package`) and Azure, AWS, GCP key stores. Retention defaults (analytics 13 months, auth logs 12 to 24 months, inactive accounts 12 months) are the skill's recommendations; the sources it cites are CNIL, ENISA, OWASP and NIST guidance, which this check did not open (unverified).
  - Scope: personal data in EU engineering work, as the pick-when says. No scripts, no URLs, no network calls, no credential requests. Secrets section recommends `gitleaks` or `detect-secrets` pre-commit hooks, which conflicts with this repository's own choice (no secret hook) but only applies to projects that install the skill, and is advice, not an action.

## Decision

- `validate-data`: keep in the data pack (setup-v6.0), proposed when the repository imports or publishes datasets. No evidence of effect, no authoring defect.
- `incident-response`: keep in the operations pack, proposed for deployed services with on-call or postmortems. Works without connectors, as templates and a severity table.
- `compliance-check`: keep in the operations pack, proposed only for regulated products. Legal-team framing and not legal advice: the output is a checklist for a human reviewer, and its figures are unverified in part.
- `synthesize-research`: keep as a single skill (in no pack), proposed when the repository holds interviews, surveys or feedback. Note the Snyk Warn on skills.sh with no stated reason.
- `gdpr-compliant`: keep in the operations pack with the defects recorded above, or hold it until upstream fixes the two reference paths and the lost example markers (the owner decides). Not a removal finding on its own, since the main file is self-contained. Report the broken paths and `operations.md` upstream to awesome-copilot if kept.
- None of the five argues for removal under the exclusion criteria in [library-exclusions](library-exclusions.md): no run-time downloads, no hooks, no telemetry, no files outside the skill that its workflow needs, licenses permissive. Retest with a task brief that names a skill (for example a postmortem or a GDPR PR review) before any of them moves into a default set.

[All evaluations](../../EVALUATIONS.md)
