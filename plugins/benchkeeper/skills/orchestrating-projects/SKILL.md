---
name: orchestrating-projects
description: "Runs a coordinator for parallel autonomous issue work: one worker per project with the projects in parallel, each report verified, merged only where the repository's written policy allows, cleaned up, then the next issue started. Start it on request with the project paths."
disable-model-invocation: true
argument-hint: "<project paths>"
---

# Orchestrating projects

This session is the coordinator. Workers do the issue work in their own worktrees; the coordinator picks, specs, watches, verifies, merges by policy, cleans up and starts the next. The runner's commands are in [orca.md](orca.md); the runner's own guide stays the source for its mechanics. Everything below is runner-neutral.

Projects: $ARGUMENTS (Codex: the paths after the skill name). Each is a repository with a GitHub remote and an `AGENTS.md`.

## Policy

Read `docs/agents/orchestration.json` from each project's default branch (`git show origin/<default>:docs/agents/orchestration.json`), never from a worker's branch, so a worker cannot widen its own rights. Format and example: [policy.example.json](policy.example.json).

| Field | Meaning | Without the file |
|---|---|---|
| `startLabel` | issues with this label may start | none: ask the owner for the label, start nothing |
| `workersPerProject` | workers at once in one project | 1 |
| `hostWorkerLimit` | workers at once on this machine, all projects | 2 |
| `stallMinutes` | time with no commit, PR or message before a worker counts as stalled | 20 |
| `merge.allowed`, `merge.requiredChecks` | the coordinator may merge a verified PR when every listed check is green | no merge: leave the PR for the owner |
| `closeIssue` | the coordinator may close an issue after its PR merged or after a verified no-change finding | no close |
| `deleteMergedBranch` | the owner allows deleting a branch whose PR is merged | no deletion |

Settings, rulesets, secrets and other people's repositories are the owner's. A policy that is silent on an action means no.

## Loop

1. **Pick**: per project, the oldest open issue with `startLabel` that has no open PR and no worker or outcome yet in this run. An issue starts once per run (a failed one retries once, below), so a verified no-change issue that stays open without `closeIssue` is not picked again. One issue per project and wave.
2. **Spec**: copy [spec-template.md](spec-template.md) and fill its fields. Build every spec from the template; a spec copied or edited from the previous one carries that issue's details into the next.
3. **Start** one worker per project, up to `workersPerProject` and `hostWorkerLimit`. Projects run in parallel; a project with no free slot waits.
4. **Watch** until every worker has settled. Each wake-up checks three things: worker reports, worker state, and merged PRs (a PR merged by the owner or a bot settles that issue's work even when its worker never reported). A worker whose state reports alive or idle may be waiting at a prompt, so state alone proves nothing: apply the stall check. Wake at least every `stallMinutes` / 2.
5. **React** to each outcome (below), clean up, return to 1 for that project.
6. **Report** per project: issue, outcome, evidence, and what was skipped or not checked.

## Outcomes

- **Done with a PR**: read the PR, the worker's "not checked" list and the issue's acceptance criteria. Verify the diff against them and that every check in `merge.requiredChecks` is green with no unresolved review thread. Merge only when `merge.allowed`; otherwise leave the PR ready and name it in the report. After the merge, close the issue when `closeIssue`. Then clean up.
- **Done, no change needed**: verify the claim yourself on the base branch (read the code, run the check the issue names). Comment the evidence on the issue and close it when `closeIssue`. Then clean up.
- **Blocked**: the worker commented on the issue and reported blocked (a refused hook, a missing credential, a check it cannot fix). Confirm the comment exists, release the worker, start the next issue of that project. Keep that worktree and branch, and list the issue in the report: they may hold the only copy of the work.
- **Failed**: read the worker's output. Retry once with a fresh worker and a spec from the template. A second failure is blocked.
- **Stalled**: no commit, PR or message for `stallMinutes`. Read the worker's last output. Only proof that the session ended without a report (its final turn is over and nothing was sent) makes it blocked, after stopping it. A worker still producing output keeps waiting.

A refused commit or push by a repository hook is reported with paths and counts only and handed to the owner. Bypassing, editing or disabling a hook is never an option for a worker or the coordinator.

## Clean up

Each step is separate; do the ones the outcome allows, in this order:

1. Stop the worker if it has not settled (an idle worker that sent no report is stopped first), then release it once the runner reports it releasable.
2. Remove its worktree and the containers started for it, the way that project's `AGENTS.md` says. Only when the worktree has no uncommitted changes and every commit is pushed. Use a removal that leaves the branch alone unless step 3 applies.
3. Delete the branch (local and remote) only when its PR is merged and `deleteMergedBranch` allows it.

Cleanup of a finished worker happens as part of reacting to its outcome, without waiting to be asked.

## Rules

- Workers decide the safest reversible option and write it in the PR; they never wait for a coordinator answer. The coordinator does not answer questions workers hold back.
- Report each step with what was skipped or not checked.
- Stay within `hostWorkerLimit` even when more issues are labeled.
