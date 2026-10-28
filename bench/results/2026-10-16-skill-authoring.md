# Skill authoring check of the benchmarked collections

Checked 2026-10-16 against Anthropic's [skill authoring guide](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) (summary: [evaluations/practices/skill-authoring.md](https://github.com/ESchuderer/BenchKeeper-research/blob/main/evaluations/practices/skill-authoring.md)). Two parts per collection:

- Static check: `bench/scripts/skill-lint.sh` extracts the skills installed in the pinned arm images (whole plugin folders, without the copies for other agents under `.openclaw/`, `.opencode/`, `.codex/`) and runs `bench/scripts/skill-lint.mjs` (tested in `skill-lint.test.mjs`). Eleven checks per skill: `name-valid`, `desc-length`, `desc-xml`, `desc-third-person`, `desc-when` (skipped for skills with `disable-model-invocation: true`, which the model never selects), `body-lines` (over 500), `nested-refs`, `ref-toc` (Markdown files over 100 lines without a table of contents), `dated-text` (outside code blocks), `mcp-qualified`, `windows-paths`. Third person, trigger clause and MCP names are heuristics.
- Review: one Claude Opus 5.5 subagent per collection (Claude Code, default effort, one run each) read all descriptions and 10 to 31 full bodies with their references and scripts, and scored nine guide areas from 1 to 5. One reviewer per collection, no second rater: the scores are judgments, not measurements. The BenchKeeper review was run by the project's own session and asked to be as strict as with the others.

## Ranking

By the review's overall score (mean of the applicable areas). Ties broken by shipped evaluations, then the static pass rate.

| Rank | Collection | Version | Skills | Review overall | Static checks passed | Evaluations shipped |
|---|---|---|---|---|---|---|
| 1 | Ponytail | 5.2.0 | 6 | 3.9 | 97% | no |
| 2 | agent-skills | 0.6.13 | 25 | 3.4 | 99% | yes (`evals/cases/<skill>.json`, results on Opus only) |
| 3 | Matt Pocock | 1.3.1 | 37 | 3.4 | 99% | no |
| 4 | Superpowers | 7.0.0 | 15 | 3.2 | 93% | partial (unstructured pressure scenarios in one skill) |
| 5 | OpenSpec (generated) | 1.14.1 | 6 | 3.1 | 100% | no |
| 5 | BenchKeeper | setup-v2.5 | 4 | 3.1 | 100% | no |
| 7 | ECC (minimal profile) | 2.2.3 | 48 | 2.9 | 98% | no (unit tests for scripts only) |
| 8 | Spec Kit (generated) | 1.2.0 | 10 | 2.8 | 90% | no |

Confidence: medium for the order of the top and bottom groups, low for neighbors within 0.2. Smaller collections are easier to keep consistent (Ponytail has 6 short skills).

## Scores per guide area

| Area | Ponytail | agent-skills | Matt Pocock | Superpowers | OpenSpec | BenchKeeper | ECC | Spec Kit |
|---|---|---|---|---|---|---|---|---|
| Descriptions | 4 | 4 | 3 | 2 | 4 | 4 | 3 | 2 |
| Conciseness | 4 | 2 | 4 | 2 | 2 | 3 | 2 | 2 |
| Structure, progressive disclosure | 4 | 3 | 4 | 2 | 3 | 3 | 2 | 3 |
| Degrees of freedom | 5 | 4 | 4 | 4 | 4 | 4 | 4 | 3 |
| Workflows, feedback loops | 4 | 4 | 4 | 5 | 4 | 3 | 4 | 4 |
| Consistency | 4 | 3 | 3 | 3 | 3 | 3 | 2 | 3 |
| Examples, templates | 4 | 4 | 5 | 5 | 4 | 3 | 4 | 4 |
| Scripts, dependencies | n/a | 3 | 3 | 4 | n/a | n/a | 3 | 3 |
| Evaluations, testing | 2 | 4 | 1 | 2 | 1 | 2 | 2 | 1 |

## Static check

