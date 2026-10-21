# Studies and sources

Findings that apply to several components, sources to follow, A/B test tools, and sources that are not evidence. Checked 2026-10-14.

## Benchmark measurement corrections (2026-10-21)

[Protocol 1.23](../bench/PROTOCOL.md#external-benchmark-pilot-slopcodebench-v123) records natural prompts, source and image fingerprints, raw SCB counts and metrics, and exclusions for infrastructure failures. The current setup has a new AO arm. Older arm snapshots and scores remain unchanged, with AN's layer metadata corrected to v6. Reference calibration exposed a missing system MIME database in the scorer image, which returned an incorrect WebP header. The scorer now installs `media-types` for every solution. Its ast-grep rules had not run: `sg` resolved to Debian's group command, which scb-check skips without an error. The image now links ast-grep as `sg`. No model trials or comparative claims were added. Skill calls and explicit tier lines are trace evidence, not measures of instruction compliance.

## Cross-tool findings

- **Optional tools often go uncalled.** [JetBrains, IDE-native search](https://blog.jetbrains.com/ai/2026/05/what-happens-when-you-give-agents-ide-native-seach-tools/) (225 Java tasks, 3 runs, 2,700 trajectories; corrected after the first run had not called the tools): GPT-5.4-mini and GPT-5.5 made no IDE search calls in 675 trajectories each. GPT-5.6 used them and median cost rose about 6 to 7%. Not recommended as a default. [Vercel](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) (Next.js 16 APIs, agent and task count not stated, vendor of both arms): docs skill never invoked in 56% of cases, pass rate 53% (same as no docs), 79% with an explicit instruction to use it. Also Marginlab ([Context7](context-tools/context7.md), 6 of 89 tasks) and arXiv 2608.13568 ([LSP plugins](context-tools/lsp-plugins.md)).
- **Passive context beats on-demand lookup for missing knowledge.** Vercel: an 8 KB docs index in `AGENTS.md` passed 100%, against 53% without docs. [LangChain](https://www.langchain.com/blog/how-to-turn-claude-code-into-a-domain-specific-coding-agent) (Sonnet 4, 3 tasks x 3 runs, LLM judge, vendor of the docs MCP): CLAUDE.md beat a docs MCP. Both together scored highest. This does not contradict arXiv 2602.11988 ([AGENTS.md overviews](practices/agents-md-overviews.md)): Vercel and LangChain add knowledge the model lacks. The AGENTS.md study measured overviews of code the agent can read.
- **Single coding skills rarely move pass rate.** [SWE-Skills-Bench, arXiv 2603.15401](https://arxiv.org/abs/2603.15401) (49 skills): average +1.2%. A `tdd-workflow` skill (source unverified) on Claude Code with Haiku 4.5, 14 tasks: pass rate 21.4% to 28.6%, tokens +78.6%. Runs per arm not stated.
- **Focused skills beat large bundles.** [SkillsBench](https://arxiv.org/abs/2602.12670) (87 tasks, 18 model and harness configurations): curated skills raised pass rate from 33.9% to 50.5%. Skills with at most 3 modules beat exhaustive ones. Self-generated skills scored below no skills (Claude Code with Opus 4.7 -8.1 points, Codex with GPT-5.5 -11.3) while curated skills added 18.2 to 24.8 points on the same setups. Each task ships its own skills with domain procedure (steps, conventions, checks). It is a benchmark, not a skill collection to install.
- **The harness matters, not only the model.** [Kotlin Benchmark](https://blog.jetbrains.com/kotlin/2026/07/introducing-the-kotlin-benchmark-evaluate-ai-coding-agents-on-real-world-kotlin-tasks/) (105 tasks): Claude Code with Opus 4.7 xhigh 85.7%, Junie with Opus 4.7 max 81.9%, Codex with GPT-5.5 xhigh 81.9%. Effort settings differ. [JetBrains, recommended agent](https://blog.jetbrains.com/ai/2026/06/codex-is-now-the-recommended-agent-in-jetbrains-ai/) (353 tasks plus an online A/B test): Codex with GPT-5.4-mini 39.9%, Junie with Gemini 3 Flash 39.1%. Codex won the online test.
- **Process instructions alone do not raise quality.** [TDAD, arXiv 2603.17973](https://arxiv.org/abs/2603.17973) (SWE-bench Verified, 100 and 25 instances): TDD instructions alone raised regressions from 6.08% to 9.94%. Targeted test context lowered them to 1.82%. [arXiv 2609.20804](https://arxiv.org/abs/2609.20804) (4 open models, SWE-Bench Verified and Terminal-Bench 2.1, 1 run): a task-list planning scaffold added 11.6 points to the weakest model, 0 to -2.6 to stronger ones, mostly at lower cost.
- **Multi-agent pays for broad research, not sequential coding.** [arXiv 2512.08296](https://arxiv.org/abs/2512.08296) (v3, 260 configurations): -70.0% on sequential planning, +80.8% on decomposable financial reasoning. [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system) (vendor, internal eval): Opus 4 lead with Sonnet 4 subagents +90.2% over a single agent, about 15x chat tokens.
- **Model choice moves cost more than add-ons.** [skill-receipts pilot](https://github.com/sjh9714/skill-receipts/blob/main/docs/model-sensitivity-pilot.md) (no plugin): Opus 5 vs Opus 4.8 +49% cost, +78% wall time (small pilot).
- **Developer time.** [METR 2025](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/) (16 developers, 246 tasks): +19% time with AI allowed. [METR 2026 update](https://metr.org/blog/2026-02-24-uplift-update/) (57 developers, 800+ tasks): -18% and -4%, all intervals include 0.
- **Agent pull requests by change type.** [AIDev study, arXiv 2601.15195](https://arxiv.org/abs/2601.15195) (33,596 agent PRs, task labels by GPT-4.1-mini, Codex 21,799 of them): merged 71.48% overall. Docs 84%, CI 79%, build 74%, fix 64%, performance 55%. Rates differ by agent (CI 0.86 Codex vs 0.57 Claude Code, n=459 for Claude Code). [arXiv 2601.00477](https://arxiv.org/abs/2601.00477): security-related agent PRs (about 4%) merged at 61.50% vs 77.33%, median review latency 3.92 h vs 0.11 h. [arXiv 2509.14745](https://arxiv.org/abs/2509.14745) (567 Claude Code PRs): 83.8% merged, 54.9% of those without changes. [SWE-Perf, arXiv 2507.12415](https://arxiv.org/abs/2507.12415) (140 tasks): expert patches 10.85% runtime gain vs 2.26% for the best agent.
- **Process scaled to task size is common, unmeasured.** Claude Code best practices skip the plan when "you could describe the diff in one sentence" ([docs](https://code.claude.com/docs/en/best-practices)). Superpowers v7, GSD quick mode, BMAD and Kiro all have a light path ([GSD](https://github.com/open-gsd/gsd-core/blob/fdf66c2/docs/how-to/handle-quick-and-fast-tasks.md), [BMAD](https://github.com/bmad-code-org/BMAD-METHOD/blob/8f0d50e/docs/build/build-a-change.md), [Kiro](https://kiro.dev/docs/specs/quick-spec/)). Böckeler: a spec tool on a small bug was "like using a sledgehammer to crack a nut" ([martinfowler.com](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)). No study measures the effect of sizing.
- **How a component is injected changes the result.** Ponytail cost -10.3% with rules injected on SkillsBench (JetBrains), +0.7% with the installed plugin ([#685](https://github.com/DietrichGebert/ponytail/issues/685)), +10.7% through the system prompt ([skillbench](https://github.com/Soarr01/skillbench)), +53% as CLAUDE.md without the hook ([skill-receipts](https://github.com/sjh9714/skill-receipts/blob/main/docs/audits/ponytail.md), competitor-run). See [Ponytail](behavior-modes/ponytail.md). Driftproof's single-turn judge and the native plugin eval disagree on the same agent-skills case ([Driftproof 009](https://driftproofhq.com/reports/009/). See [agent-skills](skill-libraries/agent-skills.md)).

## Sources to follow

| Source | What it publishes |
|---|---|
| [JetBrains AI blog](https://blog.jetbrains.com/ai/) | Paired A/B tests of add-ons on SkillsBench (caveman, RTK, Ponytail, IDE search), with p-values |
| [SkillsBench](https://arxiv.org/abs/2602.12670) | Benchmark and paper on whether skills help. The task set JetBrains uses |
| [Marginlab](https://marginlab.ai/blog) | MCP on and off tests ("Do MCPs Improve Coding Agents?", Part 1: Context7). [Claude Code tracker](https://marginlab.ai/trackers/claude-code), daily SWE-Bench-Pro runs of the stock CLI (unverified) |
| [Quesma](https://quesma.com/blog/) | Cost benchmarks of agent add-ons on Terminal-Bench (RTK) |
| [Terminal-Bench](https://www.tbench.ai/leaderboard) | Leaderboard with model and agent listed separately, for harness comparisons |
| [Kotlin Benchmark](https://kotlinlang.org/benchmark) | Agent leaderboard on 105 Kotlin tasks |

## Tools for configuration A/B tests

| Tool | What it compares | Agents | Statistics | URL |
|---|---|---|---|---|
| Harbor | Skills and MCP arms. No plugin install | claude_code, codex | Mean only. `-k` attempts | [harbor](https://github.com/harbor-framework/harbor) |
| SkillsBench | 87 tasks with and without skills (with-skill mode) | Several harnesses | Paired | [skillsbench](https://github.com/benchflow-ai/skillsbench) |
| ContextBench | 1,136 tasks, context retrieval metrics. AgentStackBench builds on it | Not checked | Not checked | [arXiv 2602.05892](https://arxiv.org/abs/2602.05892) |
| AgentStackBench | Skills, MCP, plugins. One published comparison, the other dashboard cards are placeholder data | Claude Code, Codex (subscription auth) | Dashboard computes McNemar and permutation tests. No multiple-comparison correction | [AgentStackBench](https://github.com/Nobbettt/AgentStackBench) |
| skill-receipts | Off, placebo and on arms. Hidden tests | Claude Code | At least 5 runs per arm | [skill-receipts](https://github.com/sjh9714/skill-receipts) |
| Driftproof | Single SKILL.md per call | Single-turn model calls | Judge model. Range overlap | [driftproofhq.com](https://driftproofhq.com) |
| harness-abc-bench | Pre-registered framework arms. No results | Claude Code | Blind panel | [harness-abc-bench](https://github.com/tonydzi/harness-abc-bench) |
| claude plugin eval | With minus without delta. Loads no CLAUDE.md (Anthropic) | Claude Code only | 3 runs per arm by default. No significance test | [docs](https://code.claude.com/docs/en/plugin-evals) |
| Inspect AI with inspect_swe | Skills, MCP, system prompt | claude_code, codex_cli, opencode | Not checked | [inspect_swe](https://meridianlabs-ai.github.io/inspect_swe/claude_code.html) |
| Vercel agent-eval | Agent eval runner | Not checked | Not checked | [agent-eval](https://github.com/vercel-labs/agent-eval) |
| LangChain skills-benchmarks | Skills benchmarks | Not checked | Not checked | [skills-benchmarks](https://github.com/langchain-ai/skills-benchmarks) |
| promptfoo | Coding agent evaluation guide | Not checked | Not checked | [promptfoo](https://promptfoo.dev/docs/guides/evaluate-coding-agents/) |

SWE-bench, Aider polyglot, tau-bench and BFCL rank models. Harbor has adapters to run their tasks with agent arms.

## Not sources of evidence

### The Agentic Leaderboard

[The Agentic Leaderboard](https://www.theagenticleaderboard.com/methodology) ranks agents by proxies (README, CI, stars), "not direct runtime measurements". Every Top 100 entry shows 500 ms latency. obra/superpowers is absent. Not a source of evidence.

### The Skill Leaderboard

[The Skill Leaderboard](https://www.skillleaderboard.com/methodology) ranks skill repositories by GitHub stars, momentum and a traction score. No outcome measurement. ECC is not listed: the curator places it between a skill collection and a broader harness framework and is open to reconsidering (curator's comment in the r/claudeskills thread "Top Agent Skills Repositories"; text supplied by the owner, URL not recorded, Reddit cannot be fetched here, see [ECC](harness-bundles/ecc.md)).

The curator's general advice in the same thread: Claude Code loads a skill's full instructions only when used. Start with a handful, check for overlapping skills, add one when you can name a gap.

### jeffscottward's harness analysis

[jeffscottward's harness analysis](https://gist.github.com/jeffscottward/de77a769d9e25a8ccdc92b65291b1c34) (2026-02-22, generated by Claude Opus 4.6 agents reading the code of Superpowers, ECC, Agent Orchestrator and Maestro): feature comparison with file citations, no runs or outcome measurements. ECC had 44 skills then. Consensus across the four: plan before execute, git worktree isolation, TDD first, handoff documents. Quality gates are advisory in Superpowers and ECC.

[All evaluations](../EVALUATIONS.md)
