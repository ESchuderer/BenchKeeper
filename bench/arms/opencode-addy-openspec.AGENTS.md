# Agent Skills with OpenSpec (OpenCode)

OpenSpec is the authoritative source for requirements, specifications, design decisions and task tracking. Skills from agent-skills are installed under `.opencode/skills/` and support the work inside each OpenSpec change.

## Workflow

- Specify and plan with OpenSpec: `openspec-propose` (proposal, specs, design, `tasks.md`); `openspec-explore` to think through options first.
- Implement with `openspec-apply-change`, task by task, and keep `tasks.md` current.
- Verify with `openspec-verify-change`, then archive with `openspec-archive-change`.
- Do not write separate spec, plan or task documents outside OpenSpec.

## Skills within OpenSpec tasks

Invoke a skill with the `skill` tool when the task matches it:

- Architecture and interfaces: `api-and-interface-design`
- Implementation: `frontend-ui-engineering`, `code-simplification`
- Testing: `test-driven-development`, `browser-testing-with-devtools`
- Debugging: `debugging-and-error-recovery`
- Security: `security-and-hardening`
- Review: `code-review-and-quality`

Left out because OpenSpec owns these steps: `spec-driven-development`, `planning-and-task-breakdown`, `incremental-implementation`, `idea-refine`, `interview-me`, `using-agent-skills`.
