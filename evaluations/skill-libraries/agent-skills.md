# agent-skills

[Repository](https://github.com/addyosmani/agent-skills), Category: skill libraries, Checked 2026-10-14, Decision: In, unmeasured

## Independent evidence

- No task-level study.
- [Driftproof #005](https://driftproofhq.com/reports/005/) (single SKILL.md per call, 3 skills x 7 cases, 1 generation, LLM judge, no p-values): judge score -0.048 to +0.157 depending on skill and model, -5.4k to +16.3k input tokens per call; one gain re-measured at -0.002.
- [Driftproof 009](https://driftproofhq.com/reports/009/) (commit be4e44a; Opus 5 / Opus 5.5 / Sonnet 5.5, 1 case x 3 runs): Driftproof lift +0.134 / +0.562 / +0.291; native `claude plugin eval` on the same cases 3/3 vs 3/3, 3/3 vs 2/3, 3/3 vs 1/3; in the docs case the skill never fired. [Driftproof 014](https://driftproofhq.com/reports/014/) (Haiku 5.5): lift clear in 1 of 3 runs.
- Contradiction: code-review +0.134 in Driftproof, no difference in the native eval on the same case.
- Router probe (sonnet-5, 79 prompts, 1 probe each): 77/79 routed with and without `using-agent-skills`, router +3.5k tokens per session ([#433](https://github.com/addyosmani/agent-skills/issues/433)).
- 0.6.13: about 2.8k tokens of descriptions, no hooks ([#574](https://github.com/addyosmani/agent-skills/pull/574) removed the SessionStart injection).
- [SkillsBench](https://arxiv.org/abs/2602.12670): curated skills +16.6 points pass rate on average; focused skills (up to three modules) beat exhaustive bundles. See [studies](../studies.md).

## Vendor evidence

- The project's [evals](https://github.com/addyosmani/agent-skills/blob/main/evals/README.md) measure triggering and workflow compliance, not task outcomes.

## User reports

Thread "Top Agent Skills Repositories" (r/claudeskills, about 2 months old, text supplied by the owner; URL not recorded). Opinions, no measurements.
- One user moved from mattpocock/skills to agent-skills for team work ("more rigorous and covers more bases"), keeps Matt's for brainstorming, and cites agent-skills' evals (see Vendor evidence).
- Another runs agent-skills fully plus the Karpathy guidelines, and only those Matt and Anthropic skills that agent-skills lacks (grill-me, handoff, prototype, teach, writing-for-agents), after removing Superpowers.

## Skill authoring check

Rank 2 of 8, review 3.4, static checks 99% (0.6.13): the only collection with per-skill evaluations (results on Opus only); long bodies teach what Claude knows; 24 links leave the skill folder. Details: [bench/results/2026-10-16-skill-authoring.md](../../bench/results/2026-10-16-skill-authoring.md) (#58).

## Decision

In, unmeasured. The global rules load skills by description, not through `using-agent-skills`.

[All evaluations](../../EVALUATIONS.md)