| Collection | Skills | Checks passed | Naming | Evaluations | Failures per check |
|---|---|---|---|---|---|
| agent-skills | 25 | 99% | gerund 4 of 25 | yes | ref-toc 4 |
| Superpowers | 15 | 93% | gerund 11 of 15 | no | desc-third-person 1, body-lines 2, ref-toc 7, dated-text 1 |
| ECC | 48 | 98% | gerund 1 of 48 | no | body-lines 3, ref-toc 1, dated-text 2, mcp-qualified 1, windows-paths 1 |
| Matt Pocock | 37 | 99% | gerund 6 of 37 | no | name-valid 2, ref-toc 3 |
| Ponytail | 6 | 97% | gerund 0 of 6 | no | dated-text 1, windows-paths 1 |
| OpenSpec | 6 | 100% | gerund 0 of 6 | no | none |
| Spec Kit | 10 | 90% | gerund 0 of 10 | no | desc-when 10, mcp-qualified 1 |
| BenchKeeper | 4 | 100% | gerund 4 of 4 | no | none |

Known limits of the static check, from the reviews:

- Imperative descriptions pass the third-person heuristic (the guide's own examples use both forms).
- "You" and "we" inside a description are not caught.
- Undated version wording ("removed in a future release") is not caught.
- Not checked: duplicated blocks across skills, links to skills that are not installed, script paths that do not exist, links across skills (`../`).

False positives found: `windows-paths` on paths the skill tells the user about (Ponytail `%APPDATA%`, ECC paths of the app under test), `dated-text` on a citation year (Superpowers).

## Findings per collection

- Ponytail:
  - Tight core skill with a "Never cut" list.
  - A SubagentStart hook injects the core skill into every subagent, so its description never decides when it loads.
  - `ponytail-review` and `ponytail-audit` are nearly identical.
  - Generic review triggers overlap other review skills.
- agent-skills:
  - The only collection with per-skill evaluations (trigger and behavior cases, collision check).
  - Bodies teach what Claude knows (test pyramid, STRIDE).
  - 24 links leave the skill folder (`../../references/`), some references point one level further.
  - One script is called by a repository-relative path.
- Matt Pocock:
  - Short bodies, the best examples.
  - 21 skills are user-invoked only, which their trigger-less descriptions reflect.
  - `block-dangerous-git.sh` allows every command when `jq` is missing.
  - Two names contain the reserved word "claude".
  - Dated, conflicting context-size claims.
- Superpowers:
  - The strongest workflows (copyable checklist, capped fix loop, ledger).
  - Descriptions leave out the "what" by its own house rule, its skill template shows an invalid uppercase name.
  - Two bodies over 500 lines, no table of contents in 13 long references.
  - The brainstorming server loads a remote logo with the plugin version unless a telemetry variable is set, not mentioned in the skill.
- OpenSpec:
  - Guarded destructive steps, paths from `status --json`.
  - The same 11-line preamble in all 6 skills.
  - Merge rules restated in prose next to the CLI.
  - References to skills the delivery mode does not install.
- BenchKeeper:
  - Double confirmation before destructive steps, change-type table with checks.
  - The workflow skill, loaded before every edit, carries rarely needed content.
  - No evaluations. Fixed in this change: the headings kept the old names, the pin bump would also have rewritten the benchmark's frozen copies and missed pins outside Markdown, and the settings check did not verify a setting the install sets.
- ECC:
  - Script-backed collection and judgment split.
  - Broken execution paths (missing or misplaced scripts, `~` inside quotes), hardcoded `~/.claude/skills` paths in a project-scoped install, references to 13 skills that are not installed, three bodies over 500 lines of generic content.
- Spec Kit:
  - Strict output formats the next skill parses, capped validation loops.
  - No description says when to use it or names Spec Kit.
  - A 70-line hook protocol copied into all 10 skills (28% of the text).
  - Task and implement disagree on phase names.
  - No fallback when no user can answer.

## Authoring quality

- The targeted tasks (`bench/PROTOCOL.md`) record whether each skill fired and can check the descriptions the reviews call broad or overlapping (Ponytail review, agent-skills "stress-test", Superpowers catch-all triggers, Spec Kit).
