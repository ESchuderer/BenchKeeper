---
name: workflow
description: "Picks the workflow and tier for a task: a software change (quick, standard, full), a docs pass, research, or a batch of tasks on one branch, with the checks and reviews each needs. Use before the first edit in a repository, before issue or pull request work, and before research with two or more items."
---

# Workflow

1. **Classify.** Kind: software change, docs pass (several documents or product copy checked against the code), research, or a mix (one item per kind). Tier of a software change:

   | Tier | When |
   |---|---|
   | quick | the diff fits in one sentence |
   | standard | one behavior, or a refactor that keeps behavior, approach clear |
   | full | several behaviors, a new capability, an uncertain approach, or a risky change |

   Risky: authentication, permissions, secrets, input validation, production data, deploy or production configuration, an irreversible action. The user's explicit tier wins, then the change-type table in [software.md](software.md), then a `Default tier:` line in `AGENTS.md`. Several requests in one prompt: tier each. Write `Tier: <tier>` (or `Tier: research`) before the first edit or command. The work grows past its tier: say so, move up, and run the skipped steps before the next edit.
2. **Settle.** Standard and full: grill the user in rounds (each question with your recommendation) until goal, scope, acceptance criteria and risks are settled, then explore read-only (Claude Code: plan mode). The approved plan is the issue plan. Non-interactive runs: write the plan yourself and continue.
3. **Run the playbook.** Software change: [software.md](software.md), full tier also [full-tier.md](full-tier.md). Docs pass: [docs.md](docs.md). Research: [research.md](research.md). Two or more independent items: one subagent per item in parallel, then one merged report.
4. **Batch** when the user asks for it or names several tasks for one branch: each task runs at quick tier with one commit (`Refs #<issue>`) and no per-task review. Step 5 and the reviews then run once for the whole branch, and one draft pull request closes every issue.
5. **Long checks last.** Fast checks (types, lint, the tests of the touched code) after each edit. The full suite, end-to-end and browser tests, builds and reviews run once, after the last edit, in a subagent that returns only failures and key lines. Fixes are new commits, and failed checks rerun.
6. **Report done** with each check's command and result, and one line on what was skipped or not checked.
