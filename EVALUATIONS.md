# Evaluations

Components considered for BenchKeeper, the evidence for each, and whether each is in BenchKeeper. One file per component under `evaluations/<category>/`, sections in this order: Advertised, Independent evidence, User reports, Benchmark (BenchKeeper's own runs, where the component ran as an arm), Skill authoring check, Quality bar check (skill libraries only, [library quality bar](evaluations/skill-libraries/library-quality-bar.md)), Decision. Cross-tool findings, sources to follow and A/B test tools: [evaluations/studies.md](evaluations/studies.md). Checked 2026-10-14 to 2026-10-28 (each file names its date).

SCB preparation updated on 2026-10-21: [protocol 1.23](bench/PROTOCOL.md#external-benchmark-pilot-slopcodebench-v123) separates natural skill selection from delivery and scoring failures, and pins the current setup as AO. Reference calibration also exposed a missing MIME database in the scorer image, and an `sg` name clash that skipped scb-check's ast-grep rules. No new skill-effectiveness results.

## Rules

- Search the [sources to follow](evaluations/studies.md#sources-to-follow) and arXiv first, then GitHub issues, Hacker News, forums and blogs (user reports checked 2026-10-13, mostly one repository and 1 to 4 runs per arm). Reddit cannot be fetched (access refused). Thread text supplied by the owner is labeled as such.
- Record per result: version, harness, model and effort, task count, runs per arm, deltas and p-values where given. "Independent" means not run by the tool's own project. Vendor-run and competitor-run results are labeled, kept apart from independent ones, and do not decide alone. Advertised figures stand next to measured ones. Claims not checked are labeled unverified.
- A paired design with about 50 tasks or more and a significance test or interval is a measurement. Single runs, a handful of tasks or judge-only scores are signals. Results from another setup (agent, model family, component version, injection method) are context, not a decision.
- A decision changes when two or more independent measurements, or one measurement and consistent signals across setups, agree in direction on the target setup. One contradicting measurement marks the entry "evidence mixed" and queues a retest in a benchmark issue. A new major version marks earlier results stale until re-measured.
- Cost counts per completed task. Lower tokens with lower correctness or robustness is a regression.
- When a component is added, removed or changed, or new evidence appears: update its file, its row below, and the open benchmark issue when it changes what that issue measures.

## Overview

### BenchKeeper

| Component | Decision | Summary |
|---|---|---|
| [BenchKeeper layer](https://github.com/ESchuderer/BenchKeeper-research/blob/main/bench/SCENARIOS.md) | the setup itself | arms AL, AN (setup-v4.0 with and without Ponytail) and AM (setup-v5.0), three rounds per arm: [mistreevous](https://github.com/ESchuderer/BenchKeeper-research/blob/main/bench/results/2026-10-18-mistreevous.md), AM against plain Claude Code on opusplan: [mistreevous-opusplan](https://github.com/ESchuderer/BenchKeeper-research/blob/main/bench/results/2026-10-19-mistreevous-opusplan.md). setup-v6.0 (the app, the workflow skill) not measured yet: [#132](https://github.com/ESchuderer/BenchKeeper/issues/132) |

### Behavior modes

| Component | Decision | Summary |
|---|---|---|
| [Ponytail](evaluations/behavior-modes/ponytail.md) | Optional pack, evidence mixed (arm B, k=3) | lines down in every source that measured them, cost -10.3% (JetBrains) to +55% elsewhere, 0.58 times plain Claude Code in mistreevous (k=3) |
| [caveman](evaluations/behavior-modes/caveman.md) | Not in, never part of BenchKeeper | advertised -65%, measured -8.5% output tokens, score p=0.82 (JetBrains). Cost not reduced in 3 sources |

### Skill libraries

| Component | Decision | Summary |
|---|---|---|
| [agent-skills](evaluations/skill-libraries/agent-skills.md) | Out (setup-v3.0) | replaced by Matt Pocock's skills. Own mistreevous run: alone 89.7, Matt Pocock's skills alone 87.2, plain Claude Code 87.0 (inside the spread) |
| [mattpocock/skills](evaluations/skill-libraries/mattpocock-skills.md) | Optional pack (setup-v6.0; in from setup-v3.0) | 9 of 18 trials with them called any; no quality gain over plain Claude Code (mistreevous 87.2 vs 87.0). With Ponytail or the BenchKeeper setup-v4.0 among the fastest and cheapest arms |
| [andrej-karpathy-skills](evaluations/skill-libraries/andrej-karpathy-skills.md) | Not in | accuracy 60/60 in every arm. Cost +11.5% (skill-receipts), +6.6% (skillbench) |
| [Anthropic document skills](evaluations/skill-libraries/anthropic-document-skills.md) | Removed from the library (issue 151, setup-v6.10) | DocOps: Claude Code Sonnet 4.6 0.519 with skills vs 0.552 without. `docx`, `pdf`, `pptx`, `xlsx` ship an all-rights-reserved `LICENSE.txt`: fail on the license point. Claude Code has them through the claude.ai skills |
| [scientific-agent-skills](evaluations/skill-libraries/scientific-agent-skills.md) | Not global, per project | vendor paper, no task-level evaluation. Four sets in the library, other single skills through the search |
| [marketingskills](evaluations/skill-libraries/marketingskills.md) | Not global, per project | no task-level evaluation. Core and optional set in the library, the marketing pack (setup-v6.0) proposes five of the core skills |
| [playwright-best-practices](evaluations/skill-libraries/playwright-best-practices.md) | Per project, testing pack (setup-v6.0) | no evaluation of this skill; 98.0K installs (2026-10-24), security scans passed, no scripts |
| [Security skills](evaluations/skill-libraries/security-skills.md) | Per project, security pack (setup-v6.0); `fp-check` removed (issue 151, setup-v6.10) | no independent evidence; the maintainer's eval shows no variant-analysis uplift; variant-analysis's command loses its plugin files on install; Trail of Bits attribution not copied |
| [Frontend and docs skills](evaluations/skill-libraries/frontend-and-docs-skills.md) | Per project, frontend and docs packs (setup-v6.0), mcp-builder open | no paired measurement of frontend-design, mermaid-diagrams or accessibility; mcp-builder 100% vs 100% (SWE-Skills-Bench), fetches SDK READMEs from main at run time, broken eval script |
| [Data and operations skills](evaluations/skill-libraries/data-and-operations-skills.md) | Per project, data and operations packs (setup-v6.0), gdpr-compliant open | no independent evidence; 1.6K to 5.8K installs, scans pass but one Snyk warn; no scripts or hooks; gdpr-compliant points to two reference files that do not exist |
| [ECC skills](evaluations/skill-libraries/ecc-skills.md) | Pack `ecc` (owner names ECC) with three skills; `tdd-workflow` removed (issue 151, setup-v6.10) | `tdd-workflow` failed the quality bar (script outside the folder, 583 lines), `error-handling` passes; one third-party run for `tdd-workflow`, none found for the others |
| [Library quality bar](evaluations/skill-libraries/library-quality-bar.md) | The 7 that fail are removed (issue 151, setup-v6.10) | 54 library skills checked against five points on 2026-10-24 and 2026-10-25: 7 fail (`docx`, `pdf`, `pptx`, `xlsx` license; `fp-check`, `scientific-critical-thinking`, `tdd-workflow` files outside the folder) and removed, 40 borderline, 7 pass remain (47). Per-skill tables in each source's file, removals in [library exclusions](evaluations/skill-libraries/library-exclusions.md) |
| [Library exclusions](evaluations/skill-libraries/library-exclusions.md) | Not in the library | skills reviewed 2026-10-18 to 2026-10-22 and left out of `plugins/benchkeeper/library/README.md`, and the seven that failed the quality bar and were removed on 2026-10-25, with reasons |

### Workflow frameworks

| Component | Decision | Summary |
|---|---|---|
| [Superpowers](evaluations/workflow-frameworks/superpowers.md) | Not in yet (arms G, J, M, D, k=1) | cost higher in every test but one 6-task run (1.33x on v6.4.2). Pass rate n.s. (p about 0.235). Project setup (setup-v6.7) installs it per project as the workflow owner, never preselected |
| [agency-agents](evaluations/workflow-frameworks/agency-agents.md) | Optional parts, a pick of agent files (setup-v6.7) | no outcome measurement found (search for independent measurements not done, unverified). Agents only, no hooks, installed from a pinned commit |
| [OpenSpec](evaluations/workflow-frameworks/openspec.md) | Out (setup-v3.0) | specs and tickets live in the issue tracker of Matt Pocock's skills. Brownfield: tied with plain Claude Code, one stop after the proposal with the layer |
| [Spec Kit](evaluations/workflow-frameworks/spec-kit.md) | Not in | +0.15 judge score (p<0.05), no baseline with a skill collection. Overlaps the workflow's specs in the issue, and Matt Pocock's skills when installed |
| [GSD](evaluations/workflow-frameworks/gsd.md) | Not in | one task: about 1.2M tokens vs 200K vanilla, outputs indistinguishable |
| [planning-with-files](evaluations/workflow-frameworks/planning-with-files.md) | Not in | vendor only. Every arm passed 77/77. Overlaps the workflow's tickets in the issue tracker, and Matt Pocock's `/to-tickets` when installed |

### Harness bundles

| Component | Decision | Summary |
|---|---|---|
| [ECC](evaluations/harness-bundles/ecc.md) | Not in yet (arms H, K, N, E, minimal profile, k=1) | no outcome measurement. Hook overhead and listing size reported |
| [ruflo](evaluations/harness-bundles/ruflo.md) | Not in | no evidence. No method published for advertised figures |

### Agent harnesses

| Component | Decision | Summary |
|---|---|---|
| [Pi](evaluations/agent-harnesses/pi.md) | Not in | no independent benchmark. Claude subscription use outside Anthropic's terms |

### Context tools

| Component | Decision | Summary |
|---|---|---|
| [RTK](evaluations/context-tools/rtk.md) | Not in | median cost +7.6% at low effort (p=0.004), JetBrains, rtk 0.43.0 |
| [codegraph](evaluations/context-tools/codegraph.md) | Not in | competitor-run only: output tokens -24.4% (Repowise), tokens up to +47% (samchon) |
| [graphify](evaluations/context-tools/graphify.md) | Not in | competitor-run only: output tokens -8.9%. User report: right file first 25% vs 32% BM25 |
| [Context7 MCP](evaluations/context-tools/context7.md) | Not in | 64/89 vs 63/89 passed, called in 6 tasks, Marginlab |
| [LSP plugins](evaluations/context-tools/lsp-plugins.md) | Not in | 6 to 118% more tokens for symbol localization, arXiv 2608.13568 |
| [Serena MCP](evaluations/context-tools/serena.md) | Not in | quality 83.4% vs 84.2% without, competitor-run |
| [headroom](evaluations/context-tools/headroom.md) | Not in | input tokens +6%, cost +44%, competitor-run, SWE-bench Verified 100 |
| [claude-mem](evaluations/context-tools/claude-mem.md) | Not in | none found. One user reports +63.9% API spend |

### Verification

| Component | Decision | Summary |
|---|---|---|
| [Playwright MCP](evaluations/verification/playwright-mcp.md) | In | no paired cost or quality study. Used for UI verification |

### Practices

| Component | Decision | Summary |
|---|---|---|
| [Skill authoring guide (Anthropic)](evaluations/practices/skill-authoring.md) | In | 8 benchmarked collections ranked: Ponytail 3.9 first, Spec Kit 2.8 last. Skill checks also cover checklists and defaults. Only agent-skills ships evaluations |
| [Project summary and layout in AGENTS.md](evaluations/practices/agents-md-overviews.md) | Not in | context files raised cost over 20%, no success gain, arXiv 2602.11988 |
| [Lite install, the workflow skill without a rule line](evaluations/practices/lite-install.md) | Lite level in, trigger rate unverified | 13 eval cases exist for `workflow`; the rate without the always-on line has not been run |
| [Decoupled modules, split before 7.0](evaluations/practices/decoupled-modules.md) | One repository and package, boundaries by folder, content contract | the engine never imports the CLI or server but both reach about 26 modules; one import cycle; app-only releases rewrite 3 files under `plugins/` (8 of 29 releases since 2026-10-12); nothing run in a session |
| [Orchestrating projects, the coordinator skill](evaluations/practices/orchestrating-projects.md) | In, unmeasured | scenario and three checks defined (blocked worker replaced, finished worker cleaned up, no hook bypass); the checks have tests on synthetic logs; a scheduled scenario (sessions only on work, one at a time) is defined; neither scenario has run |
| [Code health pass in maintaining-repos](evaluations/practices/code-health-pass.md) | In, measured on one project | knip, jscpd, dependency-cruiser and StrykerJS run on `app/` (45 knip findings, 1 dead function, 2 real cycles, mutation scores 81.4 % and 66.4 %); Python and Rust tools not run; the eval set was removed; knip, jscpd and StrykerJS (in place) also gate BenchKeeper's own app, floors and baselines in `app/quality.json` |
| [Skill entry points, wrapper skills](evaluations/practices/skill-entry-points.md) | Six skills kept, no wrappers | no two entry points share a body; a wrapper needs a model-invoked block, which puts side-effect skills back in the model's reach. Skill-to-skill calls are documented for none of the four agents; nothing run in a session |

Not evaluated, offered by the app without evidence gathered: Gemini CLI and GitHub Copilot CLI support (untested), Docker Sandboxes (`--env sandbox`, untested), and the Codex permission profile for setup suggestions (its arguments are tested, its enforcement in a real Codex session is unverified).

Also checked, no evidence found (independent or vendor), no file: BMAD Method (qualitative session log only, [bmad_benchmarking](https://github.com/addi-katzav/bmad_benchmarking)), gstack, oh-my-claudecode, SuperClaude, compound-engineering, wshobson/agents (one judge-only test without baseline, [#632](https://github.com/wshobson/agents/issues/632)), Taskmaster AI, Anthropic feature-dev and code-review plugins, last30days-skill, Agent-Reach (credential and supply chain issues: [#412](https://github.com/Panniantong/Agent-Reach/issues/412), [#547](https://github.com/Panniantong/Agent-Reach/issues/547)).
