---
name: maintaining-repos
description: "Runs a repository-wide maintenance pass: dead code, unused options and dependencies, shortcut debt, dependency audit, docs drift, instruction-file audit, unused skills, repository hygiene. Use after a milestone, about every 10 merged changes, or on request."
disable-model-invocation: true
---

# Maintaining repositories

Read only until the findings are approved. Run each part the repository supports:

- `ponytail-audit`: dead code, unused options, config and dependencies, duplicate helpers, risky code without tests.
- `ponytail-debt`: each `shortcut:` comment is still valid, upgraded, or becomes an issue.
- Dependencies: the package manager's audit and unused dependencies (`security-and-hardening`).
- Docs drift: ADRs, `AGENTS.md` and docs against the code (`documentation-and-adrs`).
- Instruction files (Claude Code): `/doctor prompt-audit` for outdated, conflicting or missing references in `CLAUDE.md`, `AGENTS.md` and rules; `/skill-doctor` for unused skills and their context cost.
- Repository hygiene: unarchived OpenSpec changes, merged branches and worktrees, stopped containers.

Present the findings as one list; create issues only for those the user approves. Delete code, tests or docs only after confirmation; remove a test only together with the code it covers (`deprecation-and-migration`).
