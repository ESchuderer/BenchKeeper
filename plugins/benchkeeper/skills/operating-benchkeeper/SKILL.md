---
name: operating-benchkeeper
description: "How an agent manages its own BenchKeeper setup through the benchkeeper CLI alone, without the web UI: plan, review the diff, apply with --yes, read the JSON, undo a run, run doctor and verify, update one project. Use when asked to install, update, check, change or undo the BenchKeeper setup of this machine or a repository, or to read its state (projects, skills, packs, history, settings, rules) from the command line."
writes: "What the `benchkeeper` commands you approve write: rules, skills, settings and project setup files, each run recorded for `benchkeeper undo`."
---

# Operating BenchKeeper through the CLI

`npx benchkeeper@6 <command>` (below `benchkeeper <command>`). `benchkeeper help` lists every option. Every change the setup commands make is a plan with a diff and is recorded as a run that `undo` reverses. These are not undone by it: `packs remove` and `presets remove` (the file goes to `backup/packs/` or `backup/presets/` in the config folder), `packs save`, `packs import` and `profile import` over an own pack of the same id (the pack is replaced, the old file goes to `backup/packs/`), the commit on a local branch that `projects update`, `projects remove --setup` and `projects unshare` make for a shared setup (delete the branch), a token removed by `accounts remove`, the URL and token `webhook remove` deletes, `knowledge clear` (the knowledge base is rebuilt by the next pass), `sessions cache clear` (summaries of deleted transcripts are gone for good), `automations remove` (undo restores the record only; the automation and its run history on the runner are gone, `install` creates it again) and the containers `containers reconcile` removes. Before you run one of these commands, or ask approval for a plan that contains one, tell the user that undo does not reverse it. Every view of the web UI has a command except the UI's own controls; the Routes and commands table in the app README maps each route to its command.

## Safe order

1. Read the state: `benchkeeper projects status [dir] --json`, `benchkeeper doctor [dir] --json`, `benchkeeper verify [dir] --json`, `benchkeeper projects list --json`. Pass the project folder to `doctor` and `verify` every time: without it `verify` skips the project's skill checks. A finding of level `error` is exit 1.
2. Plan, write nothing: `benchkeeper plan --json` (global) or `benchkeeper projects plan [dir] --json` with the options you mean to apply. Show the user each change's `title` and `path`; the plan lists titles and paths, not diffs. Read a diff with the text form (no `--json`), which prints it.
3. Ask before any change with `destructive: true`, and before anything that removes, disables or overwrites: `--all`, `projects remove --setup`, `packs remove`, `packs save` or `packs import` over an own pack of the same id, `profile import`, `presets remove`, `skills remove`, `skills delete`, `rules disable`, `accounts remove`, `webhook remove`, `knowledge clear`, `sessions cache clear`, `automations remove`, `containers reconcile`, `settings set --unset`. Do not pass `--all` on your own.
4. Apply: `benchkeeper apply <the options of the plan> --yes` (`plan` and `apply` take the same `--level`, `--agents` and `--pack`; the default level on a fresh machine is `full`) or `benchkeeper projects apply [dir] <the same options> --yes`. `--yes` applies the default selection: no removals, no optional change. Without `--yes` and with no input (your shell gives none), the command exits 2 with `<command> asks before it changes anything: add --yes` and changes nothing; with `--json` it does the same. Piped answers that decline every change apply nothing, record no run and print `nothing applied`.
5. Keep the undo id: `runs[].id` of the `--json` document, or in the text form the line `run <id>: undo with benchkeeper undo <id>` (not the last line of `projects apply`, which ends with record instructions). A plan with no changes creates no run: say so. `benchkeeper history --json` lists runs newest first, `benchkeeper history show <run>` prints each change of one run with its diff. Tell the user the id.
6. Check again: `benchkeeper doctor [dir] --json` and `benchkeeper verify [dir] --json` with the same `dir`. To go back: `benchkeeper undo <id>` (`--step <step>` for one step). Undo puts a file back only while it is as the run left it; otherwise it fails for that change and names the file. A removed plugin, a deleted token or a command without a recorded reverse is reported as manual.

Never run `apply`, `undo`, `restore` or `projects update` against a home folder or repository you were not asked to change. Credentials never go into a command line or output; `accounts login --token` and `run` are for the user.

## Commands

`--json` prints one document on stdout (`schemaVersion`, `command`, the keys; a failure has `error`), logs go to stderr. Exit 0 clean, 1 a finding of level `error`, a failed check or a change that cannot be made, 2 a usage or read failure. [app/README.md](https://github.com/ESchuderer/BenchKeeper/blob/main/app/README.md#machine-readable-output) has the keys of each document.

| Need | Command |
|---|---|
| Versions, level, setup state of each project | `projects status [dir] --json` |
| Install level, drift, fixes | `doctor [dir] --json` |
| Files match the ledger, project skills at their pins | `verify [dir] --json` |
| Global setup | `plan --json`, then `apply --yes` (`--agents a,b`, `--pack p`, `--level lite\|standard\|full`) |
| One project's setup | `projects plan [dir] --json`, then `projects apply [dir] --yes` (`--agents`, `--env container\|host-agent\|sandbox\|host`, `--tier`, `--pack`, `--skill`, `--share\|--local`, `--guards\|--no-guards`, `--agent-file`, `--caller lint-js\|lint-python\|sonar`) |
| Answers of a project | `.benchkeeper/state.json`; a changed answer is a new `projects plan` |
| Registered projects | `projects list --json`, `projects scan <root> --json`, `projects add <dir>` |
| New project from a preset | `presets list`, `presets save <id> --project dir` (the answers of a set-up project), `presets remove <id>` (moves the file to the backup); `projects create <dir> --preset <id>` with no input prints the plan, then after approval `--yes` applies it and registers the folder (only when the plan wrote `.benchkeeper/state.json`; without it the command exits 1); it then prints recommended skills to turn off and packs to add as a second plan, which `--yes` leaves unselected and `--all` takes whole |
| Update one project | `projects plan [dir]`, then `projects apply [dir] --yes` (the answers default to its state file) |
| Update every project | `projects update [dir..]` with no input first: it prints each project's changes and the summary, then exits 2 without applying (`--dry-run` omits the summary). After approval, `projects update [dir..] --yes`; it pushes nothing, and each result line names the `push` command of a committed branch for the user to run |
| Take the setup out of a project | `projects remove <dir> --setup` (lists the files; ask, then `--yes`) |
| Skills of a project | `skills list --json`, `skills show <name> --json` (the text of a library skill or one of the user's own); `skills update\|reset\|adopt\|enable\|disable [name..] --yes` |
| The user's own skills | `skills new <name> --description <text> --yes` or `--file <path>`, `skills edit <name> --file <path> --yes`, `skills delete <name> --yes` (`skills new\|edit\|delete`: each a plan that undo reverses; `new` and `edit` show a diff, `delete` names the folder it removes without a diff, so read the skill first with `skills show <name>`; `delete` is refused while a project or own pack names the skill) |
| Packs | `packs list --json`, `packs show <id> --json`, `packs enable\|disable <id> --project dir --yes` |
| Rules, extensions, settings | `rules list --json`, `rules show <file> --json`, `extensions list --json`, `settings list --json`, `settings get <key> --json` |
| Runs and undo | `history --json`, `history show <run> --json`, `undo <run>` |
| Unused skills, findings with a fix | `insights --json` |
| Sessions | `sessions board --json` |

Show the plan to the user and get a yes before each `--yes` command: the flag skips the questions, not the review. A `projects plan` or `plan` that exits 1 has a change with an `error`: fix the cause, do not apply around it.
