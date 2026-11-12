# Orca commands

Orca is the runner this skill drives. `ORCA` stands for the executable the session resolved and used for `ORCA skills get orchestration`; substitute it, do not run `ORCA` literally. Load that guide first: it is the version-matched source for the commands and states below. This file only maps the skill's steps onto them. Prefer `--json`.

## Start the run

```text
ORCA orchestration run-create --objective "issue work: <project names>" --json
ORCA orchestration worker-start --spec-file <filled spec file> --worktree new-top-level --repo path:<project path> --base-branch <default branch> --name <number>-<slug> --agent <claude|codex> --model "<model>" --effort <effort> --keep-open --json
```

One `worker-start` per worker, a batch being one worker, with no permission-bypass flag in `--extra-agent-args` or elsewhere. Write the filled spec to a file in the run folder and pass that file with `--spec-file`, so issue text is never read by the shell. `--model` and `--effort` take the model and effort of the spec's `Agent:` line, the model in quotes as the reader printed it; leave out what that line gives as the agent default, and `--effort` whenever `--model` is left out (it needs `--model`). Orca hands the model id to the agent as it is. That a Claude Code alias such as `opus` is accepted there is unverified: when `worker-start` refuses the model, start without `--model` and `--effort` and say so in the report. `--name` takes the first issue of a batch. `--keep-open` keeps the worker's terminal after its report, so that a follow-up reaches the session that did the work while its pull request is in review or merge: a settled worker that is not kept open is released by Orca itself (`autoReleaseAt` in `worker-show`). `worker-release` ends it ([Clean up](#clean-up)); a worker started without the flag gets the same from `ORCA orchestration worker-keep-open --dispatch <dispatch id> --json`. Keep the returned dispatch id and task id per worker with its project, issues and branch names (the spec's `<type>/<number>-<slug>`); every later command takes the dispatch id. `<branch>`, `<default branch>` and `<owner/repo>` in this file are the names of that spec. `worker-show` gives the worktree path. A non-zero exit means no worker; read `failedStage` and `residualResources` before trying again.

Branch check before each `worker-start`, for the branch of each issue: `git -C <project path> ls-remote --heads origin <branch>`, `git -C <project path> worktree list` and `gh pr list -R <owner/repo> --head <branch> --state open --json number,isCrossRepository`, where a row with `isCrossRepository` true does not count: anyone can open a pull request from a fork under that branch name. When one shows the branch and its worker is still held in this run, send the follow-up to it instead of starting another:

```text
ORCA orchestration send --to dispatch:<dispatch id> --subject "Follow-up" --body "$(cat <follow-up file>)" --json
```

By Orca's guide, a worker that already reported gets the follow-up as a task of its own and settles it with another `worker_done`; the receipt of `send` says which case it was. Such a follow-up counts like a start ([Host limit](#host-limit)).

Acknowledgement: the worker's first heartbeat. A missing one sends no mail, so a Claude Code coordinator creates a one-shot session cron (`recurring: false`) two minutes after starting workers, whose prompt runs this check. With no heartbeat within 60 seconds, read `worker-read` once; when it shows no agent turn, `worker-stop` it and start one replacement. A retry takes the task in place of the spec and inherits no other option, so it repeats them, in the stopped worker's worktree (its path is in `worker-show`):

```text
ORCA orchestration worker-start --task <task id> --retry-of <dispatch id> --worktree path:<worktree path> --agent <claude|codex> --model "<model>" --effort <effort> --keep-open --json
```

These flags are from Orca's help; that the retry then runs in that worktree is not tried: unverified. A second miss goes to the owner.

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

A worker answers a follow-up with one `--type status` message that names the head commit it pushed. That id is a claim: read `<head>` yourself ([review-and-merge.md](review-and-merge.md)).

## Questions

A worker asks with `ORCA orchestration ask --question <text>`, which returns at once: the worker ends its turn and Orca wakes it with the answer. The question arrives as a `question` message. Answer it as the skill's Rules say, by its message id, with the answer in a file:

```text
ORCA orchestration reply --id <message id> --body "$(cat <answer file>)" --json
```

The answer's sources are the default branch's: the policy as the reader prints it now, and `AGENTS.md` read in a scratch clone as [review-and-merge.md](review-and-merge.md#scratch-clone) reads it. An issue without a pull request has no clone yet: make one for the answer, with the two commands of that section.

## Watch

```text
ORCA orchestration check --types "worker_done,escalation,question,status" --json
ORCA orchestration check --wait --types "worker_done,escalation,question,status" --timeout-ms <stallMinutes / 2 in ms, at least 60000> --json
ORCA orchestration worker-list --run <run_id> --json --full
ORCA orchestration worker-show --dispatch <dispatch id> --json
ORCA orchestration worker-read --dispatch <dispatch id> --limit 50 --json
gh pr list -R <owner/repo> --head <branch> --state merged --json number,title,mergedAt
```

Orca wakes the coordinator when mail arrives, a `worker_done`, an `escalation` or a `question`, whatever its agent. A `status` message wakes it too: observed (its terminal is told "You have 1 orchestration message"), not documented, so the next wake-up reads it at the latest. A Claude Code coordinator ends the turn after starting or messaging workers and keeps the stall-check cron that the skill's Waiting section describes, on minutes off the hour (`3-59/10 * * * *` for a `stallMinutes` of 20), so a silent worker is seen without mail. That cron fires only while the session is idle and survives `/clear`. It expires after 7 days: at a wake, create it again when `CronList` no longer shows it, and name its expiry date in the report of each wake, because a run that only waits for new issues (`keepRunning`) gets no wake once it expired, and the owner then restarts the run. Delete it (`CronDelete`) when the run closes. The coordinator never polls and never runs `check --wait` in the background: a background wait keeps a task alive at every turn end, so the plugin never clears an idle coordinator. An agent with no background wake (wake mode `unsupported`, for example Codex) has no such cron: it runs the `check --wait` in the foreground, never looped faster than once a minute. A wait's deadline ([SKILL.md](SKILL.md#waiting)) is checked at a wake: it is a point to report at and ends no run.

At each wake-up, including an empty one: `worker-list` for state, with `--full` because the concise rows carry no `projection`, then `gh pr list` for merged PRs, then the stall check, then the next step of each pull request that waits for its checks or its default-branch watch ([review-and-merge.md](review-and-merge.md#merge)). For a row whose `projection.attention.requiresAction` is true, run `ORCA` with its `projection.nextAction.argv` only when that command is `worker-read` or `worker-show`, or `worker-release` for a worker that the release rule lets go ([Clean up](#clean-up)): one whose pull request is in review or merge stays, whatever the row asks. Any other next action goes in the report. A wake-up that runs none of them lets a failed or finished worker go unseen. Acknowledge a delivery only after its outcome is handled (`check --ack <delivery_id>`).

Liveness, in the guide's terms: `ready` or `unverifiable` is absence, not proof. A worker blocked by a hook or waiting at a prompt stays `ready`, so a state watcher never fires for it. For the stall check, compare the time of the last commit on its branch, its PR and its last message with `stallMinutes`; when exceeded, `worker-read` its last output. Proof that it stopped without a report is a final agent turn that ended with no `worker_done`. Then:

```text
ORCA orchestration worker-stop --dispatch <dispatch id> --json
```

and handle it as blocked; act on the `nextAction` that `worker-list` gives for the stopped dispatch, by the rule above, before releasing it. Without that proof, keep waiting.

## A permission dialog

At the stall check, with `permissionPrompts` `decline`, decline a permission dialog of a Claude Code worker, only from Bash or Zsh (below), and only when both of these show it:

```text
ORCA orchestration worker-show --dispatch <dispatch id> --json --full
ORCA orchestration worker-read --dispatch <dispatch id> --source terminal --limit 50 --json
```

`worker-show` must report an `observation.agentWait`: Orca saw the worker parked at a prompt only a person can answer. Null means it saw none, and a missing field that it did not look: neither is a dialog. The terminal read is the screen, not the transcript, and must show a tool call waiting for approval, not a trust dialog, a login or a question; a read Orca refuses means no terminal, so no decline. Then send one Escape, `<terminal>` being `terminal.handle` of that `worker-show`:

```text
ORCA terminal send --terminal <terminal> --text $'\x1b'
```

`$'\x1b'` is the Escape byte in Bash and Zsh only (`ORCA terminal send --help` names the two). A shell without that quoting, dash for example, hands Orca the characters `$\x1b`, and Orca would type them into the dialog. So decline only when the shell that runs your commands is one of the two: `echo "$BASH_VERSION$ZSH_VERSION"`, run the way you run the `send`, prints a version number there, and an empty line or its own text in another shell. From any other shell send nothing: the worker stays blocked for the owner. The command takes no `--enter`: with it Orca makes the Escape inert. Send nothing else to the terminal, no Enter, letter, number or text. Then read the terminal again with the `worker-read` above. While the dialog still shows, send nothing more: the worker is blocked for the owner. That Escape declines the call is observed for Claude Code, not documented: unverified. Once the dialog is gone, send the message that names the declined call and tells the worker to change the approach or report BLOCKED (it also restarts a turn the Escape interrupted):

```text
ORCA orchestration send --to dispatch:<dispatch id> --subject "Declined" --body "$(cat <message file>)" --json
```

A worker on another agent stays `block`: its declining key is unverified.

## Resume

The plugin hands the handoff file back after a clear or compaction only in the Orca terminal its `Terminal:` line names, for a Claude Code or a Codex coordinator. Its own clear of an idle Claude Code coordinator comes above the plugin option `rotateAtTokens`, 200,000 tokens by default; `rotateAtPercent` above 0 sets a percent of the context window instead, and both at 0 turn it off. The file's Resume section holds these steps, in this order, the run id filled in:

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

Release only a settled worker, so stop an idle worker that sent no report before releasing it. A worker with a pull request is released after the merge, or once the pull request is left for the owner, not before: the release also ends `--keep-open`. `worker-read` still returns a released worker's output. `ORCA worktree rm` also tries to delete the checked-out local branch (Orca keeps it when it predates the worktree or its changes are not provably merged). Run it only with `deleteMergedBranch` true, and while `git -C <worktree path> branch --show-current` prints a branch of the spec whose pull request is merged: a batch's worktree holds one of several. Never remove a blocked worker's worktree. In the other cases (no merge allowed, `deleteMergedBranch` false, another or an unmerged branch checked out) remove the worktree with `git -C <project path> worktree remove <worktree path>`, which leaves the branch; whether Orca's worktree list then drops the entry is unverified. Delete a merged branch's remote ref separately, when `deleteMergedBranch` allows it, and only while it still points at the merged head:

```text
gh pr view <n> -R <owner/repo> --json state,headRefOid
gh api repos/<owner>/<repo>/git/ref/heads/<branch> --jq .object.sha
gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>
```

`state` must be `MERGED` and the ref read must print that `headRefOid`; otherwise the branch stays and the report names it, unless the branch is already gone (GitHub deletes head branches itself where the repository says so). A commit pushed between the read and the delete goes with the branch. Not a `git push --force-with-lease`, which would close that gap: the guard hook denies it as a force push, and it runs the `pre-push` hook of the git directory workers share.

A batch's other merged branches are checked out nowhere once the worktree is gone. With `deleteMergedBranch`, delete each local one only while it still is the head of its merged pull request `<n>`, so that no commit is lost:

```text
gh pr view <n> -R <owner/repo> --json state,headRefOid
git -C <project path> rev-parse refs/heads/<branch>
git -C <project path> branch -D <branch>
```

`state` must be `MERGED` and `rev-parse` must print that `headRefOid`; otherwise the branch stays and the report names it. `-D`, because a squash merge leaves the branch unmerged for git.

Before the coordinator turn ends, `ORCA orchestration worker-list --run <run id> --terminal-state reclaimable --json` returns no worker. The same list with `--terminal-state retained` shows the kept-open workers ([Host limit](#host-limit)): each settled one in it (`outcome` other than `in_progress`) has a pull request in review or merge, or a terminal a person typed in. Every other settled worker is released, retained or removed above. `worker-release` removes no worktree, so a worktree still listed by `ORCA worktree list` after its worker settled is the step above not run.

## Host limit

The limit is machine-wide, and `worker-list` covers one run (the bound one unless `--run` is given). Count the rows whose `outcome` is `in_progress` in every run that `ORCA orchestration run-list` shows, before every `worker-start`: a kept-open worker's terminal state is `retained` also while it works (observed with Orca 1.4.254), so that state does not tell the working ones.

A follow-up puts a worker that already reported back to work, so it counts like a start for `hostWorkerLimit` and `workersPerProject`: count before that `send` too. When a cap is full the follow-up waits, and no `worker-start` in that project (for `hostWorkerLimit`: on the machine) comes before its `send` ([SKILL.md](SKILL.md#loop), step 5): otherwise steady new issues keep the slot, and the pull request never merges. Whether such a worker's row shows `in_progress` again is unverified: count each worker with a follow-up it has not answered yet as working, whatever its row says.

## Scheduled runs

```text
ORCA automations create --name <name> --trigger <cron> --provider <claude|codex> --repo path:<coordinator project> --precheck "node <skill folder>/precheck.mjs <project paths>" --prompt "<the skill invocation>" --json
ORCA automations runs --id <automation id> --limit 5 --json
```

The precheck's exit 0 starts the run; any other exit records a skipped run (`status` `skipped_precheck`). To see why it starts nothing in a project, run `node <skill folder>/policy.mjs <project path>`: it prints the effective policy, or with exit 1 the policy's errors. Without `--workspace`, Orca makes a new worktree per run, which is the disposable worktree an unattended run needs. Leave out `--reuse-session`. One live session per automation: the scheduled session first lists `automations runs` and ends at once when an earlier run of the same automation still has a live terminal. Which `status` values mean a run is still going is unverified; read `terminalPtyId` and the terminal's state instead.
