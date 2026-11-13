# Coordinator workflow: where each rule lives

A coordinator run needs rules for models, reviews, merges, owner-only changes, batches and worker conduct. This note gives each rule one home (a policy field, skill text, the worker rule file or an agent default), so that a project gets the same run by installing the plugin and committing its policy, its worker rules and its Claude Code settings.

This is the design. The State column says what exists and which change adds the rest ([Changes](#changes)); each change updates that column and the line references it moves. The rules come from a coordinator run over several repositories from 2026-11-04 to 2026-11-11, called "the source run" below. File names are relative to `plugins/benchkeeper/`, except those that start with `app/`, `packages/` or `docs/` and `release-please-config.json`, which are from the repository root; `SKILL.md` without a folder is `skills/orchestrating-projects/SKILL.md`, and `spec-template.md`, `orca.md`, `review-and-merge.md` and `approvals.md` are in the same folder.

## What a project commits

| File | Holds | Written by | State |
|---|---|---|---|
| `docs/agents/orchestration.json` | the policy: what the coordinator may start and merge, with which models and review depth | project setup, with the defaults and no `startLabel`, so nothing starts until the owner names one; the owner edits it | exists (`app/src/steps/project.mjs:683`) |
| `docs/agents/worker-rules.md` | the project's own rules for workers, added to the plugin's | project setup, empty; the owner edits it | exists (`app/src/steps/project.mjs:684`) |
| `.claude/settings.json` | the Claude Code settings of every session in the project | project setup, which writes the guards today and enables the plugin at project scope with change 8 (see [Project settings and drift](#project-settings-and-drift)) | guards exist; change 8 waits for the owner |

The coordinator reads the first two from the default branch, as it reads the policy today (`SKILL.md:17`), and never merges a pull request that changes one of them ([Owner-only](#owner-only)), so a worker cannot loosen its own rules.

The plugin's `rules/worker.md` always applies, and the project's file only adds to it. The plugin's rules are not copied into the project: a copy either goes stale and replaces newer rules, or loses the owner's edits at the next update, and no record in another clone says which. The project names the plugin it needs with `minPlugin` instead.

## Policy version 2

Version 2 adds optional fields to version 1 and changes none (`SKILL.md:19-40`). A version 1 file stays valid and means the defaults below. Fields are read by name, whatever the file's `schemaVersion`, so a narrowing field also binds in a file that does not say 2. The marker serves older apps: setup and the example write 2, and an older app's policy editor refuses such a file instead of ignoring its new fields; a file that keeps 1 and adds new fields gets no such refusal.

One reader script beside `precheck.mjs` prints the effective policy of a project: the file from the default branch, defaults filled in. The coordinator and `precheck.mjs` both take the policy from it, so a model never interprets the JSON itself. A file the schema rejects, or a `schemaVersion` the reader does not know, starts and merges nothing in that project, and the reader names each error. A key the schema does not name, at any nesting level, is such an error, except one that starts with `//`, which is a comment: a misspelled field never silently means its default.

A plugin from before the reader reads the JSON itself and knows none of the new fields, so the narrowing ones do not bind it and `minPlugin` cannot stop it. The app's `doctor` compares the installed plugin's content version with the policy's `minPlugin` and says so (`coordinatorChecks`, `app/src/doctor.mjs:96`).

A path entry names a file or a folder, relative to the repository root, and covers that path and everything below it, with or without a closing `/`. There are no globs.

| Field | Meaning | Without the field | Source run |
|---|---|---|---|
| `models.worker` | `{ "model", "effort" }` of every worker session of this project | by the task's tier: quick `sonnet`, standard and full `opus`, research `fable`, each at `high`; a sensitive change counts as full | `fable` in five named projects, by tier in the others |
| `models.phases.<phase>` | `{ "model", "effort" }` of a phase subagent: `plan`, `implement`, `test`, `review`, `research` | plan, implement and review `opus`, test `sonnet`, research `fable`, each at `high` (the aliases of `skills/workflow/software.md:15-18` and `skills/workflow/research.md:7`, the effort of `agents/<phase>.md:6`) | those defaults; `inherit` in the `fable` projects |
| `review.depth` | the level of Claude Code's `/code-review` for a routine change: `low`, `medium`, `high` or `xhigh` | `high` | `high` |
| `review.sensitiveDepth` | that level for a sensitive change, which also gets a security review | `high` | `xhigh` |
| `review.sensitivePaths` | paths that make a change sensitive, besides the built-in classes | none | per project |
| `merge.mode` | `strict` or `disjoint` (see [Merge](#merge)) | `strict` | `disjoint` |
| `merge.additivePaths` | paths the pull request and the default branch may both have changed in `disjoint` mode | none | registries and generated schemas |
| `merge.ownerOnlyPaths` | further paths whose pull requests are left for the owner, besides the built-in ones ([Owner-only](#owner-only)) | none | none |
| `issuesPerWorker` | pickable issues of this project that one worker takes, oldest first | 1 | up to 5 |
| `keepRunning` | the run stays open for this project and picks up issues labeled later | false | true |
| `permissionPrompts` | `block` or `decline` (see [Reconciliations](#reconciliations)) | `block` | `decline` |
| `minPlugin` | the oldest plugin version that may run this policy | any | none |
| `issues.repository`, `issues.labels` | the tracker repository, and labels an issue must carry besides `startLabel` (see [The issue source](#the-issue-source)) | the project's own repository, no further label | one tracker, a label per project |

Models are named by Claude Code's aliases, which Claude Code moves to newer versions ([model configuration](https://code.claude.com/docs/en/model-config)). `models.worker` also takes a full model name, where an alias lags or a measurement must stay reproducible. A phase takes an alias or `inherit`, the worker's own model, which is how a full model name reaches a phase: a subagent call takes an alias only ([sub-agents](https://code.claude.com/docs/en/sub-agents)). The coordinator's own reviewer is no subagent of the worker: for it `inherit` means the model that pull request's worker was started with when that is an alias, else `opus`. The defaults apply to Claude Code workers. A worker on another agent runs that agent's default unless the policy names a model. The coordinator estimates the tier from the issue with the workflow skill's change-type table only to choose the model; the worker still classifies its own work. The coordinator's own model is the one its session was started with, so the policy does not name it.

`review.depth` is independent of `models.phases.review`, which names the reviewer's model and effort. An agent without `/code-review` runs the review passes of `skills/workflow/software.md:8`, where the depth only decides whether the security pass runs. `max` is not a policy value: that depth runs only when the owner asks for it in the session.

Every default effort and review level is `high`, sensitive work included, which keeps its security review. `xhigh` runs only on the owner's request, in the policy or in the session, because of what it costs (owner, 2026-11-11).

A change is sensitive when its diff touches a `review.sensitivePaths` entry or an owner-only path, or when it belongs to a risky class of the workflow skill (`skills/workflow/SKILL.md:23`) or changes CI, guards, data formats, money, what agents are told and allowed (`AGENTS.md`, `.claude`, `docs/agents`), or what runs on the host for a worktree or a trial (`orca.yaml`, `.devcontainer`). A change the reviewer cannot place is sensitive.

## Rules and their homes

### Models

| Rule | Home | State |
|---|---|---|
| The worker's model and effort follow the task, leaning to the stronger model | policy `models.worker`, its default table in `SKILL.md`, the `Agent:` line of the spec (`spec-template.md:25`) | exists |
| A strong model only in named projects | each project's own policy names `models.worker` | exists |
| Each phase has its model and effort | the workflow skill names each phase's alias where it starts the phase (`skills/workflow/software.md:15-18` for the four phases of a change) and the session passes it in the call. The agent files then say `inherit` (`agents/<phase>.md:5`), so a phase the policy sets to `inherit` runs on the worker's model. Policy `models.phases`, passed in the spec's Flow line | exists |
| Implementation runs at `high` on security, data formats, guards and money too: a call raises the effort only where the spec or the user names one | skill text (`skills/workflow/software.md:13`) | exists |
| Mechanical reading (log and CI output, inventories) may run on `haiku`, which never edits | skill text, step 5 of `skills/workflow/SKILL.md` | exists |
| A decision in the owner's place, a design trade-off and a legal or security call go to a subagent on `fable`, and the coordinator checks its answer | skill text, Rules of `SKILL.md` | exists |
| Reports name the concrete model behind each alias, and a worker's report names each phase it ran, the loops back and the tokens where its session shows them | the coordinator's handoff file (`SKILL.md:67`); `Models:` and `Phases:` lines in the worker's handoff block (`spec-template.md:55-56`) | exists |

### Review

| Rule | Home | State |
|---|---|---|
| Depth by change class: `review.depth` for a routine change, `review.sensitiveDepth` plus a security review for a sensitive one, both `high` by default; the report names the depth and why. The level is always passed: `/code-review` without one reuses the level typed last on that machine (the command's own description in Claude Code 2.1.316) | policy `review.*`; a `Review:` line in the spec for the worker's own review (`spec-template.md:18`, `skills/workflow/software.md:8`); the coordinator's review step (`review-and-merge.md:43`, `review-and-merge.md:51`) | exists |
| A fresh reviewer per pull request that did not write the change gets the issue, its acceptance criteria, the decisions that apply and the diff, and reads implementer statements as claims | agent default (`agents/review.md:11`); the coordinator starts it per pull request (`review-and-merge.md:49`), where before change 3 it verified the diff itself | exists |
| The reviewer and the coordinator read a pull request in a clone made with `--no-checkout` in the coordinator's run folder, through git only (`diff`, `show <head>:<path>`, `grep`): no file of the pull request is on disk for a session to load as instructions, no session starts there, and no worker's sandbox can write the folder, as it can the temporary folder | skill text (`review-and-merge.md:12-32`) | exists |
| Blocking and Important findings are settled and reviewed again; Minor ones are listed | skill text (`skills/workflow/full-tier.md:14`); the coordinator sends findings to the owning worker as a follow-up (`review-and-merge.md:80`) | exists |
| Every fix after a review gets a scoped re-review of the changed lines. A push to the branch after the review is such a fix, whoever made it | skill text (`skills/workflow/full-tier.md:14` has the scoped re-review, `review-and-merge.md:81` the coordinator's) | exists |
| Two rounds with findings: the phase that failed reruns on a stronger model. A third failing round is a question for the owner, never a fourth try | skill text (`skills/workflow/full-tier.md:14` has the ladder for a worker's own review, `review-and-merge.md:82-83` for the coordinator's, `skills/workflow/software.md:20` the stronger model for a stuck phase) | exists |

The source run let a small fix after agreement (about 20 lines, with its test) merge without another round. That is not taken over: the merge is pinned to a head the reviewer read ([Merge](#merge)), and a scoped re-review reads only the changed lines.

A reviewer worker on another agent stays the option it is (`skills/workflow/full-tier.md:14`, default off): a review subagent has the same fresh context and uses no worker slot.

### Merge

The coordinator merges, never a worker (`spec-template.md:27`), and only where the policy allows (`SKILL.md:26`). The source run let a worker merge its own pull request after the review; that is not taken over, because the policy-bound coordinator is the narrower right.

| Rule | Home | State |
|---|---|---|
| `strict`: the head that merges contains the tip of the default branch, and the required checks are green on that head. Where it does not, the coordinator updates the branch with a merge of the default branch (`gh pr update-branch`), waits for the checks and tests again, until it holds. A conflict goes to the owning worker as a follow-up (`review-and-merge.md:113`) | policy `merge.mode`, skill text | exists |
| The merge is pinned to the reviewed head, or to a head reached from it by clean merges of the default branch only: each merge's first parent is the head accepted before it, its second parent is on the default branch, and its tree is the one `git merge-tree --write-tree` gives for those two parents. Any other head holds lines nobody reviewed, a worker's conflict resolution among them, and gets the scoped re-review first | `pin` in `merge-checks.mjs`, whose verdict the merge steps act on (`review-and-merge.md:111`) | exists |
| `disjoint`: when the default branch moved only by commits that share no file with the pull request, and a trial merge passes the project's changed-files check, the green head merges without another update; a pull request comment says so. The trial is the one step that checks files out and runs the pull request's code: it gets a clone of its own that serves nothing after (`review-and-merge.md:114-124`) | policy `merge.mode`, skill text; `next` in `merge-checks.mjs` says whether the head merges, is updated or gets the trial | exists |
| Shared files are tolerated in `disjoint` mode when all of them are under `merge.additivePaths` and the trial merge also regenerates the generated files with no diff | policy `merge.additivePaths`, skill text | exists |
| A data removal or a wide refactor merges `strict` in either mode: a consumer can break without a shared file | skill text | exists |
| The pull request title is checked against the project's convention, as the default branch's `AGENTS.md` has it, before the merge: the squash commit takes it | skill text | exists |
| Squash with that pin (`gh pr merge --squash --match-head-commit <sha>`, [gh manual](https://cli.github.com/manual/gh_pr_merge)), unless the default branch's `AGENTS.md` names another method. The coordinator passes the commit's subject (the checked title) and body (its own text) itself, so that neither a commit's title nor a closing keyword in a commit message lands unchecked | skill text | exists |
| One merge at a time per project; the default branch's CI is watched after each, and a red default branch is fixed before the next merge (`rules/project.md:11`). A queued run that a newer one replaced is covered by the newer one | skill text | exists |
| A branch is brought up to date by merging the default branch in, never by rebasing or force-pushing | spec (`spec-template.md:27`) for force-push; worker rule file (`rules/worker.md:7`) for rebase | exists |

### Owner-only

| Rule | Home | State |
|---|---|---|
| A pull request that changes an owner-only path is reviewed, marked ready and left open, and the report names it | the built-in paths and policy `merge.ownerOnlyPaths`; `ownerOnly` in `merge-checks.mjs` finds the files, a moved one at its old path too, and `unsafe` the paths no command can name, which leave the pull request for the owner the same way; skill text for what follows | exists |
| Settings, rulesets and secrets are never touched | skill text (`SKILL.md:42`) | exists |
| A worker creates no release, tag, package publish, repository, organization, token or GitHub App and changes no visibility; a pull request whose purpose is a release is left open | the spec's "You may not" line, skill text | exists |

Built-in owner-only paths and names (the owner's decision of 2026-11-11; there is no switch):

- All of `.github`, and `CODEOWNERS` and `docs/CODEOWNERS`. Workflows run the scripts and actions under `.github`, and the CODEOWNERS files say who must review.
- `docs/agents/orchestration.json` and `docs/agents/worker-rules.md`, the two files the coordinator takes its rights and rules from.
- `.claude` and `.mcp.json`, at any depth: a path with one of the two names as a segment, which the reader prints as `merge.ownerOnlyNames` beside the paths. Claude Code also loads the skills of a `.claude` folder below the root once a session works there ([skills](https://code.claude.com/docs/en/skills)); for `.mcp.json` the documentation names the project root only, and a nested one is included as the narrower reading. Settings, hooks, skills and agents there decide what every later worker may do, since workers start from the default branch, and a project's hook or MCP server runs in `claude -p` without a trust dialog (`docs/security.md:296-297`). Naming only the settings and hook files would not do: a project skill's `allowed-tools` and `hooks` and a project agent's `permissionMode` act the same way ([skills](https://code.claude.com/docs/en/skills), [sub-agents](https://code.claude.com/docs/en/sub-agents)).

Without these a worker's pull request could widen its own rights, and the coordinator would merge it (`docs/security.md:349` relies on the default branch for the same reason). They cannot be switched off, and a policy list only adds to them, so a silent policy means no here too. The cost is that every pull request under these paths waits for the owner.

### Batches

| Rule | Home | State |
|---|---|---|
| One worker takes up to `issuesPerWorker` pickable issues of its project, oldest first, one after another | policy `issuesPerWorker`; Pick and Spec in `SKILL.md`; the spec's `Issue:` line | exists |
| One branch and one pull request per issue; the issue sizes the pull request | skill text, spec | exists |
| The worker sends a status message with the handoff block of each issue when its pull request is up, so review and merge do not wait for the batch, and one report at the end | spec Batch and Report blocks (`spec-template.md:40`, `spec-template.md:50`), `orca.md` Worker reports (`orca.md:43`) and its check, which reads status messages (`orca.md:60-61`) | exists |
| A follow-up for an earlier issue of the batch: the worker commits its current work, switches to that issue's branch, fixes, pushes and returns | spec, the Batch block (`spec-template.md:40`) and the branch lines of the Authority block (`spec-template.md:24-27`), which named one branch before change 3 | exists |
| An issue of the batch that is blocked or needs a replan: the worker commits and pushes its work on that branch, reports the issue in its status message and goes on with the next. The coordinator's replan or retry for it waits until the batch has ended, and the worktree stays (before change 3 the outcomes assumed one issue per worker). A cause that would stop every issue (a refused hook, a missing credential) ends the batch as BLOCKED | spec (`spec-template.md:40`, `spec-template.md:44-46`), skill text (`spec-template.md:70-72`) | exists |

A batch counts as one worker for both caps and runs on the model of its highest tier. The owner makes a batch of related issues by labeling them together; grouping by subject is no decision of the script that picks (`SKILL.md:102`). The source run also let small related issues share one pull request. That is not taken over: Pick knows an issue has a pull request by the head branch that names its number (`pickable` in `precheck.mjs`), so a shared pull request would let the second issue be picked again.

### Worker rule file

`rules/worker.md` (exists), one line per rule. The spec carries its text, then the project's `docs/agents/worker-rules.md`, in a block after Flow (`spec-template.md:35-38`), which the repository's rules do not override (`spec-template.md:29`), and so does every subagent brief (the Flow line, `spec-template.md:33`).

| Rule | Reason |
|---|---|
| Run each delete as its own command with a literal path inside the worktree, never in a script, a compound command, a glob or a variable path; prefer a new folder to cleaning up | such a command stops at a permission dialog nobody answers |
| Never answer a permission or trust dialog. A denied call is not retried in another form: change the approach or report BLOCKED | the owner's approval is not the worker's to give |
| Wait for CI with `gh run watch <run-id> --interval 30 --compact --exit-status` or `gh pr checks --watch --interval 30`, never in a polling loop | workers share one GitHub API quota, and a refused request reads like a failed run |
| Take no dependency version younger than the project's cooldown: the `cooldown` of `.github/dependabot.yml`, else 3 days. A security fix is exempt | Dependabot's own default ([GitHub changelog, 2026-07-14](https://github.blog/changelog/2026-07-14-dependabot-version-updates-introduce-default-package-cooldown/)) |
| Write file text, commit messages and pull request bodies with the edit tools or from a file, never through a shell command that expands `$` or backticks | the shell rewrites the text |
| Stage named paths, never everything at once | a worktree holds local setup files |
| Bring a branch up to date by merging the default branch in; never rebase a pushed branch | a rebase needs a force-push and loses the reviewed head |
| Never stop, restart, reset or prune the container engine or its machine; remove only containers you started | workers share it |
| Change nothing at user scope (the settings, rules, plugins and skills that hold for every project) and run no global setup: only project steps | a user-scope change reaches every session on the machine |
| On a stop request from the coordinator: commit, push the branch, report the exact state, and end | a usage limit must not lose work |

The source run ended with a stricter delete rule: no delete command at all and no command wrapped in `sh -c`. That is not taken over, because a change may have to delete a file and a project may run its container commands through `sh -c`.

Each of these rules is wording a worker follows, not a control. The app's global `apply` refusing when an agent runs it would make the user-scope rule a control; that is proposed as work of its own.

Rules that already have a home stay there: tests, reuse, naming and comments (`rules/project.md:12-23`), secrets (`rules/global.md:1`), trusted authors and the Authority block (`spec-template.md:15`, `spec-template.md:22-27`), one report on the worker's own dispatch (`orca.md:32`, `spec-template.md:50`). The CI line of the project rules (`rules/project.md:10`) has the same `--interval 30`: `gh run watch` refreshes every 3 seconds by default (`gh run watch --help`).

### Keep running

| Rule | Home | State |
|---|---|---|
| After an outcome the coordinator picks again for every project with a free slot, within both caps | skill text (`SKILL.md:54`) | exists |
| A stall check runs on a timer | skill text (`SKILL.md:59`; the session cron, `orca.md:68`) | exists |
| The run closes when no worker is active and nothing is pickable in a project without `keepRunning`. While a project sets it, the run stays open and each timer tick also picks in that project, until the owner stops the run | policy `keepRunning`, skill text | exists |
| A fresh context can carry on the run | handoff file and context rotation (`SKILL.md:67`, `orca.md:105`) | exists |

The default is false because an open run spends a turn at every tick, and a scheduled run must end so that its precheck decides the next start (`SKILL.md:103`). The deadline of a wait stays a point to report at (`SKILL.md:59`); it ends no run.

### Questions, roles and reports

| Rule | Home | State |
|---|---|---|
| The owner is asked in the session only while terminal questions are allowed, else by an approval filed in the hub repository, or in the project's tracker where no hub is set (`approvals.md`) | skill text (`SKILL.md:110`) | exists |
| The owner's answer to a filed approval lifts a `design` gate only. For a `merge` or an `owner-only` gate the merge stays the owner's: the answer is a recorded decision, nothing merges because of it, and the run goes on when it sees the pull request merged. An answer counts only for the head the approval names | `answer` in `approval.mjs` (the newest comment by time that starts as an answer or is an option's label, such as `(a)`, or the one letter or digit of such a label alone, by the repository's owner or a member); skill text (`approvals.md:50-56`, `SKILL.md:53`) | exists |
| A worker takes the safest reversible option and writes it in the pull request | spec (`spec-template.md:42`) | exists |
| A worker flags work that is wrong, too big or against a recorded decision, and never widens its scope | spec (`spec-template.md:46`), and the question path below | exists |
| Work that splits into several pull requests: the worker reports NEEDS_REPLAN with the slices, and the coordinator lists them for the owner, who splits the issue | spec (`spec-template.md:46`), skill text (`SKILL.md:80`) | exists |
| A worker is released only once it has settled (after its report, or after it was stopped), and one with a pull request only after the merge or once the pull request is left for the owner | `orca.md:125` | exists |
| Phases with a gate between them: plan, implement, test, review | skill text (`skills/workflow/software.md:11-20`) | exists |
| One digest file: merges, decisions on the owner's behalf, open questions, risks, models | the `daily-digest` automation and `SKILL.md:71` | exists |

The source run posted a plan in the issue before a larger piece of work fanned out. In the loop one issue is one pull request, so the owner splits the issue instead, and the coordinator needs no right to write plans into the tracker.

### Not shipped

These rules of the source run are a project's, a machine's or a runner's own:

- A project's `AGENTS.md` and docs hold where issues, follow-up issues and doc changes go, how issues are written, what text may land in a public repository, spelling, which checks the project leaves out and how slow its CI runner is.
- A machine's session settings hold auto memory, the advisor, the account switching and what its emulator can run.
- The runner's guide holds how a message reaches a worker that is in the middle of a turn, and how a task is started.
- The local setup of a new worktree is project setup's job already ([setup guide](setup.md#per-repo)).
- A branch stacked on another pull request's head, and a push to a Dependabot branch, have no rule: the loop starts every branch from the default branch for an issue.

## Reconciliations

### A permission dialog in a worker's terminal

Before change 3 the dialog was never answered and the worker was blocked for the owner. The source run's coordinator declined it with Escape, so the worker went on with a denied call.

| Option | What it does | Risk |
|---|---|---|
| `block` | nothing is typed; the worker waits for the owner | a harmless dialog, such as a delete inside a compound command, holds a worker for hours |
| `decline` | after the stall check's read of the worker shows a permission dialog, the coordinator sends one Escape through the runner's terminal input (Orca: `terminal send` without `--enter`, which passes control bytes through) and then a runner message that names the declined call. It never sends Enter, a letter, a number or text, and never answers a trust dialog, a login or a question | Sent when no dialog is open, Escape interrupts the worker's turn, which a runner message restarts. The coordinator acts on terminal text a hijacked worker controls, and Escape is the only key that text can make it send |

Decision (owner, 2026-11-11): both ship, `block` as the default and `decline` as the owner's opt-in in the policy, because a policy that is silent on an action means no (`SKILL.md:42`). The worker rule file removes the common cause in either mode. That Escape declines the call was observed in the source run for Claude Code and is unverified for other agents, so `decline` applies only to an agent whose declining key `orca.md` names. The coordinator's Escape does not make the terminal a person's (`orca.md:123`).

Starting workers in Claude Code's `dontAsk` mode would remove the dialog altogether: it "auto-denies every tool call that would otherwise prompt you" ([permission modes](https://code.claude.com/docs/en/permission-modes)). It needs allow rules that cover every edit and command a worker runs, which no setup writes yet, and it changes the start rule (`SKILL.md:52`), so it is not part of this design.

### A worker's question to the coordinator

Before change 3 a worker never asked: it decided, or it reported NEEDS_REPLAN and ended, and a fresh worker started from a new spec without the first one's context. The source run's workers asked the coordinator and went on with the parts that did not depend on the answer.

Decision: "decide the safest reversible option" stays the first rule, and one question path is added where the runner has a question command (Orca: `ask`, `orca.md:49`; its check delivers the questions, `orca.md:60`):

- A worker asks only what it may not decide: the spec against trusted-author text, a recorded decision against the task, a choice that is not safe and reversible. One batch, as early as it knows, and it continues with what does not depend on the answer. When nothing else is left it ends the turn and the runner wakes it.
- The coordinator answers at its next wake, only from what is written: trusted-author text of the issue, the policy and `AGENTS.md` as the default branch has them, and recorded decisions. It never reads them in the worker's branch or worktree, where the worker could write its own answer.
- An answer never changes the Authority block, the policy or who merges. A question that asks for more (a path, a branch, a skipped check) gets no more: it is the owner's, and the worker is told "parked". A spec that does not fit stays a NEEDS_REPLAN report, with a new spec and one replan per issue and run (`SKILL.md:80`).
- A question that these sources do not settle is the owner's: it is filed as an approval (`approvals.md`), and the worker gets "parked", which means the safest reversible option marked "pending owner decision", or BLOCKED when there is none.
- Each answer the coordinator gives is a decision in the handoff file (`SKILL.md:109`).
- NEEDS_REPLAN stays for a spec that does not fit at all, and for runners without a question command.

No policy field: the path gives nobody a new right, since an answer comes only from what is merged on the default branch or written by a trusted author, and changes no authority.

## Project settings and drift

A project's Claude Code settings are reproducible when they are committed in `.claude/settings.json`, written from named defaults and compared with those defaults later. Two setups write project settings today (paths from the repository root):

| | BenchKeeper `projects apply` | CedarLoom `profiles apply --project` |
|---|---|---|
| Permissions | the guards' deny rules (`app/src/guards.mjs:14-22`) | deny and ask rules; allow rules are refused (`packages/contracts/src/profile.ts:515-519`) |
| Model | none per project | `model` is allowed (`packages/contracts/src/profile.ts:526`); the default profile sets none |
| Plugins and marketplaces | `claude plugin install` commands (`app/src/steps/project.mjs:515-516`) | `enabledPlugins` and `extraKnownMarketplaces`, in the local settings only, at a branch or tag (`packages/contracts/src/profile.ts:41-50`, `packages/contracts/src/profile.ts:131-135`) |
| Hooks | the guard hook and its script (`app/src/steps/project.mjs:546-551`) | refused in a profile (`packages/contracts/src/profile.ts:520-543`); the guard hook ships in the workflow plugin (`packages/emitter/src/claude.ts:95-119`) |
| Environment | the machine account's variables, local settings (`app/src/steps/project.mjs:565`) | variables from a fixed list (`packages/contracts/src/profile.ts:505-514`) |
| Record | `.benchkeeper/state.json` with the app and content version | `.cedarloom/profile-files.json`, committed, with hash and pack version per committed file (`packages/profiles/src/record.ts:102`) |
| Drift | `doctor` and `projects update` when a version differs (`app/src/steps/project.mjs:237`, `app/src/doctor.mjs:128`) | `profiles check`: `missing`, `outdated`, `deselected-present` or `not-run` per path (`packages/contracts/src/findings.ts:212-216`) |
| An owner's change | own entries stay, and the setup removes only its own, which includes an entry of the owner's that is identical to one of them (`app/src/merge.mjs:43-48`, `app/src/guards.mjs:23`) | a changed file is left and reported (`packages/profiles/src/owned.ts:31`); in settings, own additions stay, a removed entry returns and a value the profile sets is overwritten (`packages/contracts/src/compose.ts:47-71`) |

Design: BenchKeeper's `projects apply` is the home, because it is what a new project runs today, it records what it wrote, and `doctor` and `projects update` already report a setup that is behind. CedarLoom's profile has the same pieces and takes the two files as parts when it replaces project setup; that is not part of these changes.

A clean install showed what is missing:

| Finding | Design | Change |
|---|---|---|
| Nothing creates the policy or the worker rule file | a `projects apply` step writes `docs/agents/orchestration.json` (the defaults, no `startLabel`) and an empty `docs/agents/worker-rules.md`, each only when the file is absent: both are the owner's files from then on, recorded as created and not as content setup owns, so the owner's edits pass `benchkeeper verify`. Both are written to be committed, also in a local setup, because the coordinator reads them from the default branch. A command and `doctor` check the policy with the reader script | 7 |
| A new install gets the released plugin, which can be far behind the default branch and still carry the same version | policy `minPlugin`: the reader starts nothing when the plugin's `contentVersion` (`content.json`) is older. Between releases the default branch carries the released version (`release-please-config.json`), so the minimum can only name a release | 2 |
| The same version string names different content | Claude Code takes a plugin's version from its manifest first and keeps the cached copy while that string is unchanged ([plugin loading](https://code.claude.com/docs/en/plugins/loading#how-claude-code-computes-the-version)). An update therefore needs one of three things, and the owner chooses: the version moves with every content change; the manifest and the marketplace entry name no version and the source is a git one, so Claude Code takes the commit; or setup records the content's commit beside the version and compares that | 8 |
| `precheck.mjs` needed `refs/remotes/origin/HEAD`, which a repository that was not cloned lacks and an older clone holds stale, and the example's label differed from the triage label | the reader fetches the remote's `HEAD` into a ref of its own (`refs/benchkeeper/policy`) and reads the file from the commit the remote names as its `HEAD`, so neither the local reference nor a ref a worker moves is used and no name the remote chooses becomes a git argument. The example uses `ready-for-agent`, the label of the `issue-triage` automation | 2 |
| Setup knows the user and the local plugin scope only | a shared setup (`projects apply --share`) enables the plugin in the committed `.claude/settings.json` and installs it at project scope, and `doctor` counts that scope. The pin is limited by Claude Code (trial below) | 8 |
| The run's issues live in one tracker repository, with a label per project | policy `issues.repository` and `issues.labels` (below) | 2, 3 |
| A project setup must never write user scope | `setting-up-projects` runs `projects apply` only, never the global `apply`, and the worker rule file forbids changes at user scope. One exception stays until change 8: `projects apply` adds a pack's marketplace for the user and installs a pack's plugin at the pack's scope, which is the user's unless the scope stored for the pack says otherwise (`app/src/steps/project.mjs:515-516`, `app/src/packs.mjs:115-118`) | 4 |
| Setup's output is the same for every stack, and the stack skills the setup skill chooses are recorded nowhere | not part of the coordinator workflow: proposed as work of its own | none |
| `projects apply` and the setup skill are documented in two orders, which give two results, and the skill's `AGENTS.md` edit fails `benchkeeper verify` afterwards | work of its own (setup order and ledger). This design adds no such edit: its files are created by `projects apply` and recorded as created | none |
| The setup skill is user-invoked: a worker or a headless session cannot run it | what this design adds to setup (the policy, the worker rule file, the issue template) is written by `projects apply`, which runs headless; the skill only names those steps. Making the skill's other steps headless is work of its own | 6, 7 |
| The prerequisites did not name Orca | they name it as the runner the coordinator skill needs (`docs/setup.md:21`) | 4 |
| Without a release, none of this reaches an install | the release is the owner's. Change 3 lands before the release that carries change 2, because the precheck and the coordinator disagree in between | none |

The rest of what setup is to keep current per project (permissions, model, plugins, hooks, environment) needs no change. Permissions: the guards' deny rules; allow rules are not written, because they widen what a session does without asking. Model, effort and environment: the owner's own entries in the committed settings, which Claude Code applies on every machine and setup leaves alone; they are the project's values, not defaults that could fall behind. Hooks: the guard hook.

### What a commit pin can do

A marketplace source takes a branch or tag and no commit, and a plugin source takes `sha` ([marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference#marketplace-sources)). A plugin enabled only in committed settings loads on a machine after `claude plugin install --scope project` there ([plugin loading](https://code.claude.com/docs/en/plugins/loading#enabled-in-project-settings-but-not-installed)). A trial with Claude Code 2.1.316 in an empty config folder, the plugin at the released commit and at the default branch's, both `6.26.0`, showed:

| Tried | Result |
|---|---|
| A marketplace declared in the project's, the local or the user settings (source type `settings`) whose plugin entry carries `sha`, then `claude plugin install` | refused: the plugin is "not found in marketplace"; the command line registers no marketplace from settings. Whether a session registers it after the trust dialog was not tested |
| A commit as the `ref` of a marketplace source | the clone fails |
| The same plugin entry with `sha` in a marketplace added from a folder | installs that commit; the record holds version and commit, the cache folder is named by the version only |
| Changing that `sha` with the version unchanged, then `claude plugin update` | "already at the latest version (6.26.0)"; the cached copy stays |
| The plugin at user scope from one marketplace and at project scope from another | both listed as enabled, no error. Which copy's hooks run was not tested; the documentation says one copy's are left out ([plugin loading](https://code.claude.com/docs/en/plugins/loading#hooks-when-two-enabled-plugins-share-a-name)). The design's case, one plugin id enabled at both scopes, was not tried |

The documentation also keeps one record of fetched marketplaces per user and fetches a marketplace again when its source in settings changes ([plugin loading](https://code.claude.com/docs/en/plugins/loading#check-which-stage-a-plugin-reached)). From that, a declaration committed in one project would point that marketplace somewhere else for every project on the machine; this is inferred, not tested. What setup can do today is therefore narrower than a commit pin per project: enable the plugin at project scope, record the installed version and commit in the project's state, and have `doctor` report a machine whose copy differs. A pin that Claude Code enforces waits for the version decision above.

### The issue source

`issues.repository` names the tracker as `owner/repo` when a project's issues live in another repository, and `issues.labels` lists labels an issue must carry besides `startLabel`. With an issue source, a project must name at least one label, or two projects on one tracker pick the same issue; the reader refuses a policy without one.

- Trust: issue text counts by its author's association in the tracker, pull request and review text by the association in the project. Every organization member and collaborator of the tracker (`authorAssociation` OWNER, MEMBER or COLLABORATOR) can therefore direct work in each project that names it. That is the risk the owner takes with this field.
- Pick: the tracker's numbers can equal numbers of the project's own old branches, so an issue has a pull request only when a head branch names its number (`pickable` in `precheck.mjs`) and that pull request's body refers to it as `owner/repo#number` or by its URL. An open pull request from a fork never counts, with or without a tracker: anyone can open one.
- Reference: "has a pull request" rests on text the worker writes, so the coordinator checks the body for the reference before it marks the pull request ready.
- Close: a bare reference closes nothing; `closeIssue` allows the coordinator's close in the tracker. A closing keyword (`Fixes owner/repo#12`) closes the issue when the pull request merges, in another repository too and whatever `closeIssue` says ([linking a pull request to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)): the spec forbids one, and the same check before ready looks for it.
- One project per issue: a label per project does not make the labels distinct. In a run, an issue that matches more than one project starts nowhere and is listed for the owner: a rule of Pick in `SKILL.md` (`SKILL.md:50`), carried by `distinct` in `precheck.mjs`: run with every project of the run, the precheck prints such an issue for none of them and names it on stderr.
- Naming: the policy and the pull requests name the tracker, so a public project whose tracker must stay unnamed cannot use an issue source.

## What changes for a version 1 policy

A project that keeps its version 1 file gets these new defaults (owner, 2026-11-11), which the release notes name:

| Change | Direction |
|---|---|
| Workers run the model of their tier, where they ran the agent's default | cost: `opus` for standard and full work, `fable` for research, each at `high`; quick work moves to `sonnet` |
| Each pull request gets a fresh reviewer at `high`, a sensitive change also a security review, and every fix a scoped re-review | cost, more checks |
| A decision in the owner's place goes to a `fable` subagent first | cost |
| A merge needs a head that contains the tip of the default branch and is green there, a checked title, and the default branch's CI watched before the next merge | narrower |
| Pull requests that change anything under `.github`, `CODEOWNERS` or `docs/CODEOWNERS`, the policy, the project's worker rules, or `.claude` or `.mcp.json` at any depth are left for the owner | narrower |
| A pull request whose purpose is a release is left open | narrower |
| An open pull request from a fork no longer marks its issue as taken, so the issue can start | wider pick, same merge rights |
| Every worker's spec and every subagent brief carry the plugin's worker rules | narrower |
| A file with a key the schema does not name starts nothing until the key is fixed | narrower |
| A worker may ask the coordinator what it may not decide | same rights, fewer restarts |

The phase agents' change to `inherit` alters no default: the workflow skill passes the same aliases they named before change 3.

No default lets the coordinator merge more than today: the merged head is one a reviewer read, or that head with the default branch merged in. `disjoint`, `merge.additivePaths`, batches, `keepRunning` and `decline` are each the owner's opt-in.

## Changes

Changes 1 to 7 exist (6 in part, see there); 8 does not yet.

1. This note.
2. Policy schema version 2: the schema, which moves into the skill folder so that a skill folder copied alone can check a policy, `policy.example.json`, the app's policy check (`app/src/params.mjs`, which calls the reader's validation instead of walking the schema itself), the reader script that prints the effective policy, and `precheck.mjs`, which takes the policy from the reader and lists issues from the tracker the policy names.
3. `SKILL.md`, `spec-template.md`, `orca.md` and the new `review-and-merge.md` use the fields: models, review depth and rounds, merge mode, owner-only paths, batches, keep running, the issue source, the question path and `permissionPrompts`. The phase agents say `inherit`, and `skills/workflow/software.md` names each phase's alias and the review level. The line references of `docs/security.md` follow.
4. `rules/worker.md`, the workflow skill's ladder and `haiku` lines, the CI line of `rules/project.md`, the rule in `setting-up-projects` that it runs project steps only, and Orca in the prerequisites.
5. The decisions `SKILL.md:102` gives to a script, as functions with fixed cases in the app's tests. In `precheck.mjs`: the pick (`pickable`, where an issue labeled `question` never starts, and `distinct`, where an issue that several projects list starts nowhere, applied by the command line's `report`); an origin whose host cannot be compared with `gh`'s fails (another host, a local path, a `file:` URL, user text that readers split differently). In the new `merge-checks.mjs`: the owner-only match (`ownerOnly`), the paths no command can name (`unsafe`), the pin (`pin`) and what follows (`next`: `owner`, `re-review`, `ready` without `merge.allowed`, then `merge`, `update` or `trial` by merge mode), printed as one verdict per head that the merge steps act on (`review-and-merge.md:10`). It gives no verdict for a head with several merge bases with the default branch, or for a scratch path that is the project's repository. In `approval.mjs`: the read-back of the owner's answer to a filed approval (`answer`, `approvals.md:41-56`), which lifts a `design` gate only and merges nothing. The caps and a worker's batch, the lowest numbers first, stay skill text (`SKILL.md:50`, `SKILL.md:52`): arithmetic needs no script. One fix worker per failing head commit stays skill text. The clean-install check is `npm run check:clean-install` in `app/` (`app/scripts/clean-install.mjs`), which the app's tests also run: an empty home, two fixture projects, setup applied twice with no second change, the policy reader and the precheck.
6. One approval layout (model, effort, review, merges, cost) for the owner gates of `SKILL.md:112`, the `questions` skill and an issue template that `projects apply` writes. It follows change 3, whose models it shows. The layout is `approval-template.md` in the skill folder: the coordinator fills it, checks it with `approval.mjs` and files it as an issue with the labels `question` and `ready-for-human` (`skills/orchestrating-projects/approvals.md:24`). `projects apply` does not write it into a project yet.
7. `projects apply` writes the policy and the project's worker rule file when they are absent (`app/src/steps/project.mjs:683-684`), `benchkeeper verify <dir>` checks the policy (`app/src/harness.mjs:40`), and `doctor` checks the policy and compares the installed plugin's content version with `minPlugin` (`app/src/doctor.mjs:96`).
8. The plugin at project scope: enabled in the committed settings, installed and updated for that scope, version and commit recorded, `doctor` counting the scope. It changes what a repository's committed settings install and depends on how the plugin's version moves, so its design waits for the owner.
