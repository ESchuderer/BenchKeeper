---
name: maintaining-repos
description: "Runs a repository-wide maintenance pass: dead code, unused options and dependencies, shortcut debt, dependency audit, version pins, docs drift, instruction-file audit, unused skills, repository hygiene."
disable-model-invocation: true
---

# Maintaining repositories

Read only until the findings are approved. Run each part the repository supports:

- `ponytail:ponytail-audit`: dead code, unused options, config and dependencies, duplicate helpers, risky code without tests.
- `ponytail:ponytail-debt`: each `shortcut:` comment is still valid, upgraded, or becomes an issue.
- Dependencies: the package manager's audit and unused dependencies.
- Pins that no update bot covers (`pkg@x.y.z` in docs, scripts, Dockerfiles): compare each with the newest release that is at least 7 days old (`npm view <pkg> time --json` for npm). List the bumps (package, pinned, newest). Each accepted bump changes every occurrence (`git grep -n '<pkg>@'`) on a branch. Recorded benchmark or release pins stay.
- Docs drift: `GLOSSARY.md`, ADRs, `AGENTS.md` and docs against the code (`domain-modeling`).
- Instruction files (Claude Code): `/doctor prompt-audit` for outdated, conflicting or missing references in `CLAUDE.md`, `AGENTS.md` and rules; `/skill-doctor` for unused skills and their context cost.
- Architecture and open requests, where the repository has Matt Pocock's skills: suggest `/mattpocock-skills:improve-codebase-architecture`, `/mattpocock-skills:triage` and, after sessions that went sideways, `/mattpocock-skills:retro`, which the user starts.
- Repository hygiene: merged branches and worktrees, stopped containers, tickets in the issue tracker (`docs/agents/issue-tracker.md`) that the merged work already closed.

Present the findings as one list. Create issues only for those the user approves. Delete code, tests or docs only after confirmation. Remove a test only together with the code it covers.
