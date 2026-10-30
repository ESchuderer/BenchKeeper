# Full tier

Names in parentheses are Matt Pocock's skills (`mattpocock-skills:<name>`, U: the user starts them). Without them, do the step directly.

1. Settle the spec: the decisions an agent does not take on its own (deployment target, data storage, module boundaries, core types and interfaces), terms and decisions recorded (`domain-modeling`). Add an acceptance table: per requirement the instrument (test, command, screenshot), the wrong implementation it rejects, and where the result is observed. The design names one plausible counterexample (an input or state that breaks the obvious approach) and how the design handles it.
2. Several sessions of work: one ticket per independently testable slice where the project tracks work (`/to-tickets`, U), each with acceptance criteria. Work too big to see the way yet: suggest `/wayfinder` (U).
3. Build ticket by ticket: the existing tests of the touched code first, then test-first at the agreed seams (`tdd`; `/implement`, `/implement-spec` when the user starts them). A step only a person can take (an account, a key, a console setting): walk the user through it (`wizard`); secrets stay a risky change.
4. Verify against the acceptance table, review the branch against the spec (`code-review`, skipped when `/implement` just ran it), the review before pushing from [software.md](software.md), then the pull request. After a session that went sideways, suggest `/retro` (U).

The build drifts from the plan (another design or scope), or a result cannot be explained against it: stop, add the cause to the plan, and ask the user whether to discard this task's unpushed branch and restart in a fresh context. Non-interactive runs: keep the branch, report the cause and stop.

## Review rounds

The reviewer is a fresh session that does not edit (a subagent). Findings carry a class: **Blocking** (wrong behavior, security, data loss, an acceptance row unmet), **Important** (likely defect or missing test) and **Minor** (style, naming). One remediation pass fixes Blocking and Important findings, then a scoped re-review reads only the changed lines and the findings. At most three rounds; findings left after the third: replan or split the work and tell the user. Minor findings are listed in the pull request, not fixed in a round. An independent reviewer on another agent (Codex `codex exec --sandbox read-only`, or Claude Code for a Codex session) is an option; default off.
