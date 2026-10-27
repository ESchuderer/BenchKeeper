# Superpowers

[Repository](https://github.com/obra/superpowers), Category: workflow frameworks, Checked 2026-10-16, Decision: Not in yet (arm G in the recorded run, see Benchmark)

## Advertised

- v6 [release](https://github.com/obra/superpowers/releases/tag/v6.0.0): "roughly twice as fast", "almost 50% fewer tokens". Author evals, baseline not named.
- v6 [blog](https://blog.fsck.com/2026/06/15/Superpowers-6/): "up to 50% faster", "up to 60% cheaper". Baseline not named.
- v7 makes no token or time claim.
- The maintainer's eval lab measures workflow compliance, not task outcomes ([superpowers-evals](https://github.com/prime-radiant-inc/superpowers-evals)).

## Independent evidence

- [AgentStackBench](https://nobbettt.github.io/AgentStackBench/#/comparisons/codex-superpowers-mounted) (run 2026-05-20/21, before v6; Codex CLI 0.122.0, gpt-5.4 high, timeout 2700 s, 1 run per task; 500 tasks: SWE-bench Verified 174, Pro 54, PolyBench 116, Multi-SWE 156, ContextBench subset, 59 repositories), without vs with Superpowers: resolved 228 (45.6%) vs 239 (47.8%), exact McNemar p about 0.235 recomputed from the published `metrics.json` (30 tasks solved only without, 41 only with). Tokens per task 1.56M vs 2.18M (+40%, cached 1.44M vs 2.05M), time 6m13s vs 7m26s, commands 38.1 vs 46.1 per run, p<0.001 (paired permutation, recomputed). Retrieval file F1 0.506 vs 0.516. An earlier interim export of 135 tasks: 73.3% vs 74.1%.
  - Caveats: Superpowers 5.0.5 copied into skill directories, not installed as a plugin (hooks unknown). The with-arm prompt told the agent to use the Superpowers resources (confound). Author's write-up: `https://norbert-laszlo.medium.com/can-a-plugin-improve-codex-benchmarking-the-superpowers-plugin-05d020066565` (Medium blocks link checkers).
  - [Florian Gahn](https://florian-gahn.de/blog/superpowers-coding-agenten) (independent write-up) repeats these results and notes that provider-reported tokens are not billable tokens.
- [bartek-890/superpowers-evals](https://github.com/bartek-890/superpowers-evals/blob/main/docs/RESULTS.md) (`claude plugin eval`, Superpowers v6.4.2, Sonnet 5.5 agent and judge, 12 cases x 8 runs): cost 1.33x, turns about 1.5x. TDD bugfix +0.41 (95% CI +0.16 to +0.66), tdd-add +0.22, brainstorm +1.00 (asks questions, writes no code). Debug, verify and review 1.00 in both arms.
- [Driftproof 005, 007, 008](https://driftproofhq.com/reports/005/) (single SKILL.md per call, 7 cases, 1 generation, judge Haiku 4.5, no p-values), Sonnet 5 / Fable 5 / GPT-5.6-sol: writing-plans +0.176 / +0.177 / +0.062, re-measured on Fable 5 +0.131 +/- 0.157 (within noise). requesting-code-review +0.141 / +0.173 / +0.081, one case -0.644 on Sonnet 5.
- [Soarr01/skillbench](https://github.com/Soarr01/skillbench) (`claude -p`, skill injected into the system prompt, version not pinned, fetched 2026-06-28; 10 tasks x 5 runs): systematic-debugging cost +40.5% on Opus 4.8. Oracle checks unchanged (25/35 in every cell).
- [skill-receipts](https://github.com/sjh9714/skill-receipts/blob/main/docs/audits/superpowers-debugging.md) (systematic-debugging only, Opus 4.8, 4 tasks x 5 runs): accuracy 20/20 both, cost +80%.
- [skill-receipts audit #5](https://github.com/sjh9714/skill-receipts/blob/main/docs/audits/superpowers-debugging-620.md) (version comparison, v6.2.0 vs v6.1.1): cost -7.9% (CI -12.4 to +1.7), accuracy 20/20 both.
- One blogger, 6 tasks, 1 run: cost -9% ([mejba.me](https://www.mejba.me/blog/superpowers-plugin-claude-code-review)).
- One web-app task, 1 run per arm, author-judged: Superpowers about 250K tokens and 60 min, vanilla Claude Code about 200K and 20 min ([Chase AI](https://www.chaseai.io/blog/gsd-vs-superpowers-vs-claude-code), see [GSD](gsd.md)).

## User reports

Split opinions. Slowness and usage-limit reports.
- [HN, Superpowers 6](https://news.ycombinator.com/item?id=48739459): "token guzzler" and highest cost per PR of about 60 teams (anecdote) against praise for brainstorming and TDD.
- [#2017](https://github.com/obra/superpowers/issues/2017): "a modest feature takes an hour". [#1152](https://github.com/obra/superpowers/issues/1152): a 20-step plan used a Codex Plus 5 h budget. [#1194](https://github.com/obra/superpowers/issues/1194): 68M tokens for about 3k lines, 22M in planning.

Thread "Top Agent Skills Repositories" (r/claudeskills, about 2 months old, text supplied by the owner, URL not recorded). Opinions, no measurements.
- One user uninstalled it because "a simple ask is taking enormous amount of time".
- Another removed Superpowers and runs agent-skills plus the Karpathy guidelines.

## Benchmark

Arm: G (Superpowers alone). Brownfield run [mistreevous](https://github.com/ESchuderer/BenchKeeper-research/blob/main/bench/results/2026-10-18-mistreevous.md) on Sonnet 5.5, k = 3, descriptive only: median score 89.3 against 87.0 for plain Claude Code (A), inside the spread, at 0.94 times the cost and 0.89 times the time. It called its TDD skill in 8 of 9 steps. Arm definitions: [bench/SCENARIOS.md](https://github.com/ESchuderer/BenchKeeper-research/blob/main/bench/SCENARIOS.md).

## Skill authoring check

Rank 4 of 8, review 3.2, static checks 93% (7.0.0), workflows 5 (highest of the 8 collections), examples 5 (tied with Matt Pocock). Descriptions leave out the "what" by house rule. Two bodies over 500 lines. The brainstorming server loads a remote logo unless a telemetry variable is set. Details: [bench/results/2026-10-16-skill-authoring.md](../../bench/results/2026-10-16-skill-authoring.md).

## Decision

Not in yet: one measurement (AgentStackBench, Codex, 500 tasks) and four signals on Claude Code agree in direction: cost higher in every with/without test across agents and versions (Codex with 5.0.5: tokens +40%, Claude Code with v6.4.2: cost 1.33x, systematic-debugging on Opus 4.8: cost +40.5% and +80%), except one blogger's 6-task single run (-9%). Quality gains appear in the TDD cases of one plugin-eval suite and in judge scores. Pass rate on SWE-bench-family tasks is not significantly different (p about 0.235). Its spec, plan and implement loop overlaps agent-skills. BenchKeeper's own run: see Benchmark. Project setup offers it as a per-project workflow owner (setup-v6.7): a Claude Code plugin enabled for that project only, BenchKeeper's workflow skill giving way there. It is never preselected.

[All evaluations](../../EVALUATIONS.md)
