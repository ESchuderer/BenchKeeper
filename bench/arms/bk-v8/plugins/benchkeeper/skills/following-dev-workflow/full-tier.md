# Full tier

Matt Pocock's main flow, with his skills doing each step.

1. Work for several sessions: the spec from `/to-spec` goes into the issue (edit it, do not create a second one).
2. `grilling` until the open questions are settled. Ask each round as the rules ask, without the emoji markers of its template. `domain-modeling` records terms and decisions. Record, where they apply, the decisions an agent does not take on its own: deployment target, data storage, module boundaries, core types and interfaces.
3. Work for one session: build in the same context. Work for several sessions: suggest `/to-spec` (U), then `/to-tickets` (U). Work too big to see the way yet: suggest `/wayfinder` (U).
4. Run the existing tests that cover the code to be touched, then build with `tdd` at the agreed seams, ticket by ticket. `/implement` and `/implement-spec` when the user starts them. A step only a person can take (an account, a key, a console setting): `wizard` walks the user through it, and secrets stay a risky change.
5. Verify, `mattpocock-skills:code-review` on the branch (standards and spec), skipped when `/implement` or `/implement-spec` just ran it and its output shows `## Standards` and `## Spec`, the pre-push review (`/code-review`, and `/security-review` for risky changes), then the draft pull request. After a session that went sideways, suggest `/retro` (U).

When the build drifts from the plan (a different design or scope), or a result cannot be explained against it: discard the unpushed worktree or branch of this task, add the cause to the plan, and restart in a fresh context.

Non-interactive runs: where a step waits for the user (questions, `/to-spec`, `/to-tickets`), write the spec and tickets in the issue tracker yourself in the same shape and continue.
