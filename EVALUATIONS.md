# Evaluations

Components considered for BenchKeeper, the evidence found for each, and whether each is in BenchKeeper. One file per component under `evaluations/<category>/`. Checked 2026-10-14. "Independent" means not run by the tool's own project.

## Process

- Sources searched first: [JetBrains AI blog](https://blog.jetbrains.com/ai/), [Marginlab](https://marginlab.ai/blog), [Quesma](https://quesma.com/blog/), [SkillsBench](https://arxiv.org/abs/2602.12670), arXiv.
- Then GitHub issues, Hacker News, forum posts and blogs (user reports checked 2026-10-13; mostly one repository and 1 to 4 runs per arm). Reddit cannot be fetched (access refused); thread text supplied by the owner is labeled as such.
- Evidence bar: independent and vendor-run results are kept apart. Each result records version, harness, model and effort, task count, runs per arm, deltas and p-values where given. Advertised figures stand next to measured ones; claims not checked are labeled unverified.
- Decision values: In; In, unmeasured; Not in yet (retest candidate, see [#19](https://github.com/ESchuderer/BenchKeeper/issues/19)); Not in; Not global, per project.
- A file is updated when its component is added, removed or changed, or when new evidence appears; the overview below is updated with it.

## Overview

### Behavior modes

| Component | Decision | Summary |
|---|---|---|
| [Ponytail](evaluations/behavior-modes/ponytail.md) | In | cost -10.3% (p=0.004), JetBrains, v4.8.4; needs the SessionStart hook |
| [caveman](evaluations/behavior-modes/caveman.md) | Not in, never part of BenchKeeper | advertised -65%, measured -8.5% output tokens, score p=0.82, JetBrains |

### Skill libraries

| Component | Decision | Summary |
|---|---|---|
| [agent-skills](evaluations/skill-libraries/agent-skills.md) | In, unmeasured | no task-level study; about 2.8k tokens of descriptions, no hooks (0.6.13) |
| [mattpocock/skills](evaluations/skill-libraries/mattpocock-skills.md) | Not in | no controlled evidence; overlaps agent-skills |
| [andrej-karpathy-skills](evaluations/skill-libraries/andrej-karpathy-skills.md) | Not in | accuracy 60/60 every arm, median cost +11.5%, skill-receipts |
| [Anthropic document skills](evaluations/skill-libraries/anthropic-document-skills.md) | Not global, per project | DocOps: Claude Code Sonnet 4.6 0.519 with skills vs 0.552 without |
| [scientific-agent-skills](evaluations/skill-libraries/scientific-agent-skills.md) | Not global, per project | vendor paper, no task-level evaluation; `project-setup` vets single skills |

### Workflow frameworks

| Component | Decision | Summary |
|---|---|---|
| [Superpowers](evaluations/workflow-frameworks/superpowers.md) | Not in yet (retest candidate, see #19) | pre-v6: resolved 45.6% vs 47.8%, tokens +40%, AgentStackBench |
| [OpenSpec](evaluations/workflow-frameworks/openspec.md) | In, unmeasured | no study with a no-spec baseline; owns spec files per change |
| [Spec Kit](evaluations/workflow-frameworks/spec-kit.md) | Not in | +0.15 judge score (p<0.05), no agent-skills baseline; overlaps agent-skills |
| [GSD](evaluations/workflow-frameworks/gsd.md) | Not in | one task: about 1.2M tokens vs 200K vanilla, outputs indistinguishable |
| [planning-with-files](evaluations/workflow-frameworks/planning-with-files.md) | Not in | vendor only; every arm passed 77/77; overlaps OpenSpec `tasks.md` |

### Harness bundles

| Component | Decision | Summary |
|---|---|---|
| [ECC](evaluations/harness-bundles/ecc.md) | Not in yet (retest candidate, see #19) | no outcome measurement; hook overhead and listing size reported |
| [ruflo](evaluations/harness-bundles/ruflo.md) | Not in | no evidence; no method published for advertised figures |

### Agent harnesses

| Component | Decision | Summary |
|---|---|---|
| [Pi](evaluations/agent-harnesses/pi.md) | Not in | no independent benchmark; Claude subscription use outside Anthropic's terms |

### Context tools

| Component | Decision | Summary |
|---|---|---|
| [RTK](evaluations/context-tools/rtk.md) | Not in | median cost +7.6% at low effort (p=0.004), JetBrains, rtk 0.43.0 |
| [codegraph](evaluations/context-tools/codegraph.md) | Not in | no independent evidence; user reports mixed |
| [graphify](evaluations/context-tools/graphify.md) | Not in | no independent evidence; user report: right file first 25% vs 32% BM25 |
| [Context7 MCP](evaluations/context-tools/context7.md) | Not in | 64/89 vs 63/89 passed, called in 6 tasks, Marginlab |
| [LSP plugins](evaluations/context-tools/lsp-plugins.md) | Not in | 6 to 118% more tokens for symbol localization, arXiv 2608.13568 |
| [Serena MCP](evaluations/context-tools/serena.md) | Not in | quality 83.4% vs 84.2% without, competitor-run |
| [headroom](evaluations/context-tools/headroom.md) | Not in | input tokens +6%, cost +44%, competitor-run, SWE-bench Verified 100 |
| [claude-mem](evaluations/context-tools/claude-mem.md) | Not in | none found; one user reports +63.9% API spend |

### Verification

| Component | Decision | Summary |
|---|---|---|
| [Playwright MCP](evaluations/verification/playwright-mcp.md) | In | no paired cost or quality study; used for UI verification |

### Practices

| Component | Decision | Summary |
|---|---|---|
| [Project summary and layout in AGENTS.md](evaluations/practices/agents-md-overviews.md) | Not in | context files raised cost over 20%, no success gain, arXiv 2602.11988 |

Also checked, no evidence found (independent or vendor), no file: BMAD Method, gstack, oh-my-claudecode, SuperClaude, compound-engineering, wshobson/agents (one judge-only test without baseline, [#632](https://github.com/wshobson/agents/issues/632)), Taskmaster AI, Anthropic feature-dev and code-review plugins, last30days-skill, Agent-Reach (credential and supply chain issues: [#412](https://github.com/Panniantong/Agent-Reach/issues/412), [#547](https://github.com/Panniantong/Agent-Reach/issues/547)).

Cross-tool findings: [evaluations/studies.md](evaluations/studies.md). Sources to follow and leaderboards: [evaluations/sources.md](evaluations/sources.md).
