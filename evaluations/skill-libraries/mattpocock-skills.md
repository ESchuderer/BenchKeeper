# mattpocock/skills

[Repository](https://github.com/mattpocock/skills), Category: skill libraries, Checked 2026-10-16, Decision: Not in

## Advertised

- Shared language means fewer thinking tokens; red-green gives "far better code" (no numbers).

## Independent evidence

- None controlled.
- v1.3.1: 27 shipped skills, no hooks.

## User reports

- One issue asks whether `/implement` and `/tdd` cost more tokens (no numbers) ([#894](https://github.com/mattpocock/skills/issues/894)).
- A team with unpublished data attributes 37.6% of false greens (tests pass, behavior broken) across its skill sample to untested edge cases (unverified) ([#1074](https://github.com/mattpocock/skills/issues/1074)).

Thread "Top Agent Skills Repositories" (r/claudeskills, about 2 months old, text supplied by the owner; URL not recorded). Opinions, no measurements.
- One user moved to agent-skills for team work and keeps Matt's for brainstorming.
- Another uses only those Matt and Anthropic skills that agent-skills lacks (grill-me, handoff, prototype, teach, writing-for-agents).

## Skill authoring check

Rank 3 of 8, review 3.4, static checks 99% (1.3.1): short bodies, strong examples; `block-dangerous-git.sh` allows every command when `jq` is missing; two names contain "claude"; no evaluations. Details: [bench/results/2026-10-16-skill-authoring.md](../../bench/results/2026-10-16-skill-authoring.md) (#58).

## Decision

Not in: overlaps agent-skills (tdd, code-review, to-spec, to-tickets, diagnosing-bugs, grill-me); no evidence either way.

[All evaluations](../../EVALUATIONS.md)
