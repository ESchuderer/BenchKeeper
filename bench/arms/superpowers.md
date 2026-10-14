Superpowers variant of `rules/global.md` for arm D: the same rules, with each phase pointing to Superpowers' own skills in its own order. `bench/scripts/arm-rules.mjs` replaces the marked sections and lines and writes `superpowers.rules.md`.

<!-- section: Ponytail and agent-skills -->
## Ponytail and Superpowers
- Use Ponytail `full` by default during applicable Superpowers phases, unless the user selects another mode.
- Ponytail guides implementation choices within agreed scope. Project instructions, clarification requirements, architecture boundaries, and required checks take precedence. Sources, confidence levels, and response structure still apply.
- Assess simplicity within `requesting-code-review`. Ponytail review runs on request, not as an additional required gate; `ponytail-audit` and `ponytail-debt` run in the Maintain step (SDLC).

<!-- section: SDLC -->
## SDLC
Skills from Superpowers (obra) drive each phase in Superpowers' order; OpenSpec owns the spec files when the repository has `openspec/`.
- Understand: `AGENTS.md`, the issue if one is given (`gh issue view <n>`), and the code the change touches, before any edit.
- Track (standard, full): without an issue, present the plan and create one after approval (above); if the user declines, continue without one. Then branch (above).
- Conditional skills: load one when the task matches its description, in any phase (for example `systematic-debugging`, `dispatching-parallel-agents`); the task tiers, the phases, OpenSpec, and the issue and pull request flow here take precedence.
- Specify (full): `brainstorming`. With `openspec/`: write the result as an OpenSpec change (`openspec-propose`), not a separate design file. Without it: the design document `brainstorming` writes.
- Plan (full): `writing-plans`; with OpenSpec the tasks live in the change's `tasks.md`.
- Build: `subagent-driven-development` (or `executing-plans`), tests first where the repository has a test suite (`test-driven-development`; standard, full); with OpenSpec through `openspec-apply-change`.
- Verify: `verification-before-completion`: build, types, lint, tests before reporting done; UI changes in a browser (Playwright MCP). Report failures as they are.
- Review and ship: `requesting-code-review` before push (above), `receiving-code-review` for its findings; push the branch and open a draft pull request (above); wait for checks (`gh pr checks --watch`), report failures as they are, mark ready when they pass; `openspec-archive-change` on the branch (above). Merge only on the user's instruction.
- Maintain: after each milestone, about every 10 merged changes, or on request, run a repo-wide pass:
  - `ponytail-audit`: dead code, unused options, config and dependencies, duplicate helpers, risky code without tests;
  - `ponytail-debt`: each `shortcut:` comment is still valid, upgraded, or becomes an issue;
  - dependencies: the package manager's audit and unused dependencies;
  - docs drift: ADRs, `AGENTS.md` and docs against the code;
  - repository hygiene: unarchived OpenSpec changes, merged branches and worktrees, stopped containers.
  Present the findings as one list; create issues only for those the user approves. Delete code, tests or docs only after confirmation; remove a test only together with the code it covers.
- A skill starts a phase directly: `/<skill>` (Claude Code), `$<skill>` or `@<skill>` (Codex).

<!-- replace: pull request (`git-workflow-and-versioning`); ==> pull request; -->
<!-- replace: (Conventional Commits, as in `git-workflow-and-versioning`). ==> (Conventional Commits). -->
<!-- replace: (Claude Code: `code-review`; otherwise `code-review-and-quality`) ==> (`requesting-code-review`) -->
<!-- replace: investigate first (`debugging-and-error-recovery`) ==> investigate first (`systematic-debugging`) -->
<!-- replace: | `security-and-hardening`, tests for denied paths | ==> | security review in `requesting-code-review`, tests for denied paths | -->
