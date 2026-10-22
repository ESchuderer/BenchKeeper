# Full tier

Names in parentheses are Matt Pocock's skills (`mattpocock-skills:<name>`, U: the user starts them). Without them, do the step directly.

1. Settle the spec in the issue (one issue; edit it rather than create a second): the decisions an agent does not take on its own (deployment target, data storage, module boundaries, core types and interfaces), terms and decisions recorded (`domain-modeling`).
2. Several sessions of work: one ticket per independently testable slice in the tracker (`/to-tickets`, U), each with acceptance criteria. Work too big to see the way yet: suggest `/wayfinder` (U).
3. Build ticket by ticket: the existing tests of the touched code first, then test-first at the agreed seams (`tdd`; `/implement`, `/implement-spec` when the user starts them). A step only a person can take (an account, a key, a console setting): walk the user through it (`wizard`); secrets stay a risky change.
4. Verify, review the branch against the spec (`code-review`, skipped when `/implement` just ran it), the review before pushing from [software.md](software.md), then the draft pull request. After a session that went sideways, suggest `/retro` (U).

The build drifts from the plan (another design or scope), or a result cannot be explained against it: stop, add the cause to the plan, and ask the user whether to discard this task's unpushed branch and restart in a fresh context. Non-interactive runs: keep the branch, report the cause and stop.
