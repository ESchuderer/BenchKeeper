# Full tier

Parentheses name the kind of skill that runs a step when installed ([software.md](software.md#steps)).

1. Settle the spec: the decisions an agent does not take on its own (deployment target, data storage, module boundaries, core types and interfaces), terms and decisions recorded (a domain-modeling skill). Add an acceptance table: per requirement the instrument (test, command, screenshot), the wrong implementation it rejects, and where the result is observed. The design names one plausible counterexample (an input or state that breaks the obvious approach) and how the design handles it.
2. Several sessions of work: one ticket per independently testable slice where the project tracks work (a ticket skill, user-started), each with acceptance criteria. Work too big to see the way yet: suggest a planning skill the user starts.
3. Build ticket by ticket: the existing tests of the touched code first, then test-first at the agreed seams (a TDD skill; an implementation skill when the user starts one). A step only a person can take (an account, a key, a console setting): walk the user through it (a walkthrough skill); secrets stay a risky change.
4. Verify against the acceptance table, review the branch against the spec (a spec-review skill, skipped when an implementation skill just ran it), the review before pushing from [software.md](software.md), then the pull request. After a session that went sideways, suggest a retro skill the user starts.

The build drifts from the plan (another design or scope), or a result cannot be explained against it: stop, add the cause to the plan, and ask the user whether to discard this task's unpushed branch and restart in a fresh context. Non-interactive runs: keep the branch, report the cause and stop.

## Review rounds

The reviewer is a fresh session that does not edit (a subagent). Findings carry a class: **Blocking** (wrong behavior, security, data loss, an acceptance row unmet), **Important** (likely defect or missing test) and **Minor** (style, naming). One remediation pass fixes Blocking and Important findings, then a scoped re-review reads only the changed lines and the findings. At most three rounds; findings left after the third: replan or split the work and tell the user. Minor findings are listed in the pull request, not fixed in a round. An independent reviewer on another agent (Codex `codex exec --sandbox read-only`, or Claude Code for a Codex session) is an option; default off.
