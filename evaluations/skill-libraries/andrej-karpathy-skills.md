# andrej-karpathy-skills

[Repository](https://github.com/multica-ai/andrej-karpathy-skills), Category: skill libraries, Checked 2026-10-14, Decision: Not in

## Advertised

- "reducing costly mistakes on non-trivial work"

## Independent evidence

- [skill-receipts audit](https://github.com/sjh9714/skill-receipts/blob/main/docs/audits/karpathy.md) (commit 2c60614, Claude Code, claude-opus-4-8, 12 small tasks with hidden tests, 5 runs per arm): accuracy 60/60 in every arm, median source lines -4.8% (within noise), median cost +11.5%, no p-values.
- [Soarr01/skillbench](https://github.com/Soarr01/skillbench) (system-prompt injection, Opus 4.8, 10 tasks x 5 runs): cost +6.6%, oracle checks unchanged.

## User reports

Thread "Top Agent Skills Repositories" (r/claudeskills, about 2 months old, text supplied by the owner; URL not recorded). Opinions, no measurements.
- One user runs agent-skills fully plus the Karpathy guidelines.

## Decision

Not in: one skill of 4 rules that overlap Ponytail and `rules/global.md`; measured cost slightly higher.

[All evaluations](../../EVALUATIONS.md)
