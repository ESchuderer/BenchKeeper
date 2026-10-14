Matt Pocock variant of `rules/global.md` for arms X and Y: the same rules, with each phase pointing to the model-invocable skills of mattpocock/skills v1.3.1 in his order (grill, spec, tickets, implement with TDD, review). His user-invoked skills (`/to-spec`, `/to-tickets`, `/implement` and others) cannot be called by the model, so the phases name their outputs instead. `bench/scripts/arm-rules.mjs` replaces the marked sections and lines and writes `mattpocock.rules.md`.

<!-- section: Ponytail and agent-skills -->
## Ponytail and Matt Pocock's skills
- Use Ponytail `full` by default during applicable phases, unless the user selects another mode.
- Ponytail guides implementation choices within agreed scope. Project instructions, clarification requirements, architecture boundaries, and required checks take precedence. Sources, confidence levels, and response structure still apply.
- Assess simplicity within `code-review`; use `codebase-design` where the structure needs it within scope. Ponytail review runs on request, not as an additional required gate; `ponytail-audit` and `ponytail-debt` run in the Maintain step (SDLC).

<!-- section: SDLC -->
## SDLC
Matt Pocock's skills (mattpocock/skills) drive each phase in his order; OpenSpec owns the spec files when the repository has `openspec/`. The issue tracker and domain docs are set up in `docs/agents/`.
- Understand: `AGENTS.md` or `CLAUDE.md`, `docs/agents/`, `GLOSSARY.md` and `docs/adr/` if present, the issue if one is given (`gh issue view <n>`), and the code the change touches, before any edit.
- Track (standard, full): without an issue, present the plan and create one after approval (above); if the user declines, continue without one. Then branch (above).
- Conditional skills: load one when the task matches its description, in any phase (for example `diagnosing-bugs`, `prototype`, `research`); the task tiers, the phases, OpenSpec, and the issue and pull request flow here take precedence.
- Specify (full): `grilling` to settle the open questions, `domain-modeling` for terms and decisions (`GLOSSARY.md`, `docs/adr/`). With `openspec/`: write the result as an OpenSpec change (`openspec-propose`), not a separate spec file. Without it: the spec in the issue tracker as `docs/agents/issue-tracker.md` describes.
- Plan (full): vertical-slice tickets with their blocking order; with OpenSpec the tasks live in the change's `tasks.md`, otherwise one ticket file each in the issue tracker.
- Build: ticket by ticket, tests first where the repository has a test suite (`tdd`; standard, full); with OpenSpec through `openspec-apply-change`.
- Verify: build, types, lint, tests before reporting done; UI changes in a browser (Playwright MCP). Report failures as they are.
- Review and ship: `code-review` before push (above); push the branch and open a draft pull request (above, `pr`); wait for checks (`gh pr checks --watch`), report failures as they are, mark ready when they pass; `openspec-archive-change` on the branch (above). Merge only on the user's instruction.
- Maintain: after each milestone, about every 10 merged changes, or on request, run a repo-wide pass:
  - `ponytail-audit`: dead code, unused options, config and dependencies, duplicate helpers, risky code without tests;
  - `ponytail-debt`: each `shortcut:` comment is still valid, upgraded, or becomes an issue;
  - dependencies: the package manager's audit and unused dependencies;
  - docs drift: ADRs, glossary, `AGENTS.md` and docs against the code (`domain-modeling`);
  - architecture: `codebase-design`;
  - repository hygiene: unarchived OpenSpec changes, merged branches and worktrees, stopped containers.
  Present the findings as one list; create issues only for those the user approves. Delete code, tests or docs only after confirmation; remove a test only together with the code it covers.
- A skill starts a phase directly: `/<skill>` (Claude Code), `$<skill>` or `@<skill>` (Codex).

<!-- replace: pull request (`git-workflow-and-versioning`); ==> pull request (`pr`); -->
<!-- replace: (Conventional Commits, as in `git-workflow-and-versioning`). ==> (Conventional Commits). -->
<!-- replace: (Claude Code: `code-review`; otherwise `code-review-and-quality`) ==> (`code-review`) -->
<!-- replace: investigate first (`debugging-and-error-recovery`) ==> investigate first (`diagnosing-bugs`) -->
<!-- replace: | `security-and-hardening`, tests for denied paths | ==> | security review in `code-review`, tests for denied paths | -->
