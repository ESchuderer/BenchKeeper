# Orca commands

Orca is the runner this skill drives. `ORCA` stands for the executable the session resolved and used for `ORCA skills get orchestration`; substitute it, do not run `ORCA` literally. Load that guide first: it is the version-matched source for the commands and states below. This file only maps the skill's steps onto them. Prefer `--json`.

## Start the run

```text
ORCA orchestration run-create --objective "issue work: <project names>" --json
ORCA orchestration worker-start --spec-file <filled spec file> --worktree new-top-level --repo path:<project path> --base-branch <default branch> --name <number>-<slug> --agent <claude|codex> --model "<model>" --effort <effort> --json
```

One `worker-start` per worker, a batch being one worker, with no permission-bypass flag in `--extra-agent-args` or elsewhere. Write the filled spec to a file in the run folder and pass that file with `--spec-file`, so issue text is never read by the shell. `--model` and `--effort` take the model and effort of the spec's `Agent:` line, the model in quotes as the reader printed it; leave out what that line gives as the agent default, and `--effort` whenever `--model` is left out (it needs `--model`). Orca hands the model id to the agent as it is. That a Claude Code alias such as `opus` is accepted there is unverified: when `worker-start` refuses the model, start without `--model` and `--effort` and say so in the report. `--name` takes the first issue of a batch. Keep the returned dispatch id per worker with its project, issues and branch names (the spec's `<type>/<number>-<slug>`); every later command takes the dispatch id. `<branch>`, `<default branch>` and `<owner/repo>` in this file are the names of that spec, never names read from a pull request or the remote. `worker-show` gives the worktree path. A non-zero exit means no worker; read `failedStage` and `residualResources` before trying again.

Branch check before each `worker-start`, for the branch of each issue: `git -C <project path> ls-remote --heads origin <branch>`, `git -C <project path> worktree list` and `gh pr list -R <owner/repo> --head <branch> --state open`. When one shows the branch and its worker is still held in this run, send the follow-up to it instead of starting another:

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

Orca has no separate blocked or replan message type: such a report is a `worker_done` that failed, which settles the dispatch so the coordinator can release it. The handoff block is the file the message names with `--report-path`, or its body. The worker's start message carries its own `send` command; the spec only says what to report.

A batch also sends one `--type status` message per issue, when that issue's pull request is up or the issue ended another way, with the issue's handoff block as its body; its `worker_done` comes once, after the last issue.

## Questions

A worker asks with `ORCA orchestration ask --question <text>`, which returns at once: the worker ends its turn and Orca wakes it with the answer. The question arrives as a `question` message. Answer at the next wake, only from what is written: trusted-author text of the issue, the policy, `AGENTS.md` and recorded decisions. A question those do not settle is the owner's: put it to the owner as the skill's Rules say, and answer "parked", which tells the worker to take the safest reversible option marked "pending owner decision", or to report BLOCKED when there is none. Record each answer as a decision in the handoff file. Reply by the message id, with the answer in a file:

```text
ORCA orchestration reply --id <message id> --body "$(cat <answer file>)" --json
```

## Watch

```text
ORCA orchestration check --types "worker_done,escalation,question,status" --json
ORCA orchestration check --wait --types "worker_done,escalation,question,status" --timeout-ms <stallMinutes / 2 in ms, at least 60000> --json
ORCA orchestration worker-list --run <run_id> --json
ORCA orchestration worker-show --dispatch <dispatch id> --json
ORCA orchestration worker-read --dispatch <dispatch id> --limit 50 --json
gh pr list -R <owner/repo> --head <branch> --state merged --json number,title,mergedAt
```

Orca wakes the coordinator when mail arrives, a `worker_done`, an `escalation` or a `question`, whatever its agent. A `status` message wakes it too: observed (its terminal is told "You have 1 orchestration message"), not documented, so the next wake-up reads it at the latest. A Claude Code coordinator ends the turn after starting or messaging workers and keeps the stall-check cron that the skill's Waiting section describes, so a silent worker is seen without mail. It never polls and never runs `check --wait` in the background: a background wait keeps a task alive at every turn end, so the plugin never clears an idle coordinator. An agent with no background wake (wake mode `unsupported`, for example Codex) has no such cron: it runs the `check --wait` in the foreground, never looped faster than once a minute. The run's deadline (55 minutes unless the owner named another) is checked at a wake.

