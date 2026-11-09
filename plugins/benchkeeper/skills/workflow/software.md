# Software change

## Steps

Standard and full tier. The order per tier is the checklist in [SKILL.md](SKILL.md), and its change-type table and Verify apply; full tier also [full-tier.md](full-tier.md). Standard: for a refactor the suite passes before and after with tests unchanged. Detail:

- **Installed skills** that match a step run it: a test first where the [test rule](SKILL.md#verify) calls for one, bug diagnosis, interface design, prototypes, domain docs, spec review, pull request text. A skill only the user starts is suggested, then wait. None installed: do the step directly.
- **Review before pushing** standard, full or risky work. First a scope line: the branch or diff range and the issue it implements, when one exists. Depth: standard one correctness pass, fixes made once; full the rounds in [full-tier.md](full-tier.md), plus a security pass when risky; quick none. Claude Code: the built-in `/code-review` with no target, risky changes also `/security-review`. Codex, or no `origin`: a correctness pass and, for risky changes, a security pass by subagents over the changed assets, trust boundaries and failure modes (authentication, permissions, secrets and input handling among them). Docs-only changes skip this unless risky.
- **Pull request**, when the project uses them: the body from step 3 of [SKILL.md](SKILL.md). After pushing, wait for the checks (step 5 of [SKILL.md](SKILL.md)). Review comments and failing checks: fixes on the same branch, committed by the project's convention.

## Phases

Standard and full tier, except a change that only deletes: this session is the phase orchestrator. It runs each phase as a subagent with a fresh context and keeps the decision after each phase and the questions to the user, which a subagent cannot ask ([Claude Code withholds the question tool from subagents](https://code.claude.com/docs/en/sub-agents#available-tools)).

1. **Plan**: the read-only exploration of step 2 of [SKILL.md](SKILL.md). It returns the plan with an acceptance table as step 1 of [full-tier.md](full-tier.md) defines it (full tier: that whole spec) and the open questions, each with a recommendation. The session saves the plan outside the repository and names its path in every later phase.
2. **Implement**: the existing tests of the touched code, the change with the tests the [test rule](SKILL.md#verify) calls for, written first, fast checks after each edit, commits.
3. **Test**: the long checks of step 5 of [SKILL.md](SKILL.md), by a subagent that did not write the code, which then tries to break the change against the acceptance table and returns failures and key lines.
4. **Review**: a subagent that did not write the code checks the diff against the plan (full tier: the spec review of step 4 of [full-tier.md](full-tier.md)), then the review before pushing (above).

After each phase the session goes on, loops back with the report (a failed check or a finding to fix goes back to implement, a plan the code contradicts back to plan), or stops and reports (full tier: the drift rule and the round limit of [full-tier.md](full-tier.md)).
