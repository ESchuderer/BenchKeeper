# mattpocock/skills

[Repository](https://github.com/mattpocock/skills), Category: skill libraries, Checked 2026-10-16, Decision: Not in

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

Arms: V (Matt Pocock's skills alone), W (with OpenSpec), X (with the BenchKeeper layer), Y (with both), AD and AE (with BenchKeeper layer v3, without and with OpenSpec, not run yet). OpenCode arms: Z, AA. Recorded runs on Haiku 5.5 and Sonnet 5.5, one trial per arm and model, descriptive only: [winery-react](../../bench/results/2026-10-15-winery-react.md), [cartridges](../../bench/results/2026-10-16-cartridges.md). Arm definitions: [bench/SCENARIOS.md](../../bench/SCENARIOS.md).

## Skill authoring check

Rank 3 of 8, review 3.4, static checks 99% (1.3.1), conciseness 4, examples 5. `block-dangerous-git.sh` allows every command when `jq` is missing. Two names contain "claude". No evaluations. Details: [bench/results/2026-10-16-skill-authoring.md](../../bench/results/2026-10-16-skill-authoring.md) (#58).

## Decision

Not in: overlaps agent-skills (tdd, code-review, to-spec, to-tickets, diagnosing-bugs, grill-me). No evidence either way.

[All evaluations](../../EVALUATIONS.md)
