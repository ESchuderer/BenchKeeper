# agent-skills

[Repository](https://github.com/addyosmani/agent-skills), Category: skill libraries, Checked 2026-10-17, Decision: Out (setup-v3.0)

## Advertised

- The project's [evals](https://github.com/addyosmani/agent-skills/blob/main/evals/README.md) measure triggering and workflow compliance, not task outcomes.

## Independent evidence

- No task-level study.
- [Driftproof #005](https://driftproofhq.com/reports/005/) (single SKILL.md per call, 3 skills x 7 cases, 1 generation, LLM judge, no p-values): judge score -0.048 to +0.157 depending on skill and model, -5.4k to +16.3k input tokens per call. One gain re-measured at -0.002.
- [Driftproof 009](https://driftproofhq.com/reports/009/) (commit be4e44a, Opus 5 / Opus 5.5 / Sonnet 5.5, 1 case x 3 runs): Driftproof lift +0.134 / +0.562 / +0.291. Native `claude plugin eval` on the same cases 3/3 vs 3/3, 3/3 vs 2/3, 3/3 vs 1/3. In the docs case the skill never fired. [Driftproof 014](https://driftproofhq.com/reports/014/) (Haiku 5.5): lift clear in 1 of 3 runs.
- Contradiction: code-review +0.134 in Driftproof, no difference in the native eval on the same case.
- Router probe (sonnet-5, 79 prompts, 1 probe each): 77/79 routed with and without `using-agent-skills`, router +3.5k tokens per session ([#433](https://github.com/addyosmani/agent-skills/issues/433)).
- 0.6.13: about 2.8k tokens of descriptions, no hooks ([#574](https://github.com/addyosmani/agent-skills/pull/574) removed the SessionStart injection).
- [SkillsBench](https://arxiv.org/abs/2602.12670): curated skills +16.6 points pass rate on average. Focused skills (up to three modules) beat exhaustive bundles. See [studies](../studies.md).

## User reports

Thread "Top Agent Skills Repositories" (r/claudeskills, about 2 months old, text supplied by the owner, URL not recorded). Opinions, no measurements.
- One user moved from mattpocock/skills to agent-skills for team work ("more rigorous and covers more bases"), keeps Matt's for brainstorming, and cites agent-skills' evals (see Advertised).
- Another runs agent-skills fully plus the Karpathy guidelines, and only those Matt and Anthropic skills that agent-skills lacks (grill-me, handoff, prototype, teach, writing-for-agents), after removing Superpowers.

## Benchmark

Arms: F (agent-skills alone), I (with OpenSpec), L (with the BenchKeeper layer), C (with both). OpenCode arms: T, U, and Q (selected skills with OpenSpec). Recorded runs on Haiku 5.5 and Sonnet 5.5, one trial per arm and model, descriptive only: [winery-react](../../bench/results/2026-10-15-winery-react.md), [cartridges](../../bench/results/2026-10-16-cartridges.md). Arm definitions: [bench/SCENARIOS.md](../../bench/SCENARIOS.md).

## Skill authoring check

Rank 2 of 8, review 3.4, static checks 99% (0.6.13): the only collection with per-skill evaluations (results on Opus only). Conciseness 2: long bodies explain what Claude already knows. 24 links leave the skill folder. Details: [bench/results/2026-10-16-skill-authoring.md](../../bench/results/2026-10-16-skill-authoring.md).

## Decision

Out (setup-v3.0, 2026-10-17): replaced by [Matt Pocock's skills](mattpocock-skills.md), which cover the same phases (spec, TDD, debugging, review). One collection per phase keeps one owner per step. Own runs: on cartridges, agent-skills alone (F) ranked 7th of 29, below Matt Pocock's skills alone (V, 3rd). The setup BenchKeeper recommended until setup-v2.9 (BenchKeeper layer v1, agent-skills and OpenSpec, arm C) ranked 28th (its unit tests failed in the coverage run, cause unverified). Signals only: one trial per arm. `setup.sh` lists an old install under other plugins, with its removal command (`claude plugin uninstall agent-skills@addy-agent-skills`, Codex: `codex plugin remove agent-skills@agent-skills`).

[All evaluations](../../EVALUATIONS.md)
