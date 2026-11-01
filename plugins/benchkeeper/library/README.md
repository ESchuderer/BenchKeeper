# Skill library

Skills that the app (`npx benchkeeper@6 projects apply --pack <id> --skill <name>`) or `setting-up-projects` installs into a project. Project setup proposes a set when "Pick when" matches what the repository contains, and the user trims it skill by skill. The source of these tables is `library.json` (`node .github/scripts/library-readme.mjs` writes them, CI checks them). Nothing here duplicates the global setup (Ponytail, the BenchKeeper skills, find-skills, and Matt Pocock's skills when installed) or Claude Code's bundled skills. Stack skills: `setting-up-projects` finds them per project with find-skills.

Install, from the project root, for the selected agents only:
- Own skill (folder next to this file): copy it to `.agents/skills/<name>/` (Codex) and `.claude/skills/<name>/` (Claude Code). Codex ignores the `paths` key.
- Community skill: `<skills> add https://github.com/<source> -s <skill> <agent-flags> --copy -y`, from the source's default branch, where `<skills>` is the line `npx benchkeeper@6 skills cli` prints after it checks the release's registry signatures (its `npm:` alias runs the registry package, never a `skills` in the project's `node_modules`). The project's state file records the commit the install got, and `skills-lock.json` its content hash.

<!-- generated:catalog -->
## Own

Folders next to this file.

| Skill | Pick when | `paths` | Pointer line |
| --- | --- | --- | --- |
| [designing-technical-uis](designing-technical-uis/SKILL.md) | The repository has a technical UI (workbench, calculator, analysis or comparison view, dashboard, data tables, settings, admin tool, CLI output) or user-facing docs | The folders that hold UI or docs code, when they are not the whole repository | `UI screens and user-facing text: load the designing-technical-uis skill first.` in the `AGENTS.md` of each of those folders (the root `AGENTS.md` for the whole repository). A folder `AGENTS.md` created for it gets a `CLAUDE.md` with `@AGENTS.md` when Claude Code is selected. |

## Anthropic

| Skills | Source (license) | Agents | Pick when |
| --- | --- | --- | --- |
| `frontend-design` | `anthropics/skills` | both | New UI or a visual redesign |
| `mcp-builder` | `anthropics/skills` | both | The repository builds an MCP server |

## Science

Python skills: read each one's dependencies before installing. Skills that need paid API keys are not listed.

| Skills | Source (license) | Agents | Pick when |
| --- | --- | --- | --- |
| Core: `experimental-design` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | Experiments are planned before data collection: randomization, blocking, factorial designs |
| Core: `hypothesis-generation` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | Observations turn into testable hypotheses and preregistered plans |
| Core: `statistical-analysis` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | Groups are compared or hypotheses tested: test choice, assumptions, effect sizes, reporting |
| Core: `statistical-power` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | Sample sizes or power need calculating before a study |
| Core: `uncertainty-and-units` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | Physical units and measurement uncertainty propagate through calculations |
| Core: `exploratory-data-analysis` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | Unfamiliar CSV, JSON, HDF5 or FASTA files get profiled: missingness, outliers, leakage |
| Core: `scientific-visualization` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | Publication figures with Matplotlib, Seaborn or Plotly |
| Literature: `literature-review` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | Systematic or scoping literature reviews |
| Literature: `paper-lookup` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | Papers, preprints and open-access full text are searched in scholarly APIs |
| Literature: `citation-management` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | References need validating or converting to BibTeX |
| Literature: `database-lookup` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | Facts come from named public database APIs, with provenance |
| Literature: `markitdown` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | PDF, Office or other documents are converted to Markdown |
| Writing: `scientific-writing` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | A manuscript or report is drafted or revised |
| Writing: `peer-review` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | A manuscript, protocol or proposal gets a peer review |
| Writing: `venue-templates` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | A paper, poster or grant follows a journal or conference template (LaTeX) |
| Modelling: `sympy` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | Symbolic math: exact algebra, calculus, equation solving |
| Modelling: `pymoo` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | Single- or multi-objective optimization (NSGA-II, Pareto fronts) |
| Modelling: `cantera` | `K-Dense-AI/scientific-agent-skills` (MIT) | both | Chemical kinetics, combustion and ignition delay with Cantera |

## Marketing

The skills read `.agents/product-marketing.md` when it exists, which `product-marketing` writes.

| Skills | Source (license) | Agents | Pick when |
| --- | --- | --- | --- |
| Core: `product-marketing` | `coreyhaines31/marketingskills` (MIT) | both | Positioning, target audience and the product context the other marketing skills read |
| Core: `copywriting` | `coreyhaines31/marketingskills` (MIT) | both | New copy for a homepage, landing or pricing page |
| Core: `copy-editing` | `coreyhaines31/marketingskills` (MIT) | both | Existing marketing copy gets edited or proofread |
| Core: `seo-audit` | `coreyhaines31/marketingskills` (MIT) | both | Search ranking problems: technical SEO, meta tags, crawl errors |
| Core: `ai-seo` | `coreyhaines31/marketingskills` (MIT) | both | Answers from AI search engines and LLMs should cite the site |
| Core: `schema` | `coreyhaines31/marketingskills` (MIT) | both | Structured data: JSON-LD, schema.org, rich results |
| Core: `launch` | `coreyhaines31/marketingskills` (MIT) | both | A product launch, feature announcement or go-to-market plan |
| Core: `site-architecture` | `coreyhaines31/marketingskills` (MIT) | both | Page hierarchy, navigation, URLs and internal links of a website |
| Optional: `content-strategy` | `coreyhaines31/marketingskills` (MIT) | both | A blog or content plan: topics, clusters, editorial calendar |
| Optional: `cro` | `coreyhaines31/marketingskills` (MIT) | both | A page or form does not convert well enough |
| Optional: `directory-submissions` | `coreyhaines31/marketingskills` (MIT) | both | The product gets listed in startup, SaaS or AI directories |
| Optional: `analytics` | `coreyhaines31/marketingskills` (MIT) | both | Event tracking: GA4, tag manager, UTM parameters |

## Security

CC-BY-SA-4.0: the copied skill keeps its license and attribution in the project.

| Skills | Source (license) | Agents | Pick when |
| --- | --- | --- | --- |
| `gha-security-review` | `getsentry/skills` (Apache-2.0) | both | The repository has GitHub Actions workflows |
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
| `ponytail` | plugins `ponytail@ponytail`, `ponytail@ponytail` | The smallest complete change per task: a behavior mode for Claude Code and Codex, set to level full. It adds about 1,000 tokens at each session start (its rules and a map of the repository) and about 700 per subagent |
| `matt-pocock` (workflow owner) | plugins `mattpocock-skills@claude-plugins-official`, `mattpocock-skills@mattpocock`; then `/mattpocock-skills:setup-matt-pocock-skills` (Codex `$mattpocock-skills:setup-matt-pocock-skills`) | The project uses his grilling, spec, tickets, test-first and review skills |
| `frontend` | `frontend-design`, `designing-technical-uis`, `accessibility` | The repository has a web UI |
| `testing` | `playwright-best-practices` | The repository has or adds browser tests |
| `security` | `gha-security-review`, `variant-analysis`, `sharp-edges` | CI workflows, a public API, or security findings to triage |
| `science` | `experimental-design`, `statistical-analysis`, `uncertainty-and-units`, `scientific-visualization` | Research, measurement or data analysis code |
| `docs` | `designing-technical-uis`, `mermaid-diagrams` | User-facing docs or diagrams |
| `data` | `validate-data`, `exploratory-data-analysis`, `statistical-analysis` | The repository imports, analyzes or publishes datasets |
| `marketing` | `product-marketing`, `copywriting`, `copy-editing`, `seo-audit`, `launch` | A product site, landing pages or a public launch |
| `operations` | `incident-response`, `compliance-check`, `gdpr-compliant` | A deployed service or regulated product |

## Sources

Agent files a project picks one by one (`--agent-file <path>`), fetched at a pinned commit.

| Source | Agent files | Evaluation |
| --- | --- | --- |
| `agency-agents` | `msitarzewski/agency-agents` at `b37b5bb33b78`: `engineering-frontend-developer`, `engineering-backend-architect`, `engineering-technical-writer`, `security-architect`, `testing-accessibility-auditor`, `testing-reality-checker`. Claude Code, Codex (converted to TOML) and GitHub Copilot CLI: Gemini CLI agent files need the project's converter, which this setup does not run. | [agency-agents.md](https://github.com/ESchuderer/BenchKeeper-research/blob/main/evaluations/workflow-frameworks/agency-agents.md) |
<!-- /generated:catalog -->
