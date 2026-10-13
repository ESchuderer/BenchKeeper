# Evaluations

Components considered for BenchKeeper, the independent evidence found, and the decision. Checked 2026-10-13. "Independent" means not run by the tool's own project.

## Removed

| Component | Advertised | Independent evidence | Decision |
|---|---|---|---|
| [RTK](https://github.com/rtk-ai/rtk) | 60 to 90% fewer tokens | [JetBrains](https://blog.jetbrains.com/ai/2026/07/rtk-claude-code-token-savings/) (rtk 0.43.0, Claude Code, Sonnet 5, 86 SkillsBench tasks): median cost +7.6% at low effort (p=0.004), +0.1% at high effort (p=0.99), quality unchanged. [Quesma](https://quesma.com/blog/does-rtk-make-ai-coding-cheaper/) (rtk 0.45.0, Terminal-Bench 2.1, 5 runs per task): total bill -5% on Claude Code with Fable 5.0, almost all from one task, +5% on OpenCode with DeepSeek; pass rate 84% vs 83% and 71% vs 69%. Releases 0.46 to 0.51 add filters and hook fixes, no new measurement. | Removed: no measured saving, small cost increase in some settings. [User reports](#rtk) |
| [codegraph](https://github.com/colbymchenry/codegraph) | 62% fewer tokens, 44% cheaper (README: 7 repositories, one question each, median of 4 runs, no quality measure) | None found. Research systems with a built-in code graph report gains ([LocAgent](https://arxiv.org/abs/2503.09089): +12% issue resolution at Pass@10; [RepoGraph](https://arxiv.org/abs/2410.14684)), but they change the agent itself; neither tests an add-on MCP tool. Add-on code tools are rarely called ([arXiv 2608.13568](https://arxiv.org/abs/2608.13568)). | Removed: no independent evidence. [User reports](#codegraph) |
| [Context7 MCP](https://github.com/upstash/context7) | current library docs, fewer outdated APIs | [Marginlab](https://marginlab.ai/blog/do-mcps-improve-coding-agents-part-1/) (Codex, GPT-5.4 xhigh, Terminal-Bench 2.0, 89 tasks, one run per arm): 64/89 passed with Context7, 63/89 without; called in 6 tasks, none of which changed outcome. | Removed: no measured benefit. [User reports](#context7) |
| LSP plugins (`pyright-lsp`, `typescript-lsp`) | semantic navigation, diagnostics | [arXiv 2608.13568](https://arxiv.org/abs/2608.13568) (preliminary, single author; Opus 4.8, Sonnet 4.6, Haiku 4.5): 6 to 118% more tokens for symbol localization; models chose grep for localization in most runs; location-only LSP missed call sites in about 3 of 4 multi-file renames. Diagnostics after edits not measured. | Removed: more tokens, no measured gain. [User reports](#lsp-plugins) |
| Project summary and layout in generated `AGENTS.md` | orientation for agents | [arXiv 2602.11988](https://arxiv.org/abs/2602.11988) (SWE-bench and 138 repository tasks, several agents and models): context files did not raise task success and raised cost by over 20%; repository overviews did not help; files help for non-standard practices. | `project-setup` writes commands, host and container rules, and non-default conventions only. |

## Not added

| Component | Evidence | Decision |
|---|---|---|
| [Pi](https://pi.dev) | No independent benchmark against Claude Code or Codex found. Claude subscription use outside Claude Code is not permitted by Anthropic's terms ([user reports](#pi)). Reads `AGENTS.md`, Agent Skills (`~/.agents/skills/`) and MCP ([configuration](https://pi.dev/docs/latest/configuration), [skills](https://pi.dev/docs/latest/skills)); Ponytail and agent-skills ship as Claude Code and Codex plugins. | Not added. [User reports](#pi) |
| [graphify](https://github.com/Graphify-Labs/graphify) | Own figure only (71.5x fewer tokens per query on a 52-file corpus of mostly papers and images). No independent evaluation found. | Not added. [User reports](#graphify) |

## Kept

| Component | Independent evidence | Decision |
|---|---|---|
| [Ponytail](https://github.com/DietrichGebert/ponytail) | [JetBrains](https://blog.jetbrains.com/ai/2026/07/ponytail-skill-claude-tested/) (v4.8.4, Claude Code, Sonnet 5 medium, 80 paired SkillsBench tasks): cost -10.3% (p=0.004), code about -15% (p=0.088), time -11%; 65 of 80 tasks identical score. Advertised: -54% code, -20% cost. Needs the SessionStart hook; the skill did not self-activate. | Kept. |
| [agent-skills](https://github.com/addyosmani/agent-skills) | None for this collection. [SkillsBench](https://arxiv.org/abs/2602.12670): curated skills +16.6 points pass rate on average; focused skills (up to three modules) beat exhaustive bundles. | Kept, unmeasured. |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec), [Spec Kit](https://github.com/github/spec-kit) | None with a no-spec baseline. [arXiv 2604.05278](https://arxiv.org/abs/2604.05278) tests Spec Kit plus the authors' own hooks: +0.15 on a 1 to 5 judge score (p<0.05). | Kept, unmeasured. |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | No paired cost or quality study. Token comparisons against the Playwright CLI conflict by version ([DEV](https://dev.to/aswani25/playwright-cli-vs-playwright-mcp-which-should-you-use-with-claude-code-1olh)). | Kept: used for UI verification, not cost. |

## User reports

Issue threads, forum posts and blogs, checked 2026-10-13. Mostly one repository and 1 to 4 runs per arm. Reddit could not be searched (access refused).

### RTK

Bill measurements are flat or higher; savings figures come from `rtk gain`, which counts command output, not the bill.
- [rtk#582](https://github.com/rtk-ai/rtk/issues/582): one debugging task, cost +18% and output tokens +50% with the hook. A maintainer's re-run in the thread: output tokens -7.5% (within noise), cost +6.62% in 10-minute sessions.
- [rtk#2012](https://github.com/rtk-ai/rtk/issues/2012) (LogDx-CI, 35 CI failure logs, 3 model families): diagnosis score about 0.25 to 0.47 with RTK variants vs about 0.63 to 0.67 with grep and tail or an LLM summary.
- [rtk#3175](https://github.com/rtk-ai/rtk/issues/3175): usage limits reached faster with the hook on (no metrics, one user reports the opposite).
- Problems: failures stripped from test output ([#2727](https://github.com/rtk-ai/rtk/issues/2727)), truncated git and grep output ([#1313](https://github.com/rtk-ai/rtk/issues/1313)), `rtk grep` not grep-compatible ([#1436](https://github.com/rtk-ai/rtk/issues/1436)), elided lines not recoverable ([#4098](https://github.com/rtk-ai/rtk/issues/4098)), `rtk gain` counts output the agent piped to `tail` ([#1973](https://github.com/rtk-ai/rtk/issues/1973)).

### codegraph

Mixed; savings depend on how much file discovery the task needs.
- [codegraph#975](https://github.com/colbymchenry/codegraph/issues/975): private repo, DeepSeek, 3 questions, more cost with codegraph in 2 of 3. A contributor's re-run in the thread (express, Sonnet, 2 questions x 2 runs): cost -22% (mean).
- [codegraph#1500](https://github.com/colbymchenry/codegraph/issues/1500): Go monorepo, Cursor, one question: about 20K more context tokens with codegraph, same answer. The owner reports the README control arm had called the codegraph CLI in 26 of 28 runs, then re-measured after fixing it.
- Problems: daemon out of memory ([#1553](https://github.com/colbymchenry/codegraph/issues/1553)), missed Python callers ([#899](https://github.com/colbymchenry/codegraph/issues/899)).

### graphify

No report measures a lower bill.
- [graphify#4341](https://github.com/Graphify-Labs/graphify/issues/4341) (177 SWE-bench Lite issues): right file first in 25% of queries vs 32% for BM25; in the top 5 in 38% vs 64%.
- [graphify#985](https://github.com/Graphify-Labs/graphify/issues/985): 1,484-file corpus, Claude Code alone gave similar answers with the same or fewer tokens; each query about 2K tokens.
- [graphify#580](https://github.com/Graphify-Labs/graphify/issues/580): more tokens with graphify because the agent reads the graph report first.

### Context7

Positive anecdotes without measurements ([HN](https://news.ycombinator.com/item?id=46490087): "can't be sure it is due to Context 7").
- Security: "ContextCrush", instructions planted in Context7 Custom Rules reached agents unfiltered; demo read and exfiltrated `.env` files; Upstash deployed a fix on 2026-02-23 ([Infosecurity Magazine](https://infosecurity-magazine.com/news/contextcrush-ai-development-tools)).

### LSP plugins

References and diagnostics help in some setups; agents rarely call LSP unless told to.
- [Scott Spence](https://scottspence.com/posts/revisiting-lsp-in-claude-code): 32 LSP calls in about 650 sessions, none `findReferences`. With a CLAUDE.md rule, refactors 3/3 vs 0/3. Grep 2 to 3 turns and $0.04 to $0.08 per reference question, LSP only 7 to 12 turns and $0.07 to $0.12. First `findReferences` call wrong in 18 of 19 fresh sessions until `useSyntaxServer` was set to `"never"`. Conclusion: keep LSP for diagnostics, use grep for references.
- [CircleCI](https://circleci.com/blog/claude-code-lsp/) (publishes an LSP plugin; vuejs/core, 3 symbols, CLAUDE.md rule to prefer LSP): cost -3% (Opus 4.8) and -14% (Sonnet 4.6); Sonnet with grep missed references (9/11, 249/260), LSP found all.
- Problems: "No LSP server available" ([claude-code#14803](https://github.com/anthropics/claude-code/issues/14803)), hint-level diagnostics injected into the conversation ([claude-code#26634](https://github.com/anthropics/claude-code/issues/26634)).

### Pi

Strong user enthusiasm, measured comparisons are vendor-run.
- [Composio](https://composio.dev/content/pi-agent-vs-claude-code) (vendor, supplied the MCP router used; DeepSeek V4 Flash, 30 tasks): Pi 20/30 at $0.56, Claude Code 16/30 at $3.12; reasoning settings differed.
- [HN thread](https://news.ycombinator.com/item?id=46844822): users switching from Claude Code and Codex; no sandbox by default ([comment](https://news.ycombinator.com/item?id=46845370)).
- Subscriptions: Pi offers `/login` with a Claude Pro/Max subscription, Sign in with ChatGPT, and GitHub Copilot ([pi-ai README](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)). Anthropic's terms limit Free, Pro and Max OAuth to Claude Code and Anthropic's own apps, do not permit third-party developers to route requests through those credentials, and reserve enforcement without notice ([Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)); reports describe tools blocked since January 2026 ([GIGAZINE](https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block)). Pi is a separate harness that sends its own requests to Anthropic's API; the terms permit a subscription only in the unmodified Claude Code binary. [pi-claude-code-auth](https://github.com/cgaravitoq/pi-claude-code-auth) warns of account suspensions with the same mechanism in OpenCode. Within the terms, Claude models in Pi need an API key.
- Pi users report the subscription failing or billing as extra usage:
  - [pi#1311](https://github.com/earendil-works/pi/issues/1311) (2026-02-06): `This credential is only authorized for use with Claude Code`.
  - [pi#2943](https://github.com/earendil-works/pi/issues/2943) (2026-04-08, Max plan): `You're out of extra usage`; other users confirm in the thread.
  - [pi#3012](https://github.com/earendil-works/pi/issues/3012) (2026-04-10): `Third-party apps now draw from your extra usage, not your plan limits`.
  - [pi#3401](https://github.com/earendil-works/pi/issues/3401): Pi shows a startup warning that subscription use draws from extra usage.
  - [pi#6888](https://github.com/earendil-works/pi/issues/6888) (2026-07-20) and [pi#9838](https://github.com/earendil-works/pi/issues/9838) (2026-09-21): requests with Pi's default system prompt are classified as third-party; a replaced prompt bills against the plan, a workaround outside the terms. OpenAI's terms for ChatGPT sign-in in Pi: unverified.

Related: [JetBrains Part 1, caveman skill](https://blog.jetbrains.com/ai/2026/07/speak-to-ai-agents-like-cavemen-tosave-tokens/) (advertised -65%, measured -8.5%); never part of BenchKeeper.
