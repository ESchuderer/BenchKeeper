---
name: maintaining-repos
description: "Runs a repository-wide maintenance pass: dead code, unused options and dependencies, shortcut debt, dependency audit, docs drift, instruction-file audit, unused skills, repository hygiene. Use after a milestone, about every 10 merged pull requests, or on request."
disable-model-invocation: true
---

# Maintaining repositories

Read only until the findings are approved. Run each part the repository supports:

- `ponytail:ponytail-audit`: dead code, unused options, config and dependencies, duplicate helpers, risky code without tests.
- `ponytail:ponytail-debt`: each `shortcut:` comment is still valid, upgraded, or becomes an issue.
- Dependencies: the package manager's audit and unused dependencies.
- Docs drift: `GLOSSARY.md`, ADRs, `AGENTS.md` and docs against the code (`domain-modeling`).
- Instruction files (Claude Code): `/doctor prompt-audit` for outdated, conflicting or missing references in `CLAUDE.md`, `AGENTS.md` and rules; `/skill-doctor` for unused skills and their context cost.
- Architecture and open requests, where the repository has Matt Pocock's skills: suggest `/mattpocock-skills:improve-codebase-architecture` and `/mattpocock-skills:triage`, which the user starts.
- Repository hygiene: merged branches and worktrees, stopped containers, tickets in the issue tracker (`docs/agents/issue-tracker.md`) that the merged work already closed.

Present the findings as one list. Create issues only for those the user approves. Delete code, tests or docs only after confirmation. Remove a test only together with the code it covers.
