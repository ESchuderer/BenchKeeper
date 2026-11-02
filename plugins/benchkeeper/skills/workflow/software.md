# Software change

## Steps

Standard and full tier, on top of [SKILL.md](SKILL.md). A refactor passes the suite before and after with tests unchanged.

- **Installed skills** that match a step run it: tests first, bug diagnosis, interface design, prototypes, domain docs, spec review, pull request text. A skill only the user starts is suggested, then wait. None installed: do the step directly.
- **Review before pushing** standard, full or risky work. First a scope line: the branch or diff range and the issue it implements, when one exists. Depth: standard one correctness pass, fixes made once; full the rounds in [full-tier.md](full-tier.md), plus a security pass when risky; quick none. Claude Code: the built-in `/code-review` with no target, risky changes also `/security-review`. Codex, or no `origin`: a correctness pass and, for risky changes, a security pass by subagents over the changed assets, trust boundaries and failure modes (authentication, permissions, secrets and input handling among them). Docs-only changes skip this unless risky.
- **Pull request**, when the project uses them: the body from step 3 of [SKILL.md](SKILL.md). After pushing, wait for the checks (step 5 of [SKILL.md](SKILL.md)). Review comments and failing checks: fixes on the same branch, committed by the project's convention.
