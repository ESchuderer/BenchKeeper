# Setup guide

What BenchKeeper installs, where it writes and how to update or undo it. The short version is the [README](../README.md).

## Prerequisites

Not installed by BenchKeeper.

<!-- generated:prerequisites -->
| Tool | Needed for |
|---|---|
| [Claude Code](https://code.claude.com/docs/en/setup) | agent, at least one (Gemini CLI and GitHub Copilot CLI also work, untested) |
| [Codex CLI](https://developers.openai.com/codex/cli) | agent, at least one (Gemini CLI and GitHub Copilot CLI also work, untested) |
| [Git](https://git-scm.com/downloads) | clone, branches, commits |
| [GitHub CLI](https://cli.github.com/) | issues and pull requests (optional, local branches without it) |
| [Node.js and npm](https://nodejs.org/en/download) | the app (Node.js 22), Dev Containers CLI and skills CLI, npm with a user prefix such as `$HOME/.local` |
| [Docker Engine](https://docs.docker.com/engine/install/) | dev containers (`container` and `host-agent` modes; Podman works too) |
| [VS Code](https://code.visualstudio.com/download) | optional, attach to the devcontainer |
<!-- /generated:prerequisites -->

## Levels

Three levels, from the smallest: a plugin cannot ship always-on instructions, so lite relies on the `workflow` skill description to trigger (trigger rate unverified: [evaluation](../evaluations/practices/lite-install.md)). Each level contains the one before.

<!-- generated:levels -->
| Level | Contains | Writes | Command |
|---|---|---|---|
| Lite | the BenchKeeper plugin: the `workflow`, `tier`, `setting-up-projects`, `maintaining-repos` and `orchestrating-projects` skills | nothing outside the plugin install, besides the app's run record for undo | `npx benchkeeper@6.23.0 apply --level lite` |
| Standard | lite plus the local project block: `CLAUDE.local.md`, `AGENTS.override.md` and the git exclude list | local files in each project you run `project apply` in | `npx benchkeeper@6.23.0 apply --level standard && npx benchkeeper@6.23.0 project apply` |
| Full | standard plus the global rules, Ponytail, Claude Code and Codex settings, packs and the app | global rule files, settings and packs | `npx benchkeeper@6.23.0 apply --level full` |
<!-- /generated:levels -->

Claude Code, Codex, Gemini CLI and GitHub Copilot CLI are each optional (Gemini CLI and Copilot untested). The app configures the agents it finds on `PATH`. It does not install agent CLIs. Linux and macOS are tested; Windows runs only a CI smoke test.

## Setup details

The examples write `benchkeeper` for `npx benchkeeper@6.23.0`. Until the first npm release, run the app from a clone: `git clone --depth 1 --branch setup-v6.23 https://github.com/ESchuderer/BenchKeeper.git && npm ci --prefix BenchKeeper/app --omit=dev`, then `node BenchKeeper/app/bin/benchkeeper.mjs <command>`. The browser UI from a clone needs a build first ([app/README.md](../app/README.md#setup)).

`plan` lists each change, file changes with their diff and commands as the command line. `apply` asks per change: `--yes` applies the default selection without questions, `--all` applies every change including the removals, `--pack matt-pocock` adds Matt Pocock's skills. In the browser, the Dashboard shows the doctor findings, and Fix everything walks through the global plan, the projects you pick and the steps left by hand. Each skills CLI install in a plan runs first in a scratch folder, so the plan lists the files it would write.

What a full `apply` writes (`--level lite` or `--level standard` plans the BenchKeeper plugin alone; `benchkeeper doctor` names the level it finds and what the next one adds):

- the global rules: Claude Code `$HOME/.claude/rules/00-global.md`; Codex, Gemini CLI and Copilot a marked block in `$HOME/.codex/AGENTS.md`, `$HOME/.gemini/GEMINI.md`, `$HOME/.copilot/copilot-instructions.md` (text outside the block stays)
- the plugins BenchKeeper and Ponytail (pinned to a tag, since it runs a `SessionStart` hook; level `full` in `$HOME/.config/ponytail/config.json`) in Claude Code and Codex; Gemini CLI and Copilot get copies of the BenchKeeper skills in `$HOME/.gemini/skills` and `$HOME/.copilot/skills`
- Claude Code settings (merged, other keys and hooks stay): error reporting, feedback survey and `/feedback` off, local transcripts kept 14 days instead of 30, the stable update channel (typically about one week behind latest, [docs](https://code.claude.com/docs/en/setup#configure-release-channel)), subagents without a model on Sonnet, the advisor on Opus, Remote Control on at startup, the clear-context offer when you accept a plan, and attribution hidden: no trailer or co-author line on commits, no attribution text in pull request descriptions, no session link (`attribution` set to empty `commit` and `pr` and `sessionUrl: false`; change it in Agent settings)
- Codex commit trailer: setup writes no key for it. Current Codex reads a commit attribution switch from the account's settings (`codex-rs/ext/git-attribution/src/policy.rs` in [openai/codex](https://github.com/openai/codex/blob/main/codex-rs/ext/git-attribution/src/policy.rs)) and adds none for API-key or logged-out sessions; turn it off in the Codex account settings. The `config.toml` key named in older Codex notes is unverified for this version.
- the default model `opusplan` in Claude Code (Opus in plan mode, Sonnet otherwise), as its own change since it replaces the model you set. Orca starts `claude` without `--model`, so it applies there too. Not benchmarked.
- default effort `high` in Claude Code (also saved for Opus 5.5 and Sonnet 5.5, which ignore the global key) and in Codex, and the Claude Code auto-compact window at 400000 tokens (defaults per model: [docs](https://code.claude.com/docs/en/model-config#default-auto-compact-thresholds)). Neither is benchmarked.
- optional, off unless chosen: the BenchKeeper tier band in Claude Code (`pluginConfigs` in `$HOME/.claude/settings.json`), a row above the prompt with the tier of the last answer, buttons that set the tier for the session, and a board button that opens the sessions board
- optional, off unless chosen, only with Orca installed: a worker-spec template for Orca orchestration and samples of `orca.yaml` and `.worktreeinclude` for new worktrees, written to the `orca` folder of the app config folder (never into a project)
- everything else installed globally, as removals that are off unless chosen: other rules files (`$HOME/.claude/CLAUDE.md`, other files in `$HOME/.claude/rules/`, `$HOME/.codex/AGENTS.override.md`), skills, plugins, marketplaces, MCP servers and hooks (Orca's own entries stay)
- the Dev Containers CLI at the newest release that is at least 7 days old (`npm i -g`, into your npm prefix), and the `find-skills` skill (with Orca: `orca-cli` and `orchestration`)

Settings files are merged: JSON by key with comments kept, Codex TOML by key, checked by parsing the result. A form the app cannot merge is reported for manual editing.

Undo: each run is recorded in `$HOME/.config/benchkeeper/ledger/`, and replaced and removed files go to `$HOME/.config/benchkeeper/backup/<run>/` (a failed backup stops its step). `benchkeeper history` lists the runs, and `benchkeeper undo <run>` (`--step` for one step) restores the files and runs the recorded reverse command of each command, such as uninstalling a plugin it installed. A command without one (removing a plugin, marketplace or MCP server you had) is reported as manual: reinstall it yourself. `benchkeeper restore <name>` restores a backup folder made by the earlier `setup.sh`. Diagnostics (`doctor`), setup profiles, eval cases, file checks (`test`) and skill evals: [app/README.md](../app/README.md#commands).

The app writes its setup files below your home directory and in the projects you choose, plus scratch folders in the system temp folder and the Dev Containers CLI in your npm prefix. It needs no root, sends no telemetry and never runs on its own. In a terminal it makes one request to the npm registry for a newer version and shows it (off with `BENCHKEEPER_NO_UPDATE_CHECK=1`, and when `CI` is set).

Lite level, plugin only: `npx benchkeeper@6.23.0 apply --level lite`, or by hand `claude plugin marketplace add ESchuderer/BenchKeeper#stable --sparse .claude-plugin plugins && claude plugin install benchkeeper@benchkeeper` (Codex: `codex plugin marketplace add ESchuderer/BenchKeeper@stable --sparse .claude-plugin --sparse plugins && codex plugin add benchkeeper@benchkeeper`).

## Per repo

1. Project setup, in the repository root: `npx benchkeeper@6.23.0 project apply --agents claude,codex` (the agents the repository uses), plus `--pack <id>` for the [library packs](../plugins/benchkeeper/library/README.md#packs), `--tier` for the default tier, `--env` for where the agent runs. It writes a block (the repository rules: load the workflow skill, ask open questions in one message, fix the cause of a failed check; where commands run, default tier, skill pointers), the packs' skills at pinned commits, and `.benchkeeper/state.json`, whose answers later runs reuse. By default the setup stays on this machine: the block goes into `CLAUDE.local.md` (which imports `AGENTS.md`) and `AGENTS.override.md` (Codex reads it instead of `AGENTS.md`, so the app rebuilds it from `AGENTS.md` on each apply), and every file the app writes is listed in `.git/info/exclude`, so nothing lands in the repository. `--share` commits it instead: the block in `AGENTS.md` and `CLAUDE.md` with `@AGENTS.md`. Your own `AGENTS.md` text, `docs/agents/` and `.devcontainer/` stay committed either way. `project plan` shows the same changes without writing. It lists the skills a pack choice adds and removes, and warns when two skills' descriptions overlap. `--disable <skill>` moves a skill to `.benchkeeper/disabled/` and `--enable` moves it back. Own packs: `benchkeeper packs save <id> --skill <name>...`, shared as one file with `packs export <id>` and `packs import <file>`; a pack file names library skills only.
2. The steps that need an agent, as a recorded session: `npx benchkeeper@6.23.0 record -- claude '/benchkeeper:setting-up-projects'` (Codex: `npx benchkeeper@6.23.0 record -- codex '$benchkeeper:setting-up-projects'`) for stack skills, the commands in `AGENTS.md` and the dev container. The repository must be a Git repository: the app snapshots it before and after, records the changed files (tracked and untracked, not ignored ones) and the Claude Code or Codex transcript when it finds one, and `benchkeeper undo <run>` restores those files. With the `matt-pocock` pack, also `/mattpocock-skills:setup-matt-pocock-skills` (issue tracker, triage labels, domain docs in `docs/agents/`).
3. Commit the result.

Where the agent runs (`--env`):

| Env | Agent | Project commands |
|---|---|---|
| `container` (default, unless the project's own `AGENTS.md` says the agent runs on the host: then `host-agent`, or `host` without `.devcontainer/`) | inside the dev container, started with `devcontainer exec --workspace-folder . claude`; sign-in from the host environment (`CLAUDE_CODE_OAUTH_TOKEN` through `remoteEnv`) or kept in a named volume | in the container |
| `host-agent` | on the host, with Git and file edits; `--sandbox` turns on Claude Code's sandbox with `devcontainer exec` and `podman` excluded, since rootless Podman cannot start inside it ([docs](https://code.claude.com/docs/en/sandboxing)) | through `devcontainer exec`, no host fallback |
| `sandbox` | a Docker Sandboxes microVM ([docs](https://docs.docker.com/ai/sandboxes/agents/)), not tested with this setup | in the microVM |
| `host` | on the host | on the host |

Setup scopes container mounts to the project: no host home, engine socket, privileged mode or credential forwarding beyond the sign-in variable. VS Code can forward Git credentials and SSH agents automatically ([credential sharing](https://github.com/microsoft/vscode-docs/blob/main/remote/advancedcontainers/sharing-git-credentials.md)). MCP, browser and language-server connections need container launchers; a host plugin or binary alone does not run in the container.

## Accounts

Several logins per agent, for example work and personal, each in a folder of its own. Register one with `npx benchkeeper@6.23.0 accounts add` (asks for the name and the agent; `--container --mount <path>` for a named volume in the project's dev container, mounted at that folder of the container: one its user can write, below its home folder), sign in with `accounts login <name>`, start the agent with `run --account <name> -- claude` (`codex` the same), and see the state with `accounts status`.

- The sign-in opens in a private browser window (Firefox, Chrome, Chromium or Edge), where no session of another account exists, so the sign-in page asks which account to use. Without such a browser, on a machine without a display or with `--no-browser`, the link is printed (Codex: with its one-time code). When the browser shows a code, paste it at the prompt.
- On the host an account is the folder `CLAUDE_CONFIG_DIR` (Claude Code) or `CODEX_HOME` (Codex) with its own login, settings and history. In a dev container it is a named volume mounted as that folder, so the sign-in survives a rebuild; the sign-in runs inside the container. A mount applies when the container is created: `accounts login` starts the container with the volumes of all container accounts and prints the command that recreates an existing one that lacks them.
- A hijacked session in a container can read the credentials in the volume or the variable ([warning](https://code.claude.com/docs/en/devcontainer)). Keep the egress firewall of that page in mind; BenchKeeper never sets `--dangerously-skip-permissions`.
- Optional token for unattended containers: `accounts login <name> --token` (Claude Code `setup-token`, a subscription is needed, requests to the model only) is kept in the OS credential store, never in a file, the registry, the ledger or `devcontainer.json`, and reaches one launch through `run --token`. Where no credential store works the command refuses. Codex: pipe the access token (`printenv NAME | benchkeeper accounts login <name> --token`) and it goes to `codex login --with-access-token` in the account's folder.
- `run`, `accounts status` and `doctor` check the sign-in first and name the command that fixes a login that is gone, and a kept token in its 11th month. Switching accounts is your choice at a launch, never inside a session, and nothing rotates accounts mid-session. Without the opt-in below, nothing switches accounts when a limit is reached either.
- Usage (Claude Code; Codex has no documented source): `accounts track <name>` adds a status line script and a `StopFailure` hook to the account's folder (a plan with a diff and undo; an account that already has a status line of its own is refused). They keep the used percentage and reset time of the 5-hour and 7-day window, and the type and time of a failed turn (rate limit, expired login, billing error), never a credential. `accounts status`, `doctor` and the Accounts view show what is left per window (100 minus the used percentage; a reading counts only until its window resets, after that it is unknown, not full), a notice below twice the minimum and the last failure. Below the minimum headroom (defaults: 5-hour 8 percent, 7-day 3 percent, not claims about what a task needs; `accounts limits` changes them, per account too) `run` shows the account, window, what is left and the reset time, and asks before it starts; `--yes` or `accounts limits --continue-below on` starts anyway. A status line in a project's own settings takes precedence over the account's, and then no reading is kept.
- Opt-in auto-pick, off by default (`accounts limits --auto-pick on`, and `accounts limits <name> --pool <pool>` for the accounts of one person): a new `run` under the default account that is below its minimum starts under the pool member with the most headroom, or, with no member at or above its minimum, stops with the reason or (`--when-none wait`) waits for the earliest reset. The account used is printed. It never acts inside a running session and never for an account named with `--account`. Rotating accounts at a limit may be read as bypassing a protective measure: the provider's consumer terms prohibit "bypassing any of our systems or protective measures" ([text](https://www.anthropic.com/legal/consumer-terms), section 3) and do not say either way, so the setting is yours to carry.
- `run` gives the agent the app's filtered environment (no `GH_TOKEN`, API keys or other credentials of your shell) plus the account's one folder variable.

The Accounts view of the app does the same: add an account as a plan, check it, and sign in with the steps shown (private window, a field for the code, check). The token is set in a terminal only. Every command and its output keys: [App reference](../app/README.md#commands).

## Frameworks

Optional, per project: `npx benchkeeper@6.23.0 project apply --framework <id>` (`npx benchkeeper@6.23.0 frameworks` lists them with their evidence; the setup form in the browser shows the same). The doctor reports a second workflow owner, and a framework installed outside the project that the setup did not record.

<!-- generated:frameworks -->
Project setup asks first: it shows the list and installs nothing you did not choose. A framework that owns the workflow is a singleton: at most one per project, and choosing it takes BenchKeeper's own workflow skill out of that project. Parts sit beside it. Everything installs inside the project; what cannot is labelled.

| Framework | Role | Installs | Evaluation |
|---|---|---|---|
| [Superpowers](https://github.com/obra/superpowers) | workflow owner | a Claude Code plugin enabled for this project only; its plugin files stay in the user's plugin cache | [superpowers.md](../evaluations/workflow-frameworks/superpowers.md) |
| [Matt Pocock's skills](https://github.com/mattpocock/skills) | parts | the `matt-pocock` pack; its plugin installs for the user, outside the project | [mattpocock-skills.md](../evaluations/skill-libraries/mattpocock-skills.md) |
| [ECC](https://github.com/affaan-m/ECC) | parts | three single skills at a pinned commit, no plugin and no hooks | [EVALUATIONS.md](../EVALUATIONS.md) |
| [agency-agents](https://github.com/msitarzewski/agency-agents) | parts | a pick of agent files fetched at a pinned commit | [EVALUATIONS.md](../EVALUATIONS.md) |
<!-- /generated:frameworks -->

## Update

- BenchKeeper's plugin and the rules and settings: after a release ([CHANGELOG.md](../CHANGELOG.md)), `npx benchkeeper@<version> plan`, then `apply` (from a clone: `git -C BenchKeeper fetch --tags && git -C BenchKeeper checkout setup-v<major>.<minor>`, then the same commands through `node BenchKeeper/app/bin/benchkeeper.mjs`). The app adds BenchKeeper's marketplace at the branch `stable`, which each release moves, so the plan updates the plugin with `claude plugin marketplace update benchkeeper` and `claude plugin update benchkeeper@benchkeeper` (Codex: `codex plugin marketplace upgrade benchkeeper`). A marketplace added at another ref, for example the default branch, stays there: the plan names the commands to move it by hand, since removing a marketplace uninstalls its plugins and deletes their options and data in Claude Code.
- Projects: `benchkeeper projects add <dir>` (or `projects scan <root>` to find them) registers projects set up by the app. `benchkeeper update-all [dir..]` (every registered project, or only the registered ones named; in the browser: Projects, Dashboard > Fix everything, or Dashboard > one-run setup for local setups) lists each project's changes and asks once. For a local setup it writes the changes in the checkout. For a shared one (`--share`) it creates branch `chore/agent-setup-<version>` in a worktree in the app's cache folder, commits the new setup from `.benchkeeper/state.json`, and pushes and opens a pull request when `origin` is on GitHub (`--no-push` keeps it local; `--dry-run` stops after the list; one run pushes to at most 25 GitHub repositories, `--max N` raises that; a failed fetch of `origin` stops the push). A repository that still has its setup committed (set up before 6.3) gets a pull request that removes the committed copies instead (branch `chore/agent-setup-local`, also `benchkeeper projects unshare`); after you merge and pull, the next Update all writes the setup locally from the answers it kept. `project apply` refuses a local setup there until that pull request is merged and pulled (`--share` keeps it committed). Shared projects with uncommitted changes and projects without a state file are skipped, and one project's failure does not stop the others. Manage the list in Projects or with `projects rename|relocate|remove`: a display name and notes (kept in the list only), Relocate for a folder that moved (the answers and the history follow), `remove` to unregister, and `remove --setup` to take BenchKeeper's setup out of a project and keep it registered (every file is listed first; a local setup is one run you can undo, a shared one a pull request). Plugin installs and agent sessions are not part of it: run `apply` and the recorded sessions yourself.
- Matt Pocock's skills update through their marketplaces. Ponytail's marketplace stays on the tag it was added with (the app adds `v5.3.2`). A newer tag means adding the marketplace again with the new `#ref` (Claude Code) or `@ref` (Codex).
- Repository skills (library and stack) are pinned in `skills-lock.json`, and `/benchkeeper:setting-up-projects` proposes their updates. `/benchkeeper:maintaining-repos` proposes bumps for pins in docs and scripts.

## Sessions board

`benchkeeper board` writes `$HOME/.config/benchkeeper/board.html` and opens it; the browser UI shows the same page under Sessions and rewrites the file on each scan, and the tier band's board button opens it. Per Claude Code and Codex session on this machine: project, tier and change type (first and last tier line), the pattern (loop: `/goal`, `/loop` or a scheduled wakeup ran; group: subagents ran, their count is shown; Orca worker: a dispatched Orca worker, with the run id from the `Orca run:` line of the worker-spec template; single: none of these; when several apply, the first of Orca worker, loop, group wins), the setup installed at the time (BenchKeeper version, Matt Pocock's skills, Ponytail, packs), the skills used, the last test run, pull request state, time, tokens and, for Claude Code, the API-equivalent cost its transcript records. Pattern is detected for Claude Code sessions; for Codex only the group (subagent rollouts) is. A summary cached before the pattern was read, whose transcript is gone, shows `not recorded`. Filters by project (preset to the projects registered in the app and their Git worktrees when they have sessions, All shows every session), agent, tier, pattern, setup and period; the charts have tables beside them. It reads the transcripts in `$HOME/.claude/projects/` and `$HOME/.codex/sessions/`, the app's run ledger and `gh pr view`, caches in `$HOME/.cache/benchkeeper/`; only the `gh` requests leave the machine.

## What the app writes and what it never does

Writes: the rules, settings and skill files of the agents you select (below your home folder), the files of a project you register (inside the folder, never its `.git` except `info/exclude`), a ledger and backups in the `.config/benchkeeper` folder of your home (created readable by you only), and, for Update all, a worktree, one commit and a branch per repository, plus a push and a pull request when `origin` is on GitHub and you did not pass `--no-push`. Commands such as plugin installs run the agents' own CLIs and write what those write; the app backs up and restores only the paths it names.

The app itself never: runs a command through a shell, writes outside the folders of a run (also through links), force pushes, deletes a remote branch, merges a pull request, runs `git clean` or `git reset` on your checkout, starts a second run while one is active, or adds telemetry. Removals are off until you select them, except removals of files the app identifies as its own by content. What leaves the machine: what `git`, `gh`, the package registries and the agents' own CLIs send (Update all's push and pull request for a GitHub origin; whatever an advice or eval session lets its agent read), and the update notice. The local server listens on 127.0.0.1 only, behind a one-time token, a cookie and a key header, and checks Host and Origin.

Which control enforces each limit, which tests cover it and which limits are still open, and what an agent does with untrusted text (web pages, issue comments, repository files) and which controls limit it: [docs/security.md](security.md). Report a vulnerability as described in [SECURITY.md](../SECURITY.md).

## Telemetry

| Tool | Setting |
|---|---|
| Claude Code | `DISABLE_ERROR_REPORTING=1`, `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1`, `DISABLE_FEEDBACK_COMMAND=1` |
| Claude Code, not set | `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`: each disables feature flags and the advisor. `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` also disables Remote Control ([docs](https://code.claude.com/docs/en/env-vars)) |
| Codex | `[analytics] enabled = false` |
| skills CLI | `DO_NOT_TRACK=1` per command only |
