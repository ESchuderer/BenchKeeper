# Frontend and docs skills

Category: skill libraries, Checked 2026-10-22, Decision: Per project (frontend and docs packs), mcp-builder flagged for owner review

Four skills at the commits pinned in `plugins/benchkeeper/library/library.json`: `frontend-design` and `mcp-builder` ([anthropics/skills](https://github.com/anthropics/skills) at `dbd4588f9e1033efb41dad4bef2f7947c8993d44`, 2026-10-09), `mermaid-diagrams` ([softaworks/agent-toolkit](https://github.com/softaworks/agent-toolkit) at `3027f20f3181758385a1bb8c022d4041dfb4de84`, 2026-03-05) and `accessibility` ([addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills) at `afa8da942115f2961fdbfa80807ea0b232ff6c00`, 2026-08-24). The library also installs BenchKeeper's own `designing-technical-uis` in the same packs; its check is in [skill-authoring.md](../practices/skill-authoring.md) (4 tasks, n = 1 per task, author-scored, confidence low to medium) and is not repeated here. `designing-technical-uis` leaves visual style to `frontend-design`, so the two are meant to be installed together.

Packs (`library.json`): frontend = `frontend-design`, `designing-technical-uis`, `accessibility`. Docs = `designing-technical-uis`, `mermaid-diagrams`. `mcp-builder` has no pack, it is a single pick ("The repository builds an MCP server").

Facts shared with [Anthropic document skills](anthropic-document-skills.md) (same repository, same commit):

- Not shared: license. `frontend-design` and `mcp-builder` carry the Apache License 2.0 (`LICENSE.txt`, "Copyright 2026 Anthropic, PBC" in mcp-builder). The repository README calls "many skills" open source (Apache 2.0) and the four document skills "source-available, not open source" ([README](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/README.md)). `docx/LICENSE.txt` is Anthropic's all-rights-reserved text that points to the Anthropic terms of service ([file](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/docx/LICENSE.txt)). Apache 2.0 requires keeping the license and notices with redistributed copies, which the skills CLI copy does (`LICENSE.txt` sits in each skill folder).
- Shared: Claude Code distribution. Neither skill is bundled with Claude Code itself. Both are in the `example-skills` plugin of the anthropics/skills marketplace ([marketplace.json](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/.claude-plugin/marketplace.json), lines 25 to 36), which the README says is also available on paid claude.ai plans ([README](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/README.md)). `frontend-design` also exists as a plugin in the [claude-code repository](https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design) (same opening text as the pinned skill, repository license "All rights reserved, subject to Commercial Terms", unverified whether the two copies differ elsewhere). A user who installed that plugin and the library skill has the skill twice. The Codex-only document skills reasoning in the other file does not apply: the library installs these two for both agents.

## frontend-design

[Skill](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/frontend-design)

### Advertised

- Anthropic: a prompt-based skill that steers Claude away from generic web design defaults, loaded on demand, core prompt about 400 tokens, shown with before and after screenshots and no metrics ([Anthropic, 2025-11-12](https://claude.com/blog/improving-frontend-design-through-skills)). The pinned SKILL.md has since been rewritten (71 lines, 9.4 KB, a plan-review-build-critique process, a list of default looks to avoid, copywriting rules), so the 400-token figure no longer describes it.

### Independent evidence

- None found. No paired benchmark of this skill; the searches (web, arXiv, SkillsBench, SWE-Skills-Bench, SkillTester) return no result that names it. It does not appear in the 49 skills of [SWE-Skills-Bench](https://arxiv.org/abs/2603.15401), which covers code tasks with tests, not visual quality.
- Context only: [SkillsBench](https://arxiv.org/abs/2602.12670) found curated skills of at most 3 modules ahead of exhaustive bundles. This skill is one file with no references, so it falls in the focused class, but the result is from other tasks.

### User reports

- skills.sh: 1.0M installs, first seen 2026-01-19, Gen Agent Trust Hub, Socket and Snyk all Pass ([skills.sh](https://skills.sh/anthropics/skills/frontend-design)).
- Issues in the Claude Code repository concern the plugin distribution, not the skill text: [#79776](https://github.com/anthropics/claude-code/issues/79776) (update banner on every refresh), [#59489](https://github.com/anthropics/claude-code/issues/59489) (plugin repeatedly uninstalls, closed). No open issue about the skill text in anthropics/skills (GitHub search `frontend-design in:title,body`, 2026-10-22).
- Anecdotal blog posts exist (for example a Medium post and a UX Planet comparison); none gives a method, not cited as evidence.

### Skill authoring check

- Files: SKILL.md and LICENSE.txt only. No scripts, downloads, network calls, telemetry, credential requests or hooks (read in full). No references outside the folder.
- Scope: stays on visual design and UI copy. It asks the agent to confirm the subject with the client when the brief does not name it (SKILL.md, "Ground your designs in the subject matter") and to take screenshots "if your environment supports it". Both are within purpose.
- Conflict to know: it pushes for "distinctive" and "aesthetic risk", which suits landing pages and new products. For the technical UIs BenchKeeper targets (workbenches, calculators, tables), `designing-technical-uis` covers the content rules, and this skill's "brief's own words always win" clause lets a repository `AGENTS.md` pin a restrained style.
- The installed copy contains em dashes (8) and the pinned text is unmodified upstream. The repository checks in BenchKeeper exempt `.agents/` and `.claude/`.
- Description (third person, what and when): "Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one." 71 lines, under the 500-line guideline.

### Decision

Keep, frontend pack, "New UI or a visual redesign" (current `pickWhen`). No measurement exists, so it stays per project, never global. Retest with a UI brief scored by a screenshot rubric before it moves into any default.

## mcp-builder

[Skill](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/mcp-builder)

### Advertised

- Skill description: a guide for building MCP servers in Python (FastMCP) or TypeScript, ending in 10 evaluation questions. No quantitative claim. The SKILL.md states its own yardstick: "The quality of an MCP server is measured by how well it enables LLMs to accomplish real-world tasks".

### Independent evidence

- [SWE-Skills-Bench, arXiv 2603.15401](https://arxiv.org/abs/2603.15401) (49 public skills, about 565 task instances, Claude Code with Claude Haiku 4.5, use-skill against no-skill, deterministic acceptance tests): `mcp-builder`, 10 tasks, pass rate 100% with and 100% without, delta 0.0%, tokens 273K with vs 200K without (+36.1%). A signal, not a measurement for this setup: another model, 10 tasks, runs per arm not stated, skill source and version not stated (unverified that it is this copy), and a ceiling effect leaves no room to show a gain. The paper's headline: 39 of 49 skills give zero pass-rate change, mean +1.2%.

### User reports

- skills.sh: 130.1K installs, first seen 2026-01-19. Gen Agent Trust Hub Pass, Socket Pass, Snyk Warn, risk MEDIUM, finding W011 "Third-party content exposure detected (indirect prompt injection risk)": the workflow fetches SDK READMEs from GitHub through WebFetch (audited 2026-09-14, [Snyk page](https://skills.sh/anthropics/skills/mcp-builder/security/snyk), [overview](https://skills.sh/anthropics/skills/mcp-builder)).
- Open issues in anthropics/skills, all on the pinned content (read 2026-10-22):
  - [#1390](https://github.com/anthropics/skills/issues/1390): `evaluation.py` calls `json.dumps` on a list of `TextContent` objects, which raises on every tool call and is reported back to the model as a tool error, so the run scores low or 0/N. A commenter reports 6/10 instead of 0. Confirmed in the pinned code: `scripts/connections.py` lines 68 to 69 return `result.content`, `scripts/evaluation.py` line 117 serializes it with `json.dumps`.
  - [#1668](https://github.com/anthropics/skills/issues/1668): `requirements.txt` (`mcp>=1.1.0`, no upper bound) resolves to mcp 2.x, where `connections.py` line 10 imports the renamed `streamablehttp_client` and fails at import.
  - [#1716](https://github.com/anthropics/skills/issues/1716): `evaluation.py` defaults to `claude-3-7-sonnet-20250219` (lines 223 and 324 of the pinned file).
  - [#1013](https://github.com/anthropics/skills/issues/1013) (stale SDK API references and a Pydantic v2 deprecation in the guides), [#1618](https://github.com/anthropics/skills/issues/1618) (the Python resource example builds a file path from an unsanitized URI parameter), [#1895](https://github.com/anthropics/skills/issues/1895) (repeated `-e` and `-H` flags keep only the last), [#1967](https://github.com/anthropics/skills/issues/1967) (advice for "concise tool descriptions" against Anthropic's tool-use guidance).
  - No fix is merged as of the check; two fix pull requests are open ([#1397](https://github.com/anthropics/skills/pull/1397), [#1588](https://github.com/anthropics/skills/pull/1588)).

### Skill authoring check

- Files: SKILL.md (236 lines), 4 reference guides (`reference/`, 2.5K lines in total), 3 scripts (`connections.py`, `evaluation.py`, `example_evaluation.xml`) and `requirements.txt`. All inside the skill folder, so the skills CLI copies them.
- Run-time fetches: SKILL.md lines 61 and 65 and `reference/python_mcp_server.md` lines 42 to 43 tell the agent to WebFetch the SDK READMEs from `raw.githubusercontent.com/modelcontextprotocol/{typescript,python}-sdk/main/README.md`. Lines 41 to 43 and 203 point to `modelcontextprotocol.io/sitemap.xml` and the `draft.md` spec. These are unpinned branch URLs on the official `modelcontextprotocol` organization. The fetched text is documentation, not skill instructions and not code to run, but it is third-party text that enters the context without a pin. Compare [library exclusions](library-exclusions.md): Vercel `web-design-guidelines` and `writing-guidelines` were not listed for fetching their rules from a branch URL on every run.
- Run-time code: line 141 runs `npx @modelcontextprotocol/inspector` unpinned. `reference/evaluation.md` lines 387 to 398 install `anthropic` and `mcp` unpinned (`>=`) and ask for `ANTHROPIC_API_KEY`. Neither runs unless the user follows Phase 3 and Phase 4. `evaluation.py` line 228 uses `Anthropic()`, so Phase 4 is billed to the API key, not a subscription.
- Telemetry, hooks, instructions outside the purpose: none. `connections.py` spawns the user-supplied server command and accepts caller-supplied URLs and headers, which is what an evaluation client does (issues [#1619](https://github.com/anthropics/skills/issues/1619) and [#1621](https://github.com/anthropics/skills/issues/1621) report the lack of validation).
- The SKILL.md headings and links carry emoji (lines 17, 58 and following). The installed copy is exempt from the repository text checks (`.agents/`, `.claude/`).
- Description: third person, what and when, names both languages.

### Decision

Keep only if the owner accepts the run-time fetch of SDK READMEs and a Phase 4 harness that is broken at the pinned commit. Proposal: keep as a single pick (no pack), "The repository builds an MCP server", and add to the library note that Phase 4 (`scripts/evaluation.py`) does not run correctly (#1390, #1668) and that the SDK docs are fetched from the `main` branch. Remove it instead if the Vercel exclusion rule (no branch-URL fetch at run time) applies without exception. Measured effect: none (SWE-Skills-Bench delta 0.0%, +36.1% tokens, other model). Retest with an MCP server brief.

## mermaid-diagrams

[Skill](https://github.com/softaworks/agent-toolkit/tree/3027f20f3181758385a1bb8c022d4041dfb4de84/skills/mermaid-diagrams)

### Advertised

- Skill description: a guide for software diagrams in Mermaid (class, sequence, flowchart, ERD, C4, state, git, gantt and others). No quantitative claim, no benchmark. The README of the skill lists tips and workflows only.

### Independent evidence

- None found for this skill.
- Context on the task, not on the skill: [DIAGRAM-FAIL-BENCH](https://neurips.cc/virtual/2026/173008) (NeurIPS 2026 listing, 630 Mermaid tasks, 21 diagram types, three unnamed model families) reports that documentation raises render rates but leaves a "render-constraint gap" (code renders but violates structural constraints), and that raw execution feedback removes most of that gap. On a frozen 70-task subset a coding agent with black-box verifier iterations went from 51.43% to 60.00% executable success. The skill has no render or validation step (SKILL.md lines 191 and 198 send the user to Mermaid Live to validate), so the result suggests a render check in the project (`mmdc`) would add more than the skill text. [MermaidSeqBench](https://arxiv.org/abs/2511.14967) (132 sequence diagram samples, LLM judges) measures models without any skill.

### User reports

- skills.sh: 5.1K installs, first seen 2026-01-20, Gen Agent Trust Hub, Socket and Snyk Pass ([skills.sh](https://skills.sh/softaworks/agent-toolkit/mermaid-diagrams)). The repository has 2.6K stars and 20 open issues; none names this skill. Open pull request [#48](https://github.com/softaworks/agent-toolkit/pull/48) proposes tighter mermaid and draw.io authoring rules. The skill's last change is 2026-02-01 (architecture reference, [#5](https://github.com/softaworks/agent-toolkit/pull/5)).

### Skill authoring check

- Files: SKILL.md (217 lines), README.md and 7 reference files (`references/`, 2.9K lines), all in the folder and linked from SKILL.md. No scripts, no hooks, no telemetry, no credential requests. MIT, "Copyright (c) 2026 Leonardo Flores" (repository `LICENSE`, at the repository root, not inside the skill folder: the skills CLI does not copy it, so the copyright notice is not carried into the installed copy. MIT requires the notice with copies, so this is a small attribution gap, unverified whether the CLI adds it).
- Install commands in SKILL.md (line 192: `npm install -g @mermaid-js/mermaid-cli`, a Docker image) and references (`npm install @iconify-json/logos`, `https://cdn.jsdelivr.net/npm/mermaid@10/...` in an HTML example, `advanced-features.md` line 516) are suggestions for the user's project, unpinned. BenchKeeper's own docs pin versions; this skill does not, so a user who follows them gets the newest release.
- Scope: the description's triggers ("diagram", "visualize", "model", "map out") are broad, and the "Always diagram when starting new projects or features" list (SKILL.md line 204) nudges toward diagrams where none were asked for. Mild, and consistent with its purpose.
- Description: third person, what and when, about 600 characters (long, so it costs context in every session that lists skills).

### Decision

Keep, docs pack, "The docs hold architecture, sequence or flow diagrams". No evidence of effect. Retest with a docs brief that checks diagrams for rendering.

## accessibility

[Skill](https://github.com/addyosmani/web-quality-skills/tree/afa8da942115f2961fdbfa80807ea0b232ff6c00/skills/accessibility)

### Advertised

- Skill description: audit and improve web accessibility following WCAG 2.2. The text says an automated score of 100 "is not WCAG conformance" and that tools detect "only a subset" of barriers (SKILL.md lines 20 to 23). No quantitative claim, no benchmark.

### Independent evidence

- None found for this skill. It is not among the 49 skills of [SWE-Skills-Bench](https://arxiv.org/abs/2603.15401) and no other test turned up.

### User reports

- skills.sh: 63.2K installs, first seen 2026-01-20, Gen Agent Trust Hub, Socket and Snyk Pass ([skills.sh](https://skills.sh/addyosmani/web-quality-skills/accessibility)). The repository has 3.0K stars and 9 issues in total: 4 closed (two on wrong examples, one commit correcting examples on 2026-05-07), 4 open, all feature or promotion requests ([issues](https://github.com/addyosmani/web-quality-skills/issues)). Different from `addyosmani/agent-skills`, which has its own file: [agent-skills](agent-skills.md).

### Skill authoring check

- Files: SKILL.md (464 lines, 14 KB, under the 500-line guideline), `references/WCAG.md`, `references/A11Y-PATTERNS.md`. No scripts, hooks, telemetry or credential requests. MIT, "Copyright (c) 2026 Addy Osmani" (repository `LICENSE`, outside the skill folder, same attribution gap as above).
- Reference outside the folder: line 462 links `../web-quality-audit/SKILL.md`. It is a link in the Resources list, not an instruction to load it, so the installed skill still works; the link is dead.
- Tools it names: the audit workflow (lines 15 to 23) prefers Chrome DevTools MCP (`lighthouse_audit`, `take_snapshot`), which BenchKeeper does not install, and falls back to `npx lighthouse` and `npm install @axe-core/cli -g` (lines 409 to 417, unpinned, run only if the agent chooses). A repository with Playwright MCP and axe in CI already has an equivalent loop. Overlaps the axe job in `pages.yml` for this repository.
- Description: third person with trigger phrases, no "when" clause beyond the phrase list.

### Decision

Keep, frontend pack, "A web UI that needs a WCAG 2.2 audit". No evidence of effect. Retest with a UI brief that scores axe violations before and after.

[All evaluations](../../EVALUATIONS.md)