At each wake-up, including an empty one: `worker-list` for state (act on each row's `projection.attention.requiresAction` and run its literal `projection.nextAction`), then `gh pr list` for merged PRs, then the stall check. A wake-up that runs none of them lets a failed or finished worker go unseen. Acknowledge a delivery only after its outcome is handled (`check --ack <delivery_id>`).

Liveness, in the guide's terms: `ready` or `unverifiable` is absence, not proof. A worker blocked by a hook or waiting at a prompt stays `ready`, so a state watcher never fires for it. For the stall check, compare the time of the last commit on its branch, its PR and its last message with `stallMinutes`; when exceeded, `worker-read` its last output. Proof that it stopped without a report is a final agent turn that ended with no `worker_done`. Then:

```text
ORCA orchestration worker-stop --dispatch <dispatch id> --json
```

and handle it as blocked; run the `nextAction` that `worker-list` gives for the stopped dispatch before releasing it. Without that proof, keep waiting.

## A permission dialog

With `permissionPrompts` `decline`, decline a permission dialog of a Claude Code worker, and only after the stall check's `worker-read` shows that dialog: a tool call waiting for approval, not a trust dialog, a login or a question. `<terminal>` is the worker's `terminal` in `worker-list --json`.

```text
ORCA terminal send --terminal <terminal> --text $'\x1b'
ORCA orchestration send --to dispatch:<dispatch id> --subject "Declined" --body "$(cat <message file>)" --json
```

The first command sends one Escape (Bash and Zsh quoting) and takes no `--enter`: with it Orca makes the Escape inert. Send nothing else to the terminal, no Enter, letter, number or text. The message names the declined call and tells the worker to change the approach or report BLOCKED; it also restarts a turn the Escape interrupted because no dialog was open. That Escape declines the call is observed for Claude Code, not documented: unverified. When the next `worker-read` does not show the call declined, send nothing more: the worker is blocked for the owner. A worker on another agent stays `block`: its declining key is unverified.

## Resume

The plugin hands the handoff file back after a clear or compaction only in the Orca terminal its `Terminal:` line names, for a Claude Code or a Codex coordinator. Its Resume section holds these steps, in this order, the run id filled in:

1. `ORCA orchestration check --json`, always first: it returns the mail that arrived meanwhile. Orca types a wake only once per unread message, and a wake can merge into the resume prompt.
2. When it says no run is bound: `ORCA orchestration run-use --id <run id> --json`, then `check` again.
3. `ORCA orchestration run-current --json`
4. `ORCA orchestration task-list --ready --brief --json`
5. `ORCA orchestration inbox --terminal run:<run id> --limit 50 --json`: the mail already handled.
6. Claude Code only: `CronList`; when it no longer shows the run's stall-check cron (a restarted process loses it, and it expires after 7 days), create it again as at run start.

## Clean up

```text
ORCA orchestration worker-release --dispatch <dispatch id> --json
ORCA worktree rm --worktree path:<worktree path> --run-hooks --json
```

`--run-hooks` runs the project's `orca.yaml` archive script before the removal; the one BenchKeeper's project setup writes removes the worktree's dev containers and exits 0 even when that fails, so the removal goes ahead. After the removal, list what is left (`podman ps -aq --filter label=devcontainer.local_folder=<worktree path>`, or `docker`) and remove those containers with `rm -f`.

A worker whose terminal a person typed in (its `worker-read` output shows input no `send` carried) is kept: `ORCA orchestration worker-retain --dispatch <dispatch id> --json`, no stop, no release, no worktree removal. The coordinator's own Escape ([A permission dialog](#a-permission-dialog)) does not make a terminal a person's. Never type anything else into a worker terminal or answer a dialog in it; Orca's `send` is the only way in.

Release only a settled worker, so stop an idle worker that sent no report before releasing it. `worker-read` still returns a released worker's output. `ORCA worktree rm` also tries to delete the checked-out local branch (Orca keeps it when it predates the worktree or its changes are not provably merged). Run it only after a merged PR with `deleteMergedBranch` true, and while `git -C <worktree path> branch --show-current` prints the spec's branch. Never remove a blocked worker's worktree. In the other cases (no merge allowed, `deleteMergedBranch` false, another branch checked out) remove the worktree with `git -C <project path> worktree remove <worktree path>`, which leaves the branch; whether Orca's worktree list then drops the entry is unverified. Delete a merged branch's remote ref separately, when `deleteMergedBranch` allows it:

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

The precheck's exit 0 starts the run; any other exit records a skipped run (`status` `skipped_precheck`). To see why it starts nothing in a project, run `node <skill folder>/policy.mjs <project path>`: it prints the effective policy, or with exit 1 the policy's errors. Without `--workspace`, Orca makes a new worktree per run, which is the disposable worktree an unattended run needs. Leave out `--reuse-session`. One live session per automation: the scheduled session first lists `automations runs` and ends at once when an earlier run of the same automation still has a live terminal. Which `status` values mean a run is still going is unverified; read `terminalPtyId` and the terminal's state instead.
