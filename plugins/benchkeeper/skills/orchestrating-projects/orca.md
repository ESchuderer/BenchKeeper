# Orca commands

Orca is the runner this skill drives. `ORCA` stands for the executable the session resolved and used for `ORCA skills get orchestration`; substitute it, do not run `ORCA` literally. Load that guide first: it is the version-matched source for the commands and states below. Prefer `--json`.

## Start the run

```text
ORCA orchestration run-create --objective "issue work: <project names>" --json
ORCA orchestration worker-start --spec "$(cat <filled spec file>)" --worktree new-top-level --repo path:<project path> --base-branch <default branch> --name <number>-<slug> --agent <claude|codex> --json
```

One `worker-start` per project in the wave, with no permission-bypass flag in `--extra-agent-args` or elsewhere. Write the filled spec to a file in the run folder and pass it through the quoted expansion above, so issue text is never read by the shell. Keep the returned dispatch id per worker with its project, issue and branch name (the spec's `<type>/<number>-<slug>`); every later command takes the dispatch id. `worker-show` gives the worktree path. A non-zero exit means no worker; read `failedStage` and `residualResources` before trying again.

Branch check before each `worker-start`: `git -C <project path> ls-remote --heads origin <branch>`, `git -C <project path> worktree list` and `gh pr list -R <owner/repo> --head <branch> --state open`. When one shows the branch and its worker is still held in this run, send the follow-up to it instead of starting another:

```text
ORCA orchestration send --to dispatch:<dispatch id> --subject "Follow-up" --body "$(cat <follow-up file>)" --json
```

Acknowledgement: the worker's first heartbeat. With none within 60 seconds, read `worker-read` once; when it shows no agent turn, `worker-stop` it and start one replacement with `worker-start --retry-of <dispatch id>` and the same spec file. A second miss goes to the owner.

## Worker reports

A worker settles with one message. The skill's outcomes map to Orca like this:

| Outcome | Message from the worker |
|---|---|
| DONE, and no change needed | `--type worker_done --outcome succeeded` |
| BLOCKED | `--type worker_done --outcome failed` with a subject that starts `BLOCKED:`, after an issue comment |
| NEEDS_REPLAN | `--type worker_done --outcome failed` with a subject that starts `NEEDS_REPLAN:` |
| failed | `--type worker_done --outcome failed`, any other subject |

Orca has no separate blocked or replan message type: such a report is a `worker_done` that failed, which settles the dispatch so the coordinator can release it.

The handoff block is the file the message names with `--report-path`, or its body. The worker's start message carries its own `send` command; the spec only says what to report.

## Watch

```text
ORCA orchestration check --wait --types "worker_done,escalation,question" --timeout-ms <stallMinutes / 2 in ms, at least 60000> --json
ORCA orchestration worker-list --run <run_id> --json
ORCA orchestration worker-show --dispatch <dispatch id> --json
ORCA orchestration worker-read --dispatch <dispatch id> --limit 50 --json
gh pr list -R <owner/repo> --head <branch> --state merged --json number,title,mergedAt
```

Claude Code runs the `check --wait` as a background command and is woken when it exits; an agent that cannot (wake mode `unsupported`) runs it in the foreground. Never loop it faster than once a minute. Rolling waits stop at the run's deadline (55 minutes unless the owner named another).

At each wake-up, including an empty one: `worker-list` for state (act on each row's `projection.attention.requiresAction` and run its literal `projection.nextAction`), then `gh pr list` for merged PRs, then the stall check. A wake-up that runs none of them lets a failed or finished worker go unseen. Acknowledge a delivery only after its outcome is handled (`check --ack <delivery_id>`).

Liveness, in the guide's terms: `ready` or `unverifiable` is absence, not proof. A worker blocked by a hook or waiting at a prompt stays `ready`, so a state watcher never fires for it. For the stall check, compare the time of the last commit on its branch, its PR and its last message with `stallMinutes`; when exceeded, `worker-read` its last output. Proof that it stopped without a report is a final agent turn that ended with no `worker_done`. Then:

```text
ORCA orchestration worker-stop --dispatch <dispatch id> --json
```

and handle it as blocked; run the `nextAction` that `worker-list` gives for the stopped dispatch before releasing it. Without that proof, keep waiting.

## Clean up

```text
ORCA orchestration worker-release --dispatch <dispatch id> --json
ORCA worktree rm --worktree path:<worktree path> --run-hooks --json
```

`--run-hooks` runs the project's `orca.yaml` archive script before the removal; the one BenchKeeper's project setup writes removes the worktree's dev containers and exits 0 even when that fails, so the removal goes ahead. After the removal, list and remove what is left (`podman ps -aq --filter label=devcontainer.local_folder=<worktree path>`, or `docker`) and remove those containers with `rm -f`.

A worker whose terminal a person typed in (its `worker-read` output shows input no `send` carried) is kept: `ORCA orchestration worker-retain --dispatch <dispatch id> --json`, no stop, no release, no worktree removal. Never type into a worker terminal or answer a dialog in it; Orca's `send` is the only way in.

Release only a settled worker, so stop an idle worker that sent no report before releasing it. `worker-read` still returns a released worker's output. `ORCA worktree rm` also tries to delete the checked-out local branch (Orca keeps it when it predates the worktree or its changes are not provably merged). Run it only after a merged PR with `deleteMergedBranch` true. Never remove a blocked worker's worktree. In the other cases (no merge allowed, `deleteMergedBranch` false) remove the worktree with `git -C <project path> worktree remove <worktree path>`, which leaves the branch; whether Orca's worktree list then drops the entry is unverified. Delete a merged branch's remote ref separately, when `deleteMergedBranch` allows it:

```text
gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>
```

Before the coordinator turn ends, `ORCA orchestration worker-list --run <run id> --terminal-state reclaimable --json` returns no worker: each settled one is released, retained or removed above. `worker-release` removes no worktree, so a worktree still listed by `ORCA worktree list` after its worker settled is the step above not run.

## Host limit

The limit is machine-wide, and `worker-list` covers one run (the bound one unless `--run` is given). Count the rows whose terminal state is active in every run that `ORCA orchestration run-list` shows, before every `worker-start`.

## Scheduled runs

```text
ORCA automations create --name <name> --trigger <cron> --provider <claude|codex> --repo path:<coordinator project> --precheck "node <skill folder>/precheck.mjs <project paths>" --prompt "<the skill invocation>" --json
ORCA automations runs --id <automation id> --limit 5 --json
```

The precheck's exit 0 starts the run; any other exit records a skipped run (`status` `skipped_precheck`). Without `--workspace`, Orca makes a new worktree per run, which is the disposable worktree an unattended run needs. Leave out `--reuse-session`. One live session per automation: the scheduled session first lists `automations runs` and ends at once when an earlier run of the same automation still has a live terminal. Which `status` values mean a run is still going is unverified; read `terminalPtyId` and the terminal's state instead.
