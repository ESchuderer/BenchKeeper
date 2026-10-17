# Full tier

Matt Pocock's main flow, with his skills doing each step. (U) marks user-invoked skills: suggest them and wait.

1. Issue and branch, as for every tier. Work for several sessions: the spec from `/to-spec` goes into this issue (edit it, do not create a second one), and the tickets from `/to-tickets` link to it. Size each ticket to fit one fresh context window (Matt Pocock's `to-tickets`).
2. `grilling` until the open questions are settled. Ask each round as the rules ask, without the emoji markers of its template. `/grill-with-docs` (U) is the user's alternative that also writes the docs. `domain-modeling` records terms and decisions (`GLOSSARY.md`, ADRs). Record, where they apply, the decisions an agent does not take on its own: deployment target, data storage, module boundaries, core types and interfaces.
3. Work for one session: build in the same context. Work for several sessions: suggest `/to-spec` (U), then `/to-tickets` (U). Work too big to see the way yet: suggest `/wayfinder` (U).
4. Run the existing tests that cover the code to be touched, then build with `tdd` at the agreed seams, ticket by ticket. `/implement` (U) and `/implement-spec` (U, tickets in parallel worktrees) run when the user starts them. A step only a person can take (an account, a key, a console setting): `wizard` walks the user through it, and secrets stay a risky change.
5. Verify, `mattpocock-skills:code-review` on the branch (standards and spec), skipped when `/implement` or `/implement-spec` just ran it and its output shows `## Standards` and `## Spec`, the pre-push review (`/code-review`, and `/security-review` for risky changes), then the draft pull request. After a session that went sideways, suggest `/retro` (U).

When the build drifts from the plan (a different design or scope), or a result cannot be explained against it: discard the worktree or local branch created for this task and not yet pushed, add the cause to the plan, and restart in a fresh context. A pushed branch is deleted only after the user's confirmation.

Non-interactive runs: where a step waits for the user (questions, `/to-spec`, `/to-tickets`), write the spec and tickets in the issue tracker yourself in the same shape and continue.

Only when the user asks:

- Best-of-N: the same task in 2 or 3 worktrees in parallel (Claude Code: `claude --worktree <name>`). Pick by tests, then review. Discard the others.
- Mutation testing on the changed files where the repository has a tool for it (Stryker, mutmut): report surviving mutants and add tests for the behavior they reveal.
