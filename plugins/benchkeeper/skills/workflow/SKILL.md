---
name: workflow
description: "Picks the workflow and tier for a task: a software change (quick, standard, full), a docs pass, research, or a batch of tasks on one branch, with the checks and reviews each needs. Use before the first edit in a repository, before issue or pull request work, and before research with two or more items."
writes: "The tier line `Tier: <tier> (<change type>)` before the first edit; through its playbooks a branch, commits, a GitHub issue after your approval, a draft pull request, issue comments, issue closes and a handoff note for work left over."
---

# Workflow

1. **Classify.** Kind: software change, docs pass (several documents or product copy checked against the code; a one-file rewrite with no claim about code is a quick software change), research, or a mix (one item per kind). Tier of a software change:

   | Tier | When |
   |---|---|
   | quick | the diff fits in one sentence |
   | standard | one behavior, or a refactor that keeps behavior, approach clear |
   | full | several behaviors, a new capability, an uncertain approach, or a risky change |

   Risky: authentication, permissions, secrets, input validation, production data, deploy or production configuration, an irreversible action. The user's explicit tier for the task wins, then a session override from `/benchkeeper:tier` (a risky change still names the full tier and asks), then the change-type table in [software.md](software.md), then a `Default tier:` line in `AGENTS.md`. Several requests in one prompt: tier each. Before the first edit or command, write the tier line `Tier: <tier> (<change type>)` with the change type's name from that table, or a few words when none fits (`Tier: research` and `Tier: <tier> (override)` stay as they are). The work grows past its tier: say so, write a new tier line, and run the skipped steps before the next edit.
2. **Settle.** Standard and full: when goal, scope or result is open, grill the user in rounds (each question with your recommendation, all open ones per round) until goal, scope, acceptance criteria and risks are settled; a settled request skips the grill. Then explore read-only (Claude Code: plan mode). The approved plan is the issue plan. Non-interactive runs: write the plan yourself and continue. Suggest an effort level once (quick low, standard medium, full high); the user sets it.
3. **Run the playbook.** Software change: [software.md](software.md), full tier also [full-tier.md](full-tier.md). Docs pass: [docs.md](docs.md). Research: [research.md](research.md). Two or more independent items that each need more than a few files or searches: one subagent per item in parallel, then one merged report; smaller items run in this session. The playbooks hold the detail; these are the steps, in order:

   | Tier | Steps |
   |---|---|
   | quick | branch off the default branch; edit, fast checks after each edit; verify; commit; draft pull request |
   | standard | settle, issue; branch, existing tests of the touched code; test first, implement; verify, review before pushing; draft pull request |
   | full | settle, spec with acceptance table in the issue; branch, existing tests; test first ticket by ticket; verify and run it; review in rounds ([full-tier.md](full-tier.md)); draft pull request |

4. **Batch** when the user asks for it or names several tasks for one branch: the tasks run one after another, each at quick tier with one commit (`Refs #<issue>`) and no per-task review. Tier each task first (step 1): a task that is risky or above quick tier is not batched and runs at its own tier. Step 5 and the reviews then run once for the whole branch, and one draft pull request closes every issue.
5. **Long checks last.** Fast checks (types, lint, the tests of the touched code) after each edit. The full suite, end-to-end and browser tests and builds run once, after the last edit, in a subagent that returns only failures and key lines. Reviews start then and follow the tier playbook, including its remediation and re-review rounds. A long check writes to a log file and is read by its failures and last lines. Fixes are new commits, and failed checks rerun. Waiting for pull request checks: run `gh pr checks --watch` in the background or with one until-loop Monitor, never a leading `sleep`; load a deferred tool's schema (ToolSearch) before the first call.
6. **Report done** with each check's command and result, a "steps skipped" line naming the checklist steps not run (or "none") and what was not checked. Work left for another session or worker gets a handoff note in the issue or pull request: done, state of the branch, next step, open decisions. After a merge or when the next task is unrelated, suggest a new session (`/clear` in Claude Code).

After a compaction, read this skill and the playbook of the current tier again before the next step.
