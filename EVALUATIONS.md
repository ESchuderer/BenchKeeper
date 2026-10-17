# Evaluations

Components considered for BenchKeeper, the evidence for each, and whether each is in BenchKeeper. One file per component under `evaluations/<category>/`, sections in this order: Advertised, Independent evidence, User reports, Benchmark (BenchKeeper's own runs, where the component ran as an arm), Skill authoring check, Decision. Cross-tool findings, sources to follow and A/B test tools: [evaluations/studies.md](evaluations/studies.md). Checked 2026-10-14 to 2026-10-16 (each file names its date).

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
| [BenchKeeper layer](bench/SCENARIOS.md) | the setup itself | arms L, M, N, X, C, D, E, Y (layer v1, one trial per arm and model) and AD, AE (layer v3, not run yet): [winery-react](bench/results/2026-10-15-winery-react.md), [cartridges](bench/results/2026-10-16-cartridges.md) |

### Behavior modes

| Component | Decision | Summary |
|---|---|---|
| [Ponytail](evaluations/behavior-modes/ponytail.md) | In, evidence mixed (arm B, k=1) | lines down in every source that measured them, cost -10.3% (JetBrains) to +55% elsewhere, lower in all 6 winery-react pairs (k=1) |
| [caveman](evaluations/behavior-modes/caveman.md) | Not in, never part of BenchKeeper | advertised -65%, measured -8.5% output tokens, score p=0.82 (JetBrains). Cost not reduced in 3 sources |

### Skill libraries

| Component | Decision | Summary |
|---|---|---|
| [agent-skills](evaluations/skill-libraries/agent-skills.md) | In, unmeasured | no task-level study. About 2.8k tokens of descriptions, no hooks (0.6.13) |
| [mattpocock/skills](evaluations/skill-libraries/mattpocock-skills.md) | Not in | own brownfield run, k = 3 (a signal): median 82.9 alone, 85.2 with the BenchKeeper layer, plain Claude Code 85.7. Overlaps agent-skills |
| [andrej-karpathy-skills](evaluations/skill-libraries/andrej-karpathy-skills.md) | Not in | accuracy 60/60 in every arm. Cost +11.5% (skill-receipts), +6.6% (skillbench) |
| [Anthropic document skills](evaluations/skill-libraries/anthropic-document-skills.md) | Not global, per project | DocOps: Claude Code Sonnet 4.6 0.519 with skills vs 0.552 without |
| [scientific-agent-skills](evaluations/skill-libraries/scientific-agent-skills.md) | Not global, per project | vendor paper, no task-level evaluation. `setting-up-projects` vets single skills |

### Workflow frameworks

| Component | Decision | Summary |
|---|---|---|
| [Superpowers](evaluations/workflow-frameworks/superpowers.md) | Not in yet (arms G, J, M, D, k=1) | cost higher in every test but one 6-task run (1.33x on v6.4.2). Pass rate n.s. (p about 0.235) |
| [OpenSpec](evaluations/workflow-frameworks/openspec.md) | In, unmeasured | own brownfield run, k = 3 (a signal): median 85.7, tied with plain Claude Code. Owns spec files per change |
| [Spec Kit](evaluations/workflow-frameworks/spec-kit.md) | Not in | +0.15 judge score (p<0.05), no agent-skills baseline. Overlaps agent-skills |
| [GSD](evaluations/workflow-frameworks/gsd.md) | Not in | one task: about 1.2M tokens vs 200K vanilla, outputs indistinguishable |
| [planning-with-files](evaluations/workflow-frameworks/planning-with-files.md) | Not in | vendor only. Every arm passed 77/77. Overlaps OpenSpec `tasks.md` |

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
| [Skill authoring guide (Anthropic)](evaluations/practices/skill-authoring.md) | In | 8 benchmarked collections ranked: Ponytail 3.9 first, Spec Kit 2.8 last. Only agent-skills ships evaluations |
| [Project summary and layout in AGENTS.md](evaluations/practices/agents-md-overviews.md) | Not in | context files raised cost over 20%, no success gain, arXiv 2602.11988 |

Also checked, no evidence found (independent or vendor), no file: BMAD Method (qualitative session log only, [bmad_benchmarking](https://github.com/addi-katzav/bmad_benchmarking)), gstack, oh-my-claudecode, SuperClaude, compound-engineering, wshobson/agents (one judge-only test without baseline, [#632](https://github.com/wshobson/agents/issues/632)), Taskmaster AI, Anthropic feature-dev and code-review plugins, last30days-skill, Agent-Reach (credential and supply chain issues: [#412](https://github.com/Panniantong/Agent-Reach/issues/412), [#547](https://github.com/Panniantong/Agent-Reach/issues/547)).
