ECC variant of `rules/global.md` for arm E: the same rules, with each phase pointing to ECC's own agents and skills in its own order. `bench/scripts/arm-rules.mjs` replaces the marked sections and lines and writes `ecc.rules.md`.

<!-- section: Ponytail and agent-skills -->
## Ponytail and ECC
- Use Ponytail `full` by default during applicable ECC phases, unless the user selects another mode.
- Ponytail guides implementation choices within agreed scope. Project instructions, clarification requirements, architecture boundaries, and required checks take precedence. Sources, confidence levels, and response structure still apply.
- Assess simplicity within the `code-reviewer` agent's review; use the `refactor-cleaner` agent where needed within scope. Ponytail review runs on request, not as an additional required gate; `ponytail-audit` and `ponytail-debt` run in the Maintain step (SDLC).

<!-- section: SDLC -->
## SDLC
ECC's agents and skills (affaan-m) drive each phase in ECC's order (its rules in `~/.claude/rules/ecc/`); OpenSpec owns the spec files when the repository has `openspec/`.
- Understand: `AGENTS.md`, the issue if one is given (`gh issue view <n>`), and the code the change touches, before any edit.
- Track (standard, full): without an issue, present the plan and create one after approval (above); if the user declines, continue without one. Then branch (above).
- Conditional agents and skills: load one when the task matches its description, in any phase (for example the `build-error-resolver` or `e2e-runner` agents); the task tiers, the phases, OpenSpec, and the issue and pull request flow here take precedence.
- Specify (full): the `planner` agent (requirements, risks, phases). With `openspec/`: write the result as an OpenSpec change (`openspec-propose`), not a separate spec file.
- Plan (full): the `planner` agent; with OpenSpec the tasks live in the change's `tasks.md`.
- Build: tests first where the repository has a test suite (`tdd-workflow`, the `tdd-guide` agent; standard, full); with OpenSpec through `openspec-apply-change`.
- Verify: `verification-loop`: build, types, lint, tests before reporting done; UI changes in a browser (Playwright MCP). Report failures as they are.
- Review and ship: the `code-reviewer` agent before push (above), the `security-reviewer` agent for security-relevant changes; push the branch and open a draft pull request (above); wait for checks (`gh pr checks --watch`), report failures as they are, mark ready when they pass; `openspec-archive-change` on the branch (above). Merge only on the user's instruction.
- Maintain: after each milestone, about every 10 merged changes, or on request, run a repo-wide pass:
  - `ponytail-audit`: dead code, unused options, config and dependencies, duplicate helpers, risky code without tests;
  - `ponytail-debt`: each `shortcut:` comment is still valid, upgraded, or becomes an issue;
  - dependencies: the package manager's audit and unused dependencies (the `security-reviewer` agent);
  - docs drift: ADRs, `AGENTS.md` and docs against the code (the `doc-updater` agent, `architecture-decision-records`);
  - repository hygiene: unarchived OpenSpec changes, merged branches and worktrees, stopped containers.
  Present the findings as one list; create issues only for those the user approves. Delete code, tests or docs only after confirmation; remove a test only together with the code it covers (the `refactor-cleaner` agent).
- An agent or skill starts a phase directly: `/<skill>` (Claude Code), `$<skill>` or `@<skill>` (Codex).

<!-- replace: (`git-workflow-and-versioning`); ==> (`git-workflow`); -->
<!-- replace: as in `git-workflow-and-versioning`). ==> as in `git-workflow`). -->
<!-- replace: (Claude Code: `code-review`; otherwise `code-review-and-quality`) ==> (the `code-reviewer` agent) -->
<!-- replace: investigate first (`debugging-and-error-recovery`) ==> investigate first -->
<!-- replace: | `security-and-hardening`, tests for denied paths | ==> | the `security-reviewer` agent, tests for denied paths | -->
