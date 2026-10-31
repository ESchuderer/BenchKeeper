---
name: workflow
description: "Picks the workflow and tier for a task: a software change (quick, standard, full), a docs pass, research, or a batch of tasks on one branch, with the checks and reviews each needs. Use before the first edit in a repository, before issue or pull request work, and before research with two or more items."
writes: "The tier line `Tier: <tier> (<change type>)` before the first edit; through its playbooks commits and a pull request in the project's convention."
---

# Workflow

1. **Classify.** Kind: software change, docs pass (several documents or product copy checked against the code; a one-file rewrite with no claim about code is a quick software change), research, or a mix (one item per kind). Tier of a software change:

   | Tier | When |
   |---|---|
   | quick | the diff fits in one sentence |
   | standard | one behavior, or a refactor that keeps behavior, approach clear |
   | full | several behaviors, a new capability, an uncertain approach, or a risky change |

   Risky: authentication, permissions, secrets, input validation, production data, deploy or production configuration, an irreversible action. The user's explicit tier for the task wins, then a session override from `/benchkeeper:tier` (a risky change still names the full tier and asks), then the [change-type table](#change-types), then a `Default tier:` line in `AGENTS.md`. Several requests in one prompt: tier each. Before the first edit or command, write the tier line `Tier: <tier> (<change type>)` with the change type's name from that table, or a few words when none fits (`Tier: research` and `Tier: <tier> (override)` stay as they are). The work grows past its tier: say so, write a new tier line, and run the skipped steps before the next edit.
2. **Settle.** Standard and full: when goal, scope or result is open, grill the user in rounds (each question with your recommendation, all open ones per round) until goal, scope, acceptance criteria and risks are settled; a settled request skips the grill. Then explore read-only (Claude Code: plan mode). Non-interactive runs: write the plan yourself and continue.
3. **Run the playbook.** Software change at quick tier: this file is the whole playbook (the steps below, [Change types](#change-types), [Verify](#verify)). Standard and full tier: also [software.md](software.md), full tier also [full-tier.md](full-tier.md). Branches, commits and pull requests follow the project's own convention (`AGENTS.md`, a contributing guide, the history). Docs pass: [docs.md](docs.md). Research: [research.md](research.md). Two or more independent items that each need more than a few files or searches: one subagent per item in parallel, then one merged report; smaller items run in this session. The playbooks hold the detail; these are the steps, in order:

   | Tier | Steps |
   |---|---|
   | quick | edit, fast checks after each edit; verify; commit |
   | standard | settle; existing tests of the touched code; test first, implement; verify, review before pushing |
   | full | settle, spec with acceptance table; existing tests; test first ticket by ticket; verify and run it; review in rounds ([full-tier.md](full-tier.md)) |

4. **Batch** when the user asks for it or names several tasks for one branch: the tasks run one after another, each at quick tier with no per-task review. Tier each task first (step 1): a task that is risky or above quick tier is not batched and runs at its own tier. Step 5 and the reviews then run once for the whole branch.
5. **Long checks last.** Fast checks (types, lint, the tests of the touched code) after each edit. The full suite, end-to-end and browser tests and builds run once, after the last edit, in a subagent that returns only failures and key lines. Reviews start then and follow the tier playbook, including its remediation and re-review rounds. A long check writes to a log file and is read by its failures and last lines. Fixes follow the project's commit convention, and failed checks rerun. Waiting for pull request checks: watch them in the background (GitHub: `gh pr checks --watch`) or with one until-loop Monitor, never a leading `sleep`; load a deferred tool's schema (ToolSearch) before the first call.
6. **Report done** with each check's command and result, a "steps skipped" line naming the checklist steps not run (or "none") and what was not checked. After a merge or when the next task is unrelated, suggest a new session (`/clear` in Claude Code).

## Change types

Sets the tier when the user named none, and the check before done. Never run a check that changes shared or production systems (`terraform apply`, `kubectl apply`, `helm upgrade`, migrations against shared databases).

| Change | Tier | Check before done |
|---|---|---|
| Docs, typo | quick | docs build, link check |
| Config value | quick, full for production, deploy or security config | tests, schema or lint |
| Tests only, log line | quick (standard when it logs user data) | |
| Dependency patch or minor | quick | full suite, package audit |
| UI tweak | quick | browser check, screenshot baselines updated only for intended changes |
| UI behavior in an existing flow | standard, full for a new page or flow | end-to-end and accessibility tests |
| Bug | standard | known cause: a failing test first. Unknown: diagnose the cause first (a diagnosis skill, when installed) |
| Refactor | standard in one module, full across modules or with a changed interface | suite unchanged and passing |
| Dependency major or security advisory | standard | changelog read, full suite, package audit |
| CI workflow | standard, full for deploy steps | `actionlint` |
| Feature, performance | full | performance: benchmark before and after on the same machine |
| Infrastructure as code | full | `fmt -check`, `validate`, `plan`; `ansible-lint --check --diff`; `kubeconform`, `kubectl diff`; `helm lint`, `helm template` |
| Schema migration | full | expand and contract, migrate a throwaway database |
| Production data fix | full | dry run on a copy, the user runs it |
| Auth, permissions, secrets, input validation | full | tests for denied paths |
| Review-thread follow-up on an open pull request | standard | the fix verified, each thread answered |
| CI fix | quick | the failing check rerun |
| Merge conflict | quick | resolved the way the repository's conventions say, checks rerun |
| Live-system change or incident | full when secrets, data or production configuration are touched, else by the table | backup first, verify live, record in the repository docs |

A follow-up commit on an open pull request keeps its tier and needs no workflow reload or new tier line.

## Verify

The project's own build, types, lint and tests, run where `AGENTS.md` says. Run what you changed (Claude Code: `/verify`); UI changes also get a browser check next to the UI tests. Diagnose a failing test first (code, test or environment) and fix the cause; edit a test only when it is wrong or the requirement changed, and say so in the pull request. Browser and build output (`test-results/`, screenshots) is git-ignored or deleted.

After a compaction, read this skill and the playbook of the current tier again before the next step.
