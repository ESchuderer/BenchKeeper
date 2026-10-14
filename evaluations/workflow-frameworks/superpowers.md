# Superpowers

[Repository](https://github.com/obra/superpowers), Category: workflow frameworks, Checked 2026-10-14, Decision: Not in yet (retest candidate, see [#19](https://github.com/ESchuderer/BenchKeeper/issues/19))

## Advertised

- v6 [release](https://github.com/obra/superpowers/releases/tag/v6.0.0): "roughly twice as fast", "almost 50% fewer tokens"; author evals, baseline not named.
- v6 [blog](https://blog.fsck.com/2026/06/15/Superpowers-6/): "up to 50% faster", "up to 60% cheaper"; baseline not named.
- v7 makes no token or time claim.

## Independent evidence

- [AgentStackBench](https://nobbettt.github.io/AgentStackBench/#/comparisons/codex-superpowers-mounted) (run 2026-05-20, before v6; Superpowers 5.0.5 in the repo, run version unverified; Codex, gpt-5.4 high, 500 SWE-bench family tasks, 1 run per arm, extra prompt to use Superpowers): resolved 45.6% vs 47.8%, no significance test; tokens 1.56M vs 2.18M per task (+40%), time 6m13s vs 7m26s (+20%).
- [skill-receipts](https://github.com/sjh9714/skill-receipts/blob/main/docs/audits/superpowers-debugging.md) (systematic-debugging only, Opus 4.8, 4 tasks x 5 runs): accuracy 20/20 both, cost +80%.
- One blogger, 6 tasks, 1 run: cost -9% ([mejba.me](https://www.mejba.me/blog/superpowers-plugin-claude-code-review)).
- One web-app task, 1 run per arm, author-judged: Superpowers about 250K tokens and 60 min, vanilla Claude Code about 200K and 20 min ([Chase AI](https://www.chaseai.io/blog/gsd-vs-superpowers-vs-claude-code); see [GSD](gsd.md)).

## Vendor evidence

- The maintainer's eval lab measures workflow compliance, not task outcomes ([superpowers-evals](https://github.com/prime-radiant-inc/superpowers-evals)).

## User reports

Split opinions; slowness and usage-limit reports.
- [HN, Superpowers 6](https://news.ycombinator.com/item?id=48739459): "token guzzler" and highest cost per PR of about 60 teams (anecdote) against praise for brainstorming and TDD.
- [#2017](https://github.com/obra/superpowers/issues/2017): "a modest feature takes an hour". [#1152](https://github.com/obra/superpowers/issues/1152): a 20-step plan used a Codex Plus 5 h budget. [#1194](https://github.com/obra/superpowers/issues/1194): 68M tokens for about 3k lines, 22M in planning.

Thread "Top Agent Skills Repositories" (r/claudeskills, about 2 months old, text supplied by the owner; URL not recorded). Opinions, no measurements.
- One user uninstalled it because "a simple ask is taking enormous amount of time".
- Another removed Superpowers and runs agent-skills plus the Karpathy guidelines.

## Decision

Not in yet: the only large test predates v6, whose release claims about 2x speed and about 50% fewer tokens (author evals, baseline not named); v7 makes no token or time claim. Retest v7 as an arm in [#19](https://github.com/ESchuderer/BenchKeeper/issues/19). Its spec, plan and implement loop overlaps agent-skills, so it would replace agent-skills rather than join it.

[All evaluations](../../EVALUATIONS.md)
