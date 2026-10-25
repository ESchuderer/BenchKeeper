# Orca commands

Orca is the runner this skill drives. `ORCA` stands for the executable the session resolved and used for `ORCA skills get orchestration`; substitute it, do not run `ORCA` literally. Load that guide first: it is the version-matched source for the commands and states below. This file only maps the skill's steps onto them. Prefer `--json`.

## Start the run

```text
ORCA orchestration run-create --objective "issue work: <project names>" --json
ORCA orchestration worker-start --spec "<filled spec-template.md>" --worktree new-top-level --repo path:<project path> --base-branch <default branch> --name <number>-<slug> --agent <claude|codex> --json
```

One `worker-start` per project in the wave. Keep the returned dispatch id per worker with its project, issue and branch name (the spec's `<type>/<number>-<slug>`); every later command takes the dispatch id. `worker-show` gives the worktree path. A non-zero exit means no worker; read `failedStage` and `residualResources` before trying again.

## Worker reports

A worker settles with one message. The skill's outcomes map to Orca like this:

| Outcome | Message from the worker |
|---|---|
| done, and no change needed | `--type worker_done --outcome succeeded` |
| blocked | `--type worker_done --outcome failed` with a subject that starts `Blocked:`, after an issue comment |
| failed | `--type worker_done --outcome failed` |

Orca has no separate blocked message type: a blocked report is a `worker_done` that failed, which settles the dispatch so the coordinator can release it. The worker's start message carries its own `send` command; the spec only says what to report.

## Watch

```text
ORCA orchestration check --wait --types "worker_done,escalation,question" --timeout-ms <stallMinutes / 2 in ms> --json
ORCA orchestration worker-list --run <run_id> --json
ORCA orchestration worker-show --dispatch <dispatch id> --json
ORCA orchestration worker-read --dispatch <dispatch id> --limit 50 --json
gh pr list -R <owner/repo> --head <branch> --state merged --json number,title,mergedAt
```

At each wake-up, including an empty one: `worker-list` for state, then `gh pr list` for merged PRs, then the stall check. Acknowledge a delivery only after its outcome is handled (`check --ack <delivery_id>`).

Liveness, in the guide's terms: `ready` or `unverifiable` is absence, not proof. A worker blocked by a hook or waiting at a prompt stays `ready`, so a state watcher never fires for it. For the stall check, compare the time of the last commit on its branch, its PR and its last message with `stallMinutes`; when exceeded, `worker-read` its last output. Proof that it stopped without a report is a final agent turn that ended with no `worker_done`. Then:

```text
ORCA orchestration worker-stop --dispatch <dispatch id> --json
```

and handle it as blocked; run the `nextAction` that `worker-list` gives for the stopped dispatch before releasing it. Without that proof, keep waiting.

## Clean up

```text
ORCA orchestration worker-release --dispatch <dispatch id> --json
ORCA worktree rm --worktree path:<worktree path> --json
```

Release only a settled worker, so stop an idle worker that sent no report before releasing it. `worker-read` still returns a released worker's output. `ORCA worktree rm` also tries to delete the checked-out local branch (Orca keeps it when it predates the worktree or its changes are not provably merged). Run it only after a merged PR with `deleteMergedBranch` true. In every other case (blocked, no merge allowed, `deleteMergedBranch` false) remove the worktree with `git -C <project path> worktree remove <worktree path>`, which leaves the branch; whether Orca's worktree list then drops the entry is unverified. Delete a merged branch's remote ref separately, when `deleteMergedBranch` allows it:

```text
gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>
```

## Host limit

`worker-list` without `--run` (the limit is machine-wide, other runs count) rows whose terminal state is active count against `hostWorkerLimit`. Count before every `worker-start`.
