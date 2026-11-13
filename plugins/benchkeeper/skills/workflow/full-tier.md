# Full tier

Parentheses name the kind of skill that runs a step when installed; one only the user starts is suggested, then wait. None installed: do the step directly.

1. Settle the spec: the decisions an agent does not take on its own (deployment target, data storage, module boundaries, core types and interfaces; without terminal questions they go into the task's issue (else the report), and the task waits while other work goes on), terms and decisions recorded (a domain-modeling skill).
   - Add an acceptance table: per requirement the instrument (test, command, screenshot), the wrong implementation it rejects, and where the result is observed.
   - The design names one plausible counterexample (an input or state that breaks the obvious approach) and how the design handles it.
2. Several sessions of work: one ticket per independently testable slice where the project tracks work (a ticket skill, user-started), each with acceptance criteria. Work too big to see the way yet: suggest a planning skill the user starts.
3. Build ticket by ticket: the existing tests of the touched code first, then a test first at the agreed seams where the [test rule](SKILL.md#verify) calls for one (a TDD skill; an implementation skill when the user starts one). A step only a person can take (an account, a key, a console setting): walk the user through it (a walkthrough skill); secrets stay a risky change.
4. Verify against the acceptance table, review the branch against the spec (a spec-review skill, skipped when an implementation skill just ran it), the review before pushing from [software.md](software.md), then the pull request. After a session that went sideways, suggest a retro skill the user starts.

The build drifts from the plan (another design or scope), or a result cannot be explained against it: stop, add the cause to the plan, and ask the user whether to discard this task's unpushed branch and restart in a fresh context. Without terminal questions: keep the branch, report the cause and stop.

## Review rounds

The reviewer is a fresh session that does not edit (a subagent; Claude Code: `benchkeeper:review` where available, with the model and effort of the Review phase in [software.md](software.md#phases)). A review or re-review whose context was compacted is void: run it again on a smaller scope.

Findings carry a class:
- **Blocking**: wrong behavior, security, data loss, an acceptance row unmet.
- **Important**: likely defect, or a missing test the [test rule](SKILL.md#verify) calls for.
- **Minor**: style, naming. Minor findings are listed in the pull request, not fixed in a round.

A review with a Blocking or Important finding is a round:
- Risky change, first round (trial): before the fix, a fresh verifier that did not write the code or the review (Claude Code: `benchkeeper:verify`) marks each Blocking and Important finding confirmed or disputed with evidence. A disputed finding goes with its evidence to the re-review unfixed.
- One remediation pass checks each finding first, fixes the ones that hold, and answers one it disproves with evidence instead of a change.
- A scoped re-review by a fresh subagent (Claude Code: `benchkeeper:recheck`) reads only the changed lines and the findings, and keeps or drops each disputed one. It runs on the review's model at `high`; after a review on `fable`, on `opus`, unless the fix changes security or safety logic.

1. First round with findings: remediation, then re-review.
2. Second round with findings: remediation, then re-review.
3. After the second round with findings, the phase they come from reruns on a stronger model or a higher effort (`xhigh` only where the spec or the user asks for it), as [software.md](software.md#phases) says for a stuck implement phase. With no step left, the question goes to the user at once.
4. A third round with findings is a question for the user (replan or split the work), never a fourth round.

An independent reviewer on another agent (Codex `codex exec --sandbox read-only`, or Claude Code for a Codex session) is an option; default off.
