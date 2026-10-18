# Skill library

Skills that `setting-up-projects` installs into a project, never globally. It proposes a set when "Pick when" matches what the repository contains, and the user trims it skill by skill. Nothing here duplicates the global setup (Matt Pocock's skills, Ponytail, the BenchKeeper skills, find-skills) or Claude Code's bundled skills. Stack skills (frameworks, libraries) are not listed: `setting-up-projects` finds them per project with find-skills.

Install, from the project root, for the selected agents only:
- Own skill (folder next to this file): copy it to `.agents/skills/<name>/` (Codex) and `.claude/skills/<name>/` (Claude Code). With both agents selected, the Claude Code copy is a link to the Codex copy, unless `paths` is set.
- Community skill: `DO_NOT_TRACK=1 npx -y skills@1.7.2 add <source> -s <skill> <agent-flags> --copy -y`. The project's `skills-lock.json` pins the content.

## Own

| Skill | Pick when | `paths` | Pointer line |
|---|---|---|---|
| [writing-microcopy](writing-microcopy/SKILL.md) | The repository has a UI (web, desktop, CLI output, admin or data views) or user-facing docs | The folders that hold UI or docs text, when they are not the whole repository | `UI text and user docs: load the writing-microcopy skill first.` in the `AGENTS.md` of each of those folders (the root `AGENTS.md` for the whole repository). A folder `AGENTS.md` created for it gets a `CLAUDE.md` with `@AGENTS.md` when Claude Code is selected. |

## Anthropic

Source `anthropics/skills`. In Claude Code, `docx`, `pdf`, `pptx` and `xlsx` already come with the claude.ai skills `anthropic-skills`, so they are Codex only here. `skill-creator` is not listed: Claude Code gets it the same way and Codex bundles it.

| Skill | Pick when | Agents |
|---|---|---|
| `frontend-design` | New UI or a visual redesign | both |
| `mcp-builder` | The repository builds an MCP server | both |
| `docx`, `pdf`, `pptx`, `xlsx` | The repository produces or edits that file type | Codex only |

## Science

Source `K-Dense-AI/scientific-agent-skills` (MIT). Python skills: read each one's dependencies before installing. Skills that need paid API keys are not listed. `literature-review` and `scientific-critical-thinking` mention an optional `OPENROUTER_API_KEY` (for generated figures), which they work without.

| Set | Skills | Pick when |
|---|---|---|
| Core | `scientific-critical-thinking`, `experimental-design`, `hypothesis-generation`, `statistical-analysis`, `statistical-power`, `uncertainty-and-units`, `exploratory-data-analysis`, `scientific-visualization` | Research, measurement or data analysis code |
| Literature | `literature-review`, `paper-lookup`, `citation-management`, `database-lookup`, `markitdown` | The repository works with papers, datasets from public databases, or PDF and Office sources |
| Writing | `scientific-writing`, `peer-review`, `venue-templates` | The repository holds a paper, report or thesis |
| Modelling | `sympy`, `pymoo`, `cantera` | Symbolic math, multi-objective optimization, chemical kinetics or thermodynamics |

## Marketing

Source `coreyhaines31/marketingskills` (MIT). The skills read `.agents/product-marketing.md` when it exists, which `product-marketing` writes.

| Set | Skills | Pick when |
|---|---|---|
| Core | `product-marketing`, `copywriting`, `copy-editing`, `seo-audit`, `ai-seo`, `schema`, `launch`, `site-architecture` | A product site, landing pages or a public launch |
| Optional | `content-strategy`, `cro`, `directory-submissions`, `analytics` | A blog or docs plan, conversion work, directory listings, or analytics setup |
