---
name: maintaining-repos
description: "Runs a repository-wide maintenance pass: dead code, duplicates, unused options and dependencies, dependency cycles, test audit by mutation, shortcut debt, dependency audit, version pins, docs drift, instruction-file audit, unused skills, repository hygiene."
disable-model-invocation: true
---

# Maintaining repositories

Read only until the findings are approved. Start on a clean tree (`git status --porcelain` prints nothing; else stop and say so) and note `git rev-parse HEAD`. Read the project's local knowledge base first and write the verdicts back at the end ([knowledge.md](knowledge.md); the owner shows or clears it with `benchkeeper maintain knowledge show|clear`). Run each part the repository supports:

- `ponytail:ponytail-audit`.
- `ponytail:ponytail-debt`: each `shortcut:` comment is still valid, upgraded, or becomes an issue.
- Dependencies: the package manager's audit.
- Pins that no update bot covers (`pkg@x.y.z` in docs, scripts, Dockerfiles): compare each with the newest release that is at least 7 days old. List the bumps (package, pinned, newest). Each accepted bump changes every occurrence on a branch. Recorded benchmark or release pins stay.
- Docs drift: `GLOSSARY.md`, ADRs, `AGENTS.md` and docs against the code (`mattpocock-skills:domain-modeling` when installed). Several documents: the docs pass of `benchkeeper:workflow`.
- Instruction files (Claude Code): `/doctor prompt-audit` for outdated, conflicting or missing references in `CLAUDE.md`, `AGENTS.md` and rules; `/skill-doctor` for unused skills and their context cost.
- Cleanup (duplicated code, unused files, exports and dependencies): run the stack's tools from [tools.md](tools.md), then read each finding in the code.
- Architecture (cycles, shallow or forwarding modules, one source of truth, documented against actual structure): [architecture.md](architecture.md). With Matt Pocock's skills, suggest `/mattpocock-skills:improve-codebase-architecture`, which the user starts, for the deepening work.
- Test audit (a mutation tester for the stack, last because it is the longest part): [test-audit.md](test-audit.md). It sets the time and memory bounds for the run.
- Open requests and sessions that went sideways, with Matt Pocock's skills: suggest `/mattpocock-skills:triage` and `/mattpocock-skills:retro`, which the user starts.
- BenchKeeper setup: `npx benchkeeper@6.20.0 doctor` and `test` in the repository; `update-all` when its setup version is behind.
- Repository hygiene: merged branches and worktrees, stopped containers, tickets in the issue tracker (`docs/agents/issue-tracker.md`) that the merged work already closed.

A tool that is missing and cannot be installed is not a failed pass: do that part by reference search and reading, and say so in the report.

## Report

One list, ranked: each finding has its file and line, the tool or search that found it, effort and risk. Create issues only for those the user approves.

Baseline: the verdicts of the knowledge base (`verdicts.json`). The next pass reads them first and reports new, resolved and kept findings; a verdict is reused only while its files are unchanged.

## Changes after approval

Each approved item is a change under `benchkeeper:workflow` (a refactor in one module is standard, across modules full; several items on one branch run as a batch), one commit per concern, behavior unchanged, the project's tests before and after. Before deleting anything, search every reference to it (code, tests, docs, scripts, config) and record the result. Remove a test only with its recorded reason: it protects nothing, or the code it covers is removed with it.
