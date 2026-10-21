# Skill library

Skills that `setting-up-projects` installs into a project, never globally. It proposes a set when "Pick when" matches what the repository contains, and the user trims it skill by skill. Nothing here duplicates the global setup (Matt Pocock's skills, Ponytail, the BenchKeeper skills, find-skills) or Claude Code's bundled skills. Stack skills: `setting-up-projects` finds them per project with find-skills.

Install, from the project root, for the selected agents only:
- Own skill (folder next to this file): copy it to `.agents/skills/<name>/` (Codex) and `.claude/skills/<name>/` (Claude Code). With both agents selected, the Claude Code copy is a link to the Codex copy. Codex ignores the `paths` key.
- Community skill: `DO_NOT_TRACK=1 npx -y skills@1.7.2 add <source> -s <skill> <agent-flags> --copy -y`. The project's `skills-lock.json` pins the content.

## Own

| Skill | Pick when | `paths` | Pointer line |
|---|---|---|---|
| [designing-technical-uis](designing-technical-uis/SKILL.md) | The repository has a technical UI (workbench, calculator, analysis or comparison view, dashboard, data tables, settings, admin tool, CLI output) or user-facing docs | The folders that hold UI or docs code, when they are not the whole repository | `UI screens and user-facing text: load the designing-technical-uis skill first.` in the `AGENTS.md` of each of those folders (the root `AGENTS.md` for the whole repository). A folder `AGENTS.md` created for it gets a `CLAUDE.md` with `@AGENTS.md` when Claude Code is selected. |

## Anthropic

Source `anthropics/skills`. In Claude Code, `docx`, `pdf`, `pptx` and `xlsx` already come with the claude.ai skills `anthropic-skills`, so they are Codex only here.

| Skill | Pick when | Agents |
|---|---|---|
| `frontend-design` | New UI or a visual redesign | both |
| `mcp-builder` | The repository builds an MCP server | both |
| `docx`, `pdf`, `pptx`, `xlsx` | The repository produces or edits that file type | Codex only |

## Science

Source `K-Dense-AI/scientific-agent-skills` (MIT). Python skills: read each one's dependencies before installing. Skills that need paid API keys are not listed.

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

## Security

| Skill | Source (license) | Pick when |
|---|---|---|
| `gha-security-review` | `getsentry/skills` (Apache-2.0) | The repository has GitHub Actions workflows |
| `fp-check` | `trailofbits/skills` (CC-BY-SA-4.0) | Security findings from a scanner or review need triage |
| `variant-analysis` | `trailofbits/skills` (CC-BY-SA-4.0) | A found vulnerability may repeat elsewhere in the code |
| `sharp-edges` | `trailofbits/skills` (CC-BY-SA-4.0) | The repository exposes an API or configuration others can misuse |

CC-BY-SA-4.0: the copied skill keeps its license and attribution in the project.

## Docs and data

| Skill | Source (license) | Pick when |
|---|---|---|
| `mermaid-diagrams` | `softaworks/agent-toolkit` (MIT) | The docs hold architecture, sequence or flow diagrams |
| `accessibility` | `addyosmani/web-quality-skills` (MIT) | A web UI that needs a WCAG 2.2 audit |
| `validate-data` | `anthropics/knowledge-work-plugins` (Apache-2.0) | The repository imports or publishes datasets |

## Operations, legal, product

| Skill | Source (license) | Pick when |
|---|---|---|
| `incident-response` | `anthropics/knowledge-work-plugins` (Apache-2.0) | A deployed service with on-call or postmortems |
| `compliance-check` | `anthropics/knowledge-work-plugins` (Apache-2.0) | The product falls under a regulation (privacy, finance, health) |
| `gdpr-compliant` | `github/awesome-copilot` (MIT) | The code processes personal data of people in the EU |
| `synthesize-research` | `anthropics/knowledge-work-plugins` (Apache-2.0) | The repository holds user interviews, surveys or feedback to evaluate |
