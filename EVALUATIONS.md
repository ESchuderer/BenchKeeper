# Evaluations

Components considered for BenchKeeper, the independent evidence found, and the decision. Checked 2026-10-13. "Independent" means not run by the tool's own project.

## Removed

| Component | Advertised | Independent evidence | Decision |
|---|---|---|---|
| [RTK](https://github.com/rtk-ai/rtk) | 60 to 90% fewer tokens | [JetBrains](https://blog.jetbrains.com/ai/2026/07/rtk-claude-code-token-savings/) (rtk 0.43.0, Claude Code, Sonnet 5, 86 SkillsBench tasks): median cost +7.6% at low effort (p=0.004), +0.1% at high effort (p=0.99), quality unchanged. [Quesma](https://quesma.com/blog/does-rtk-make-ai-coding-cheaper/) (rtk 0.45.0, Terminal-Bench 2.1, 5 runs per task): total bill -5% on Claude Code with Fable 5.0, almost all from one task, +5% on OpenCode with DeepSeek; pass rate 84% vs 83% and 71% vs 69%. Releases 0.46 to 0.51 add filters and hook fixes, no new measurement. | Removed: no measured saving, small cost increase in some settings. |
| [codegraph](https://github.com/colbymchenry/codegraph) | 62% fewer tokens, 44% cheaper (README: 7 repositories, one question each, median of 4 runs, no quality measure) | None found. Research systems with a built-in code graph report gains ([LocAgent](https://arxiv.org/abs/2503.09089): +12% issue resolution at Pass@10; [RepoGraph](https://arxiv.org/abs/2410.14684)), but they change the agent itself; neither tests an add-on MCP tool. Add-on code tools are rarely called ([arXiv 2608.13568](https://arxiv.org/abs/2608.13568)). | Removed: no independent evidence. |
| [Context7 MCP](https://github.com/upstash/context7) | current library docs, fewer outdated APIs | [Marginlab](https://marginlab.ai/blog/do-mcps-improve-coding-agents-part-1/) (Codex, GPT-5.4 xhigh, Terminal-Bench 2.0, 89 tasks, one run per arm): 64/89 passed with Context7, 63/89 without; called in 6 tasks, none of which changed outcome. | Removed: no measured benefit. |
| LSP plugins (`pyright-lsp`, `typescript-lsp`) | semantic navigation, diagnostics | [arXiv 2608.13568](https://arxiv.org/abs/2608.13568) (preliminary, single author; Opus 4.8, Sonnet 4.6, Haiku 4.5): 6 to 118% more tokens for symbol localization; models chose grep for localization in most runs; location-only LSP missed call sites in about 3 of 4 multi-file renames. Diagnostics after edits not measured. | Removed: more tokens, no measured gain. |
| Project summary and layout in generated `AGENTS.md` | orientation for agents | [arXiv 2602.11988](https://arxiv.org/abs/2602.11988) (SWE-bench and 138 repository tasks, several agents and models): context files did not raise task success and raised cost by over 20%; repository overviews did not help; files help for non-standard practices. | `project-setup` writes commands, host and container rules, and non-default conventions only. |

## Not added

| Component | Evidence | Decision |
|---|---|---|
| [Pi](https://pi.dev) | No benchmark against Claude Code or Codex found. Reads `AGENTS.md`, Agent Skills (`~/.agents/skills/`) and MCP ([configuration](https://pi.dev/docs/latest/configuration), [skills](https://pi.dev/docs/latest/skills)); Ponytail and agent-skills ship as Claude Code and Codex plugins. | Not added. |
| [graphify](https://github.com/Graphify-Labs/graphify) | Own figure only (71.5x fewer tokens per query on a 52-file corpus of mostly papers and images). No independent evaluation found. | Not added. |

## Kept

| Component | Independent evidence | Decision |
|---|---|---|
| [Ponytail](https://github.com/DietrichGebert/ponytail) | [JetBrains](https://blog.jetbrains.com/ai/2026/07/ponytail-skill-claude-tested/) (v4.8.4, Claude Code, Sonnet 5 medium, 80 paired SkillsBench tasks): cost -10.3% (p=0.004), code about -15% (p=0.088), time -11%; 65 of 80 tasks identical score. Advertised: -54% code, -20% cost. Needs the SessionStart hook; the skill did not self-activate. | Kept. |
| [agent-skills](https://github.com/addyosmani/agent-skills) | None for this collection. [SkillsBench](https://arxiv.org/abs/2602.12670): curated skills +16.6 points pass rate on average; focused skills (up to three modules) beat exhaustive bundles. | Kept, unmeasured. |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec), [Spec Kit](https://github.com/github/spec-kit) | None with a no-spec baseline. [arXiv 2604.05278](https://arxiv.org/abs/2604.05278) tests Spec Kit plus the authors' own hooks: +0.15 on a 1 to 5 judge score (p<0.05). | Kept, unmeasured. |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | No paired cost or quality study. Token comparisons against the Playwright CLI conflict by version ([DEV](https://dev.to/aswani25/playwright-cli-vs-playwright-mcp-which-should-you-use-with-claude-code-1olh)). | Kept: used for UI verification, not cost. |

Related: [JetBrains Part 1, caveman skill](https://blog.jetbrains.com/ai/2026/07/speak-to-ai-agents-like-cavemen-tosave-tokens/) (advertised -65%, measured -8.5%); never part of BenchKeeper.
