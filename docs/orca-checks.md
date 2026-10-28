# Orca checks

What the app's Orca adapter (`app/src/orca/index.mjs`) relies on that only a real Orca can confirm. CI tests the adapter against a fake Orca CLI (`app/test/fakes/orca.mjs`) that answers with output recorded from the real CLI (`app/test/fixtures/orca/`). Run this checklist when the Orca version changes, before the adapter is said to work with it.

Observed version: 1.4.243 (`OBSERVED` in `app/src/orca/index.mjs`, `app/test/fixtures/orca/version.txt`). `benchkeeper doctor` warns on another major version.

## Steps on a new version

1. Note the version: `orca --version`.
2. Go through both tables below with a throwaway project and, for automations, a throwaway automation created disabled. Note pass or fail per row.
3. Record the output again: `orca orchestration run-list --limit 2 --json`, `orca orchestration task-list --run <id> --json` and the error of `orca orchestration run-show --id run_missing --json`. Anonymise ids, handles, pane keys, process incarnations, the cursor and every text field (`objective`, `task_title`, `display_name`, `spec`, `result`) to the placeholders the current fixtures use, and keep every other field and its form (`deps` as a string, both `created_at` forms).
   For automations, with a throwaway automation only (never the real store): `orca automations create --name throwaway --trigger hourly --prompt noop --provider claude --precheck true --repo path:<throwaway project> --workspace-mode new-per-run --disabled --json`, then `orca automations show --id <id> --json`, `orca automations edit --id <id> --prompt noop2 --json`, `orca automations runs --id <id> --limit 20 --json` after a Run now, `orca automations remove --id <id> --json` and the error of `orca automations show --id <id> --json` after the removal. Anonymise ids, timestamps and every text field (`name`, `prompt`, `precheck.command`, a run's `title`, `error` and `outputSnapshot`) as in `automation-derived.json`. Until this is done once, the automation fixtures are derived from the CLI source of the observed version, not recorded (files `*-derived.json`); recorded ones replace them under names without `-derived`. The throwaway project must be a registered repository: on 1.4.243, `create --workspace path:<dir> --workspace-mode existing` for a folder in no registered repository exits 1 with `error.code` and `error.message` both `selector_not_found` and creates nothing (recorded in `automation-create-unregistered.json`). The CLI has no command that removes a registered repository, so register the throwaway one in the desktop app and remove it there afterwards.
4. Replace the files in `app/test/fixtures/orca/`, set `version.txt` and `OBSERVED` to the version, and run the app tests: `test/orca.test.mjs` shows what the new output changed.
5. A failed row: open an issue that names the row, the version and what Orca did.

## Adapter features

| Feature | Where | Check |
|---|---|---|
| Installed | `installed` | `orca --version` exits 0 and prints the version on one line |
| Runs view: run list | `runs` | `orca orchestration run-list --limit 20 --json` exits 0 with `ok: true` and `result.runs[]` holding `id`, `created_at`, `updated_at` |
| Runs view: tasks | `runs` | `orca orchestration task-list --run <id> --json` gives `result.tasks[]` with `status` one of the values `orca orchestration task-update --help` lists |
| Open workers | `workers` | `orca orchestration worker-list --terminal-state active --limit 100 --json` from a terminal outside a run answers `ok: true` with `result.scope.source` `all` and `result.workers[]` holding `dispatchStatus` (`dispatched` while the worker works) and `resource.worktreeId` as `<repo id>::<worktree path>`; recorded in `worker-list.json` |
| Runs view: errors | `runs` | a failing command exits non-zero, or prints `ok: false` with `error.code` |
| Worker prompt | `isWorkerPrompt`, `taskOf` | a dispatched worker's first prompt has the lines `You are working inside Orca, a multi-agent IDE.` and `Your task ID is: <id>` (not documented, seen in transcripts) |
| Run line | `runOf` | a worker started from the worker-spec template carries `Orca run: <id>` in its prompt |
| Hooks kept | `ownsHook` | the hooks Orca writes into the agent settings carry an `ORCA_` variable in their command |
| Worktree setup | `worktreeFiles` | a new worktree of a project with the offered `orca.yaml` runs `scripts.setup` in `$ORCA_WORKTREE_PATH` before the agent starts (`setupAgentStartupPolicy: wait-for-setup`), and copies the files `.worktreeinclude` lists when Git ignores them |
| Automations: create | `createArgv`, `automationResult` | `create ... --disabled --json` with `--workspace path:<dir>` (template workspace `project`) or `--repo path:<dir> --workspace-mode new-per-run` creates it disabled and answers `ok: true` with `result.automation` holding `id`, `name`, `prompt`, `rrule`, `precheck.command`, `agentId`, `enabled` |
| Automations: edit | `editArgv` | `edit --id <id>` with the template's fields changes them and keeps the enabled state; an `rrule` value read back from `show` is accepted as `--trigger` (undo of an update) |
| Automations: run history | `runsArgv`, `automationRuns` | `runs --id <id> --limit 20 --json` answers `ok: true` with `result.runs[]` newest first, each with `status` (`completed`, `skipped_precheck`, `skipped_missed` and the others), `trigger` and `scheduledFor` in milliseconds |
| Automations: remove and show | `removeArgv`, `showAutomation` | `remove --id <id> --json` answers `result.removed`; `show` of a removed id answers `ok: false` with a message containing `not found` |
| Skills | `SKILLS`, `SKILL_SOURCE` | the `orca-cli` and `orchestration` skills install from the source repository |

## Automation behavior

The ten tests of [#462](https://github.com/ESchuderer/BenchKeeper/issues/462), each in the Orca desktop app with a throwaway automation created disabled.

| Test | Check |
|---|---|
| 1. Interactive or print mode | the Run now terminal shows the interactive screen, no `-p` on the command line (Claude Code and Codex) |
| 2. Schedule while Orca is quit | nothing fires while it is closed; one catch-up run after start |
| 3. Missed-run grace | `skipped_missed` with grace 5 minutes, one run with grace 60, none on a frequent schedule, and sleep across a due time |
| 4. `edit --disabled` and `--enabled` | other fields unchanged; what happens to runs missed while disabled |
| 5. Precheck environment | working directory and PATH, launched from the launcher and from a terminal |
| 6. Precheck exit codes and timeout | `exit 1`, `exit 0`, a timeout and a missing command; no worktree for a skipped run |
| 7. Manual runs | Run now skips the precheck |
| 8. Skipped runs | which bucket and notification they land in, and the fold of repeated skips |
| 9. Linux window close | closing the last window keeps or ends the app process |
| 10. Session reuse | reuse together with extra agent arguments is refused |
