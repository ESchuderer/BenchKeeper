# Skill authoring guide (Anthropic)

[Guide](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices), Category: practices, Checked 2026-10-16, Decision: In

## Advertised

Vendor guidance, no measurements. Checkable points:

- `name`: at most 64 characters, lowercase letters, digits and hyphens, no "anthropic" or "claude". Gerund form preferred (`processing-pdfs`), noun phrases and action names acceptable. One pattern across a library.
- `description`: at most 1,024 characters, third person, what the skill does and when to use it, with the terms users say. Claude picks a skill from "potentially 100+" by name and description alone.
- Body under 500 lines. Details in files linked directly from SKILL.md (one level deep, since Claude "might use commands like `head -100`" on nested files). A table of contents in reference files over 100 lines.
- No time-sensitive text (old behavior in an "old patterns" section). Consistent terms. One default instead of many options. Fully qualified MCP tool names (`ServerName:tool_name`).
- Copyable checklists for complex workflows. Validate, fix, repeat loops.
- Evaluations first: run Claude without the skill, build three scenarios, measure a baseline, write just enough to pass. "There is not currently a built-in way to run these evaluations." Test with Haiku, Sonnet and Opus.

## User reports

Post in r/claudeskills (2026-10-16, screenshot supplied by the owner, Reddit cannot be fetched) summarizing the guide in six points: gerund names, one level of references, a table of contents, evaluation-driven development, the description as the trigger, progressive disclosure with SKILL.md under 500 lines, and testing on every model. Each point matches the guide. The table of contents applies to reference files over 100 lines, not to SKILL.md.

## Skill authoring check

BenchKeeper skills, checked 2026-10-16:

| Point | `following-dev-workflow`, `setting-up-machine`, `setting-up-projects`, `maintaining-repos` (before setup-v2.5: `sdlc`, `global-setup`, `project-setup`, `maintain`) |
|---|---|
| Name format | Valid. The patterns were mixed (acronym, two noun phrases, one verb). Renamed to gerunds (setup-v2.5, owner decision). The benchmark image installs pinned copies under the old names (`bench/arms/bk-skills/`). |
| Description | 257 to 415 characters, what and when in each. Rewritten in third person (setup-v2.5). |
| Body size, references | 14 to 156 lines. No nested reference files. |
| Time-sensitive text | One dated install count in `project-setup` removed (setup-v2.5). |
| MCP tool names | None used. |
| Evaluations, model coverage | None for these skills. The benchmark measures the BenchKeeper layer as a whole (`bench/PROTOCOL.md`), not each skill's triggering or effect. Trigger evaluations belong to [#36](https://github.com/ESchuderer/BenchKeeper/issues/36). |

Benchmarked collections: all eight ranked in [bench/results/2026-10-16-skill-authoring.md](../../bench/results/2026-10-16-skill-authoring.md) (#58): static check plus one Opus review per collection.

## Decision

In: the guide's checklist applies to `skills/`. Evaluations for the own skills are open in #36.

[All evaluations](../../EVALUATIONS.md)
