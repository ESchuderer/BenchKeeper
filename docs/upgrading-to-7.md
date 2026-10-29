# Upgrading to 7.0

7.0 does not migrate a 6.x setup. Undo 6.x with the 6.x app, remove what its undo leaves, then install 7.0 as on a new machine.

The commands of the `benchkeeper` CLI follow one scheme: a noun group, then a verb (`projects plan`, `skills enable`). The old names are gone, with no alias. A call that still uses one exits with 2 and prints the help.

## Clean uninstall of 6.x, clean install of 7

The 6.x commands below run the 6.x app you installed with (`6.25.0` here). Each run of `apply`, `project apply`, `accounts` and `settings` is recorded in the ledger; `undo <run>` restores the files the run changed and runs the inverse of its commands (plugin uninstall, marketplace remove).

1. List the runs, newest first:

   ```sh
   npx -y benchkeeper@6.25.0 history
   ```

   ```text
   20261028T202328Z-f3ae9c  apply   done        /home/node/scratch/work/demo  4 changes
   20261028T202309Z-3fec0b  apply   failed      global  18 changes
   ```

2. Take the setup out of each project. For a project with a local setup, undo its `project apply` run, or run `projects remove <dir> --setup`, which removes `CLAUDE.local.md` (only BenchKeeper's block), `AGENTS.override.md`, `.benchkeeper/` and the lines in `.git/info/exclude`, and keeps the project registered. For a shared setup (committed files) the same command opens a pull request on the branch `chore/remove-agent-setup` (not run here).

   ```sh
   npx -y benchkeeper@6.25.0 undo 20261028T202328Z-f3ae9c
   ```

   ```text
   done    undo: git ignores the local setup (.git/info/exclude)
   done    undo: .benchkeeper/state.json: setup version 6.25.0
   done    undo: AGENTS.override.md: AGENTS.md plus rules, where commands run, default tier, skill pointers
   done    undo: CLAUDE.local.md: rules, where commands run, default tier, skill pointers
   ```

3. Undo the global `apply` runs, newest first. A run of status `failed` is undone too: undo covers its `done` steps.

   ```sh
   npx -y benchkeeper@6.25.0 undo 20261028T202309Z-3fec0b
   ```

   ```text
   done    undo: global skill find-skills from vercel-labs/skills
   done    undo: Ponytail level full
   done    undo: Codex effort high, analytics and feedback off
   done    undo: Claude auto-compact window 400000 tokens, per-model values removed
   done    undo: Claude default effort high, per model too (Opus 5.5 ignores the top-level key)
   done    undo: Claude default model opusplan (Opus in plan mode, Sonnet otherwise)
   done    undo: Claude settings: advisor Opus, Remote Control at startup, clear-context on plan accept, transcripts 14 days, stable channel, commit and pull request attribution hidden, error reporting and feedback off, subagents on Sonnet
   done    undo: Codex plugin ponytail@ponytail
   done    undo: Codex marketplace ponytail
   done    undo: Codex plugin benchkeeper@benchkeeper
   done    undo: Codex marketplace benchkeeper
   done    undo: Claude Code plugin ponytail@ponytail
   done    undo: Claude Code marketplace ponytail
   done    undo: Claude Code plugin benchkeeper@benchkeeper
   done    undo: Claude Code marketplace benchkeeper
   done    undo: Codex rules .codex/AGENTS.md
   done    undo: Claude Code rules .claude/rules/00-global.md
   ```

   `claude plugin list`, `claude plugin marketplace list`, `claude mcp list` and their Codex counterparts then print the same as before the install.

4. Per account: `accounts track <name> --off --yes` removes the status line script and the StopFailure hook from the account's folder, `accounts remove <name> --yes` removes the registry entry and a stored token. The account folder and its sign-in stay; `accounts remove` prints its path.

5. Remove what undo leaves (next section), then install 7.0 as on a new machine: `npx benchkeeper@6.25.0 apply`, then `npx benchkeeper@6.25.0 projects apply` in each project ([setup guide](setup.md#levels)).

### What undo leaves

| Left | Where | Remove with |
|---|---|---|
| Config folder: ledger, backups (old texts of the changed settings files), `projects.json`, `accounts.json` | `~/.config/benchkeeper/` | `rm -rf ~/.config/benchkeeper` (after the last undo: undo needs the ledger and backups) |
| Registered projects | `projects.json` in the config folder (`projects remove <dir>` only unregisters) | with the config folder |
| Account folders with their sign-in and kept readings | the folder given at `accounts add` | delete the folder |
| Plugin caches of the uninstalled plugins | `~/.claude/plugins/cache/benchkeeper`, `~/.claude/plugins/cache/ponytail` (Codex: `~/.codex/plugins/cache/...`, empty) | `rm -rf` each |
| Empty folders | `~/.claude/rules`, `~/.claude/skills`, `~/.agents/skills`, `~/.config/ponytail`, `<project>/.benchkeeper/` (after `undo`; `projects remove --setup` removes it) | `rmdir` each |
| npx cache of the 6.x app | `~/.npm/_npx` | `rm -rf ~/.npm/_npx` |
| Agent CLI bookkeeping with empty lists: `enabledPlugins: {}`, `extraKnownMarketplaces: {}`, `installed_plugins.json`, `known_marketplaces.json`, an empty `config.toml` | `~/.claude/settings.json`, `~/.claude/plugins/`, `~/.codex/config.toml` | written by `claude plugin` and `codex plugin` themselves, also without BenchKeeper; can stay |
| Tools the app installed (Dev Containers CLI) | global npm packages | `npm uninstall -g @devcontainers/cli` if nothing else uses it (not run here: the install failed in the test home) |

The plugin's hooks are part of the plugin and are no longer loaded after its uninstall. A project's committed files from a shared setup stay until the pull request of step 2 is merged.

### How this was checked

Once, on 2026-10-28, in a container with an empty home (`HOME` and `BENCHKEEPER_HOME` set to it), Claude Code 2.1.312 and Codex CLI 0.165.0: `npx -y benchkeeper@6.25.0 apply --agents claude,codex --yes`, `project apply` on a new repository, `projects add` and `projects remove --setup`, `accounts add`, `track`, `track --off` and `remove` on an account without sign-in, then the undo of each run. A file list of the home before the install and after the removals differs only in the agent CLI bookkeeping of the table. 7.0 was then installed from the `integration/7.0` branch (`apply`, `projects apply`) into the same home without errors other than the Dev Containers CLI install, which needs write access to the global npm folder. Before the 7.0 release the marketplace branch `stable` still serves 6.x content, so the plugin content 7.0 installs was not checked. Shared setups, the OS credential store, Gemini CLI and GitHub Copilot were not part of the run.

## Renamed commands

| Old | New |
|---|---|
| `project plan [dir]`, `project apply [dir]` | `projects plan [dir]`, `projects apply [dir]` |
| `update-all [dir..]` | `projects update [dir..]` |
| `test [dir]` | `verify [dir]` |
| `board` | `sessions board` |
| `record [--project dir] -- <agent>` | `sessions record [--project dir] -- <agent>` |
| `eval` | `evals plan` (lists the targets and sessions, starts none), `evals run` (asks, then starts them) |
| `case add` | `evals cases add` |
| `maintain knowledge show`, `maintain knowledge clear` | `knowledge show`, `knowledge clear` |
| `project apply [dir] --disable <skill>` | `skills disable <name> [--project dir]` |
| `project apply [dir] --enable <skill>` | `skills enable <name> [--project dir]` |

`--json` documents carry the new name in `command`: `verify`, `projects plan`, `sessions board`, `knowledge show`.

## What stays

`ui`, `plan`, `apply`, `doctor`, `history`, `undo`, `restore`, `run`, `insights`, `profile`, `settings`, `rules`, `extensions`, `packs`, `accounts`, `skills` and `projects list|add|scan|remove|rename|relocate|unshare` keep their names and options. The UI routes under `/api/` keep theirs.

Scripts and notes that call the old names need the new ones.

## Removed

`frameworks` and `projects apply --framework` are gone: no framework replaces BenchKeeper's workflow skill any more. Matt Pocock's skills (pack `matt-pocock`) run the phases of standard and full work, and agency-agents stays a pick of agent files (`skills sources`, `--agent-file`). The ECC pack and its three skills are gone from the library.

## Project state

`.benchkeeper/state.json` moves to `schemaVersion` 2: `appVersion` and `contentVersion` replace `setupVersion`. 7.0 reads a version 1 file with `setupVersion` as both values and writes version 2 on the next `projects apply`; a project is behind when either version differs. BenchKeeper 6.x may misread or overwrite a version 2 file, so everyone who works on a repository with a shared setup (committed state file) updates to 7.0 together.

## Release names

The app and the content release apart from 7.0 on: the app as `app-vX.Y.Z` (npm package `benchkeeper`), the content (rules, skills, plugin) as `setup-vX.Y`. 6.x had one setup version for both. Details: [releasing](releasing.md#components).

## Site

The site root shows the latest release, `/next/` shows `main` ([releasing](releasing.md#site)).
