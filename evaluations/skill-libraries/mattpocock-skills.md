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

Arms: V (Matt Pocock's skills alone), AF (with Ponytail), AL and AM (BenchKeeper setup-v4.0 and setup-v5.0 with them), AN (AL without Ponytail). Arm definitions: [bench/SCENARIOS.md](https://github.com/ESchuderer/BenchKeeper-research/blob/main/bench/SCENARIOS.md).

Brownfield run on Sonnet 5.5, Claude Code, k = 3 ([mistreevous](https://github.com/ESchuderer/BenchKeeper-research/blob/main/bench/results/2026-10-18-mistreevous.md)): median brownfield score V 87.2, AF 84.6, AL 84.1, AM 89.0, AN 87.6, against plain Claude Code (A) 87.0. No arm with these skills met the win rule (median at least 3 above A, ahead in 2 of 3 rounds). AF and AL were among the fastest and cheapest (0.56 and 0.58 times the time of A, 0.53 and 0.61 times the cost).

## Skill authoring check

Rank 3 of 8, review 3.4, static checks 99% (1.3.1), conciseness 4, examples 5. `block-dangerous-git.sh` allows every command when `jq` is missing. Two names contain "claude". No evaluations. Details: [bench/results/2026-10-16-skill-authoring.md](../../bench/results/2026-10-16-skill-authoring.md).

## Decision

Optional pack (setup-v6.0, 2026-10-22): the workflow skill runs without them and names them where they help when installed. Trace count over the 42 published trials: 18 Claude Code trials had them, 9 called any (`code-review` 12 times, `tdd` 4), 25 of 27 were never called, and the run did not separate them from plain Claude Code on quality (mistreevous median 87.22 vs 86.97). Issue #132 measures setup-v6.0 with and without them on Sonnet 5.5, opusplan and Opus 5.5.

Before, in (setup-v3.0, 2026-10-17): drives each phase of the workflow, with the BenchKeeper layer picking the tier and Ponytail `full`. Evidence, all signals (one brief per run, one trial or k = 3), no measurement:
- Mistreevous brownfield, k = 3 ([report](https://github.com/ESchuderer/BenchKeeper-research/blob/main/bench/results/2026-10-18-mistreevous.md)): no setup separated on score except ECC (medians 84.1 to 90.1, spread within one arm up to 8 points). Matt Pocock's skills alone (V) 87.2 against plain Claude Code 87.0. With Ponytail (AF) and with the BenchKeeper setup-v4.0 (AL) they were among the fastest and cheapest arms (0.56 and 0.58 times the time of A).
- Research ([studies](../studies.md)): focused skills with few modules beat large bundles (SkillsBench), and single coding skills rarely move pass rates. These skills are small and composable, and the user starts the long flows (`/to-spec`, `/to-tickets`, `/implement`) instead of the agent.
- Skill authoring check: rank 3 of 8, conciseness 4 (agent-skills: rank 2, conciseness 2).

Limits: no run shows higher quality than plain Claude Code. The SkillsBench run (plain, these skills with Ponytail, the BenchKeeper layer with both) tests the quality question on 86 tasks.

[All evaluations](../../EVALUATIONS.md)
