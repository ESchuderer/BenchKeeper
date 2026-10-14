# OpenSpec

[Repository](https://github.com/Fission-AI/OpenSpec), Category: workflow frameworks, Checked 2026-10-14, Decision: In, unmeasured

## Independent evidence

- None with a no-spec baseline.

## Decision

In, unmeasured: fits an incremental workflow. agent-skills alone keeps one `SPEC.md`, `tasks/plan.md` and `tasks/todo.md` per repository, edited in place ([spec-driven-development](https://github.com/addyosmani/agent-skills/blob/main/skills/spec-driven-development/SKILL.md)). OpenSpec adds:
- one folder per change (proposal, spec deltas, design, tasks) reviewed in the same pull request as the code;
- parallel changes on separate branches do not edit the same file;
- archiving merges the deltas into current specs per capability in `openspec/specs/` and keeps the change as history;
- `openspec validate --strict` checks the format.

agent-skills still drives the process; OpenSpec only owns the spec files.

[All evaluations](../../EVALUATIONS.md)
