# Spec Kit

[Repository](https://github.com/github/spec-kit), Category: workflow frameworks, Checked 2026-10-14, Decision: Not in

## Advertised

- Spec, plan and tasks per feature, constitution.

## Independent evidence

- [arXiv 2604.05278](https://arxiv.org/abs/2604.05278) tests Spec Kit plus the authors' own hooks: +0.15 on a 1 to 5 judge score (p<0.05), no agent-skills baseline.
- No comparison with OpenSpec found.

## Decision

Not in: overlaps too much with agent-skills: `speckit-specify`, `speckit-clarify`, `speckit-plan`, `speckit-tasks` and `speckit-implement` duplicate `spec-driven-development`, `planning-and-task-breakdown` and `incremental-implementation`, adding 10 skills per agent; `constitution.md` duplicates `AGENTS.md`; needs uv on the host. Built for up-front planning per feature (one folder per feature, no merge into a current spec); BenchKeeper prefers an incremental workflow, where OpenSpec's per-change deltas fit.

[All evaluations](../../EVALUATIONS.md)
