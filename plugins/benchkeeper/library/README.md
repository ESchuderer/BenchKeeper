# Skill library

Skills that `setting-up-projects` installs into a project, never globally. It proposes a set when "Pick when" matches what the repository contains, and the user trims it skill by skill. The source of these tables is `library.json` (`node .github/scripts/library-readme.mjs` writes them, CI checks them). Nothing here duplicates the global setup (Ponytail, the BenchKeeper skills, find-skills, and Matt Pocock's skills when installed) or Claude Code's bundled skills. Stack skills: `setting-up-projects` finds them per project with find-skills.

Install, from the project root, for the selected agents only:
- Own skill (folder next to this file): copy it to `.agents/skills/<name>/` (Codex) and `.claude/skills/<name>/` (Claude Code). With both agents selected, the Claude Code copy is a link to the Codex copy. Codex ignores the `paths` key.
- Community skill: `DO_NOT_TRACK=1 npx -y skills@npm:skills@1.7.2 add https://github.com/<source>/tree/<ref> -s <skill> <agent-flags> --copy -y`, with `ref` from `library.json` (the `npm:` alias runs the registry package, never a `skills` in the project's `node_modules`). The project's `skills-lock.json` records the ref and pins the content.

<!-- generated:catalog -->
## Own

Folders next to this file.

| Skill | Pick when | `paths` | Pointer line |
| --- | --- | --- | --- |
| [designing-technical-uis](designing-technical-uis/SKILL.md) | The repository has a technical UI (workbench, calculator, analysis or comparison view, dashboard, data tables, settings, admin tool, CLI output) or user-facing docs | The folders that hold UI or docs code, when they are not the whole repository | `UI screens and user-facing text: load the designing-technical-uis skill first.` in the `AGENTS.md` of each of those folders (the root `AGENTS.md` for the whole repository). A folder `AGENTS.md` created for it gets a `CLAUDE.md` with `@AGENTS.md` when Claude Code is selected. |

## Anthropic

In Claude Code, `docx`, `pdf`, `pptx` and `xlsx` already come with the claude.ai skills `anthropic-skills`, so they are Codex only here.

| Skills | Source (license) | Agents | Pick when |
| --- | --- | --- | --- |
| `frontend-design` | `anthropics/skills` | both | New UI or a visual redesign |
| `mcp-builder` | `anthropics/skills` | both | The repository builds an MCP server |
| `docx`, `pdf`, `pptx`, `xlsx` | `anthropics/skills` | Codex only | The repository produces or edits that file type |

## Science

Python skills: read each one's dependencies before installing. Skills that need paid API keys are not listed.

| Skills | Source (license) | Agents | Pick when |
| --- | --- | --- | --- |
| Core: `scientific-critical-thinking`, `experimental-design`, `hypothesis-generation`, `statistical-analysis`, `statistical-power`, `uncertainty-and-units`, `exploratory-data-analysis`, `scientific-visualization` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | Research, measurement or data analysis code |
| Literature: `literature-review`, `paper-lookup`, `citation-management`, `database-lookup`, `markitdown` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | The repository works with papers, datasets from public databases, or PDF and Office sources |
| Writing: `scientific-writing`, `peer-review`, `venue-templates` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | The repository holds a paper, report or thesis |
| Modelling: `sympy`, `pymoo`, `cantera` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | Symbolic math, multi-objective optimization, chemical kinetics or thermodynamics |

## Marketing

The skills read `.agents/product-marketing.md` when it exists, which `product-marketing` writes.

| Skills | Source (license) | Agents | Pick when |
| --- | --- | --- | --- |
| Core: `product-marketing`, `copywriting`, `copy-editing`, `seo-audit`, `ai-seo`, `schema`, `launch`, `site-architecture` | `coreyhaines31/marketingskills` (MIT) | both | A product site, landing pages or a public launch |
| Optional: `content-strategy`, `cro`, `directory-submissions`, `analytics` | `coreyhaines31/marketingskills` (MIT) | both | A blog or docs plan, conversion work, directory listings, or analytics setup |

## Security

CC-BY-SA-4.0: the copied skill keeps its license and attribution in the project.

| Skills | Source (license) | Agents | Pick when |
| --- | --- | --- | --- |
| `gha-security-review` | `getsentry/skills` (Apache-2.0) | both | The repository has GitHub Actions workflows |
| `fp-check` | `trailofbits/skills` (CC-BY-SA-4.0) | both | Security findings from a scanner or review need triage |
| `variant-analysis` | `trailofbits/skills` (CC-BY-SA-4.0) | both | A found vulnerability may repeat elsewhere in the code |
| `sharp-edges` | `trailofbits/skills` (CC-BY-SA-4.0) | both | The repository exposes an API or configuration others can misuse |

## Testing

| Skills | Source (license) | Agents | Pick when |
| --- | --- | --- | --- |
| `playwright-best-practices` | `currents-dev/playwright-best-practices-skill` (MIT) | both | The repository has or adds Playwright tests |

## Docs and data

| Skills | Source (license) | Agents | Pick when |
| --- | --- | --- | --- |
| `mermaid-diagrams` | `softaworks/agent-toolkit` (MIT) | both | The docs hold architecture, sequence or flow diagrams |
| `accessibility` | `addyosmani/web-quality-skills` (MIT) | both | A web UI that needs a WCAG 2.2 audit |
| `validate-data` | `anthropics/knowledge-work-plugins` (Apache-2.0) | both | The repository imports or publishes datasets |

## Operations, legal, product

| Skills | Source (license) | Agents | Pick when |
| --- | --- | --- | --- |
| `incident-response` | `anthropics/knowledge-work-plugins` (Apache-2.0) | both | A deployed service with on-call or postmortems |
| `compliance-check` | `anthropics/knowledge-work-plugins` (Apache-2.0) | both | The product falls under a regulation (privacy, finance, health) |
| `gdpr-compliant` | `github/awesome-copilot` (MIT) | both | The code processes personal data of people in the EU |
| `synthesize-research` | `anthropics/knowledge-work-plugins` (Apache-2.0) | both | The repository holds user interviews, surveys or feedback to evaluate |

## Packs

Named selections that project setup proposes when "Pick when" matches. A pack with a plugin installs through the agent's plugin command; its prompts are the steps the user starts after installing.

| Pack | Contents | Pick when |
| --- | --- | --- |
| `matt-pocock` | plugins `mattpocock-skills@claude-plugins-official`, `mattpocock-skills@mattpocock`; then `/mattpocock-skills:setup-matt-pocock-skills` | The project uses his grilling, spec, tickets, test-first and review skills |
| `frontend` | `frontend-design`, `designing-technical-uis`, `accessibility` | The repository has a web UI |
| `testing` | `playwright-best-practices` | The repository has or adds browser tests |
| `security` | `gha-security-review`, `fp-check`, `variant-analysis`, `sharp-edges` | CI workflows, a public API, or security findings to triage |
| `science` | `scientific-critical-thinking`, `experimental-design`, `statistical-analysis`, `uncertainty-and-units`, `scientific-visualization` | Research, measurement or data analysis code |
| `docs` | `designing-technical-uis`, `mermaid-diagrams` | User-facing docs or diagrams |
| `data` | `validate-data`, `exploratory-data-analysis`, `statistical-analysis` | The repository imports, analyzes or publishes datasets |
| `marketing` | `product-marketing`, `copywriting`, `copy-editing`, `seo-audit`, `launch` | A product site, landing pages or a public launch |
| `operations` | `incident-response`, `compliance-check`, `gdpr-compliant` | A deployed service or regulated product |
<!-- /generated:catalog -->
