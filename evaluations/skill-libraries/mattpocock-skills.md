# mattpocock/skills

[Repository](https://github.com/mattpocock/skills), Category: skill libraries, Checked 2026-10-22, Decision: Optional pack (setup-v6.0)

## Advertised

- Shared language means fewer thinking tokens. Red-green gives "far better code" (no numbers).

## Independent evidence

- None controlled.
- v1.3.1: 37 SKILL.md files, 27 of them in the plugin manifest and listed by Claude Code, no hooks.

## User reports

- One issue asks whether `/implement` and `/tdd` cost more tokens (no numbers) ([#894](https://github.com/mattpocock/skills/issues/894)).
- A team with unpublished data attributes 37.6% of false greens (tests pass, behavior broken) across its skill sample to untested edge cases (unverified) ([#1074](https://github.com/mattpocock/skills/issues/1074)).

Thread "Top Agent Skills Repositories" (r/claudeskills, about 2 months old, text supplied by the owner, URL not recorded). Opinions, no measurements.
- One user moved to agent-skills for team work and keeps Matt's for brainstorming.
- Another uses only those Matt and Anthropic skills that agent-skills lacks (grill-me, handoff, prototype, teach, writing-for-agents).

## Benchmark

Arms: V (Matt Pocock's skills alone), W (with OpenSpec), X (with the BenchKeeper layer), Y (with both), AD and AE (with BenchKeeper layer v3, without and with OpenSpec). OpenCode arms: Z, AA. Recorded runs on Haiku 5.5 and Sonnet 5.5, one trial per arm and model, descriptive only: [winery-react](https://github.com/ESchuderer/BenchKeeper-Eval/blob/develop/bench/results/2026-10-15-winery-react.md), [cartridges](https://github.com/ESchuderer/BenchKeeper-Eval/blob/develop/bench/results/2026-10-16-cartridges.md). Arm definitions: [bench/SCENARIOS.md](https://github.com/ESchuderer/BenchKeeper-Eval/blob/develop/bench/SCENARIOS.md).

Brownfield run on Sonnet 5.5, Claude Code, k = 3 ([report](https://github.com/ESchuderer/BenchKeeper-Eval/tree/develop/bench/results)): median brownfield score V 82.9, AD 85.2, AE 82.9, against plain Claude Code (A) 85.7. No layer arm met the win rule (median at least 3 above the best of V, AB and A, ahead in 2 of 3 rounds). AD had the lowest median minutes (7.6 against 11.1 to 12.8) and cost. AE stopped after the OpenSpec proposal in one round.

## Skill authoring check

Rank 3 of 8, review 3.4, static checks 99% (1.3.1), conciseness 4, examples 5. `block-dangerous-git.sh` allows every command when `jq` is missing. Two names contain "claude". No evaluations. Details: [bench/results/2026-10-16-skill-authoring.md](https://github.com/ESchuderer/BenchKeeper-Eval/blob/develop/bench/results/2026-10-16-skill-authoring.md).

## Decision

Optional pack (setup-v6.0, 2026-10-22): the workflow skill runs without them and names them where they help when installed. Trace count over the 182 published trials: 52 Claude Code trials had them, 19 called any (`code-review` 21 times, `tdd` 11, `domain-modeling` once), 24 of 27 were never called, and no run separated them from plain Claude Code on quality (openballistics median 82.85 vs 85.69, mistreevous 87.22 vs 86.97). Issue #132 measures setup-v6.0 with and without them on Sonnet 5.5, opusplan and Opus 5.5.

Before, in (setup-v3.0, 2026-10-17): drives each phase of the workflow, with the BenchKeeper layer picking the tier and Ponytail `full`. Evidence, all signals (one brief per run, one trial or k = 3), no measurement:
- Cartridges, Sonnet 5.5, one trial per arm ([report](https://github.com/ESchuderer/BenchKeeper-Eval/blob/develop/bench/results/2026-10-16-cartridges.md)): Matt Pocock's skills alone (V) were the best Claude Code app, final score 84.0, rank 3 of 29. agent-skills alone (F) ranked 7th, plain Claude Code (A) 19th. With the BenchKeeper layer v1, Matt Pocock's skills (X) ranked 20th and agent-skills (L) 13th.
- Svelte site brownfield, k = 3 ([reports](https://github.com/ESchuderer/BenchKeeper-Eval/tree/develop/bench/results)): no setup separated on score (medians 82.9 to 85.7, spread within one arm up to 7 points). The BenchKeeper layer v3 with these skills (AD), the fastest arm that finished every step, was faster in every round than every round of A, OpenSpec alone and V (median 8 minutes against 11 to 13, rank test p of about 0.005 one-sided, unadjusted).
- Research ([studies](../studies.md)): focused skills with few modules beat large bundles (SkillsBench), and single coding skills rarely move pass rates. These skills are small and composable, and the user starts the long flows (`/to-spec`, `/to-tickets`, `/implement`) instead of the agent.
- Skill authoring check: rank 3 of 8, conciseness 4 (agent-skills: rank 2, conciseness 2).

Limits: no run shows higher quality than plain Claude Code. In the brownfield run, V, AD and AE left GitHub Actions unpinned in every round. The SkillsBench run (plain, these skills with Ponytail, the BenchKeeper layer with both) tests the quality question on 86 tasks.

[All evaluations](../../EVALUATIONS.md)
