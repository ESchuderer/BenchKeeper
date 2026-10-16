# ECC (formerly everything-claude-code)

[Repository](https://github.com/affaan-m/ECC), Category: harness bundles, Checked 2026-10-16, Decision: Not in yet (arms H, K, N, E with the minimal profile in the recorded runs, see Benchmark)

## Advertised

- "agent harness performance optimization system". No outcome numbers.

## Independent evidence

- None for the bundle.
- One third party, two packs ported to another platform, 6 paired tasks (`tdd-workflow`) and 3 (`security-reviewer`), runs not stated: `tdd-workflow` quality +0.20 (scale not given), +21 s and +74k tokens per task. `security-reviewer` 0.00 ([discussion #2504](https://github.com/affaan-m/ECC/discussions/2504#discussioncomment-17852942)).
- v2.2.3 static count: 293 skills, 94 commands, 68 agents, about 124 KB of descriptions. 3 node processes per tool call, synchronous typecheck on Stop.
- v2.2.3: `minimal` has 47 workflow-quality skills (`manifests/install-modules.json`), 68 agents, 94 commands, no hooks (`manifests/install-profiles.json`). The installed arm image has 48 SKILL.md files: the 47 and `unified-memory`.
- A code-reading analysis from 2026-02-22 counted 44 skills (see [studies and sources](../studies.md#not-sources-of-evidence)).

## User reports

Overhead reports, no outcome measurements.
- [#2834](https://github.com/affaan-m/ECC/issues/2834) (v1.9.0, mean of 3 runs): synchronous hooks about 1,610 ms per Bash call, 856 ms from `npx block-no-verify`.
- [#2694](https://github.com/affaan-m/ECC/issues/2694): 773 skills, about 42,500 tokens of descriptions, about 4x the skill listing budget. Other plugins' listings are truncated.
- [#735](https://github.com/affaan-m/ECC/issues/735): per-edit hooks with 15 and 30 s timeouts. About 7.5 min over a 10-file refactor (estimate).
- [#3461](https://github.com/affaan-m/ECC/issues/3461): session-end `claude -p` summary killed after 30 s, 45 kills and 2 completions. The child keeps running and is billed (Windows). [#398](https://github.com/affaan-m/ECC/issues/398): observer hooks start Haiku loops.
- [#2278](https://github.com/affaan-m/ECC/issues/2278): orphaned python process at about 98% CPU for 4 days.

Thread "Top Agent Skills Repositories" (r/claudeskills, about 2 months old, text supplied by the owner, URL not recorded). Opinions, no measurements.
- One user: "very very large and hard to digest".
- The Skill Leaderboard curator: ECC is not listed there. The curator places it between a skill collection and a broader harness framework and is open to reconsidering (see [studies and sources](../studies.md#not-sources-of-evidence)).

## Benchmark

Arms: H (ECC `minimal` alone), K (with OpenSpec), N (with the BenchKeeper layer), E (with both). No OpenCode arm. Recorded runs on Haiku 5.5 and Sonnet 5.5, one trial per arm and model, descriptive only: [winery-react](../../bench/results/2026-10-15-winery-react.md), [cartridges](../../bench/results/2026-10-16-cartridges.md). Arm definitions: [bench/SCENARIOS.md](../../bench/SCENARIOS.md).

## Skill authoring check

Rank 7 of 8, review 2.9, static checks 98% (2.2.3, minimal profile): broken script paths, hardcoded `~/.claude/skills` in a project-scoped install, references to 13 skills that are not installed, three bodies over 500 lines. Details: [bench/results/2026-10-16-skill-authoring.md](../../bench/results/2026-10-16-skill-authoring.md).

## Decision

Not in yet: no outcome measurement in either direction. Measured overhead from hooks and listing size. The full plugin crowds other plugins out of the skill listing. A selective install (`manifests/install-profiles.json`: the `minimal` profile has no hooks, so `strategic-compact` loses its hook) or single skills avoid that. Arm E of the recorded runs is BenchKeeper with agent-skills replaced by the ECC `minimal` profile, next to the agent-skills (C) and Superpowers (D) stacks (see Benchmark).

[All evaluations](../../EVALUATIONS.md)
