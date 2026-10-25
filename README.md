<p align="center"><img src="assets/logo.svg" alt="BenchKeeper logo" width="160"></p>

# BenchKeeper

<!-- generated:description -->
BenchKeeper gives Claude Code and Codex the same short rules, a workflow skill that sizes each task, and a per-repository setup (dev container, AGENTS.md, skills at pinned versions). Its app (`npx benchkeeper@6.7.0`) installs and updates that setup on your machine and in your repositories, shows each change before it applies it, and records every run for undo.
<!-- /generated:description -->

<!-- generated:core -->
**Optional: [mattpocock/skills](https://github.com/mattpocock/skills) by Matt Pocock:** his skills run the phases of standard and full work when installed (grilling, spec and tickets, tests first, code review, pull request).
<!-- /generated:core -->

BenchKeeper ships as a plugin for Claude Code and Codex ([plugins/benchkeeper](plugins/benchkeeper)), plus the [app](app) for what a plugin cannot carry: project setup, the global rules and settings, history and undo.

Three levels, from the smallest: a plugin cannot ship always-on instructions, so lite relies on the `workflow` skill description to trigger (trigger rate unverified: [evaluation](evaluations/practices/lite-install.md)). Each level contains the one before.

<!-- generated:levels -->
| Level | Contains | Writes | Command |
|---|---|---|---|
| Lite | the BenchKeeper plugin: the `workflow`, `tier`, `setting-up-projects` and `maintaining-repos` skills | nothing outside the plugin install, besides the app's run record for undo | `npx benchkeeper@6.7.0 apply --level lite` |
| Standard | lite plus the local project block: `CLAUDE.local.md`, `AGENTS.override.md` and the git exclude list | local files in each project you run `project apply` in | `npx benchkeeper@6.7.0 apply --level standard && npx benchkeeper@6.7.0 project apply` |
| Full | standard plus the global rules, Ponytail, Claude Code and Codex settings, packs and the app | global rule files, settings and packs | `npx benchkeeper@6.7.0 apply --level full` |
<!-- /generated:levels -->

Claude Code, Codex, Gemini CLI and GitHub Copilot CLI are each optional (Gemini CLI and Copilot untested). The app configures the agents it finds on `PATH`. It does not install agent CLIs. Linux and macOS are tested; Windows runs only a CI smoke test.

## Prerequisites

Not installed by BenchKeeper.

<!-- generated:prerequisites -->
| Tool | Needed for |
|---|---|
| [Claude Code](https://code.claude.com/docs/en/setup) | agent, at least one (Gemini CLI and GitHub Copilot CLI also work, untested) |
| [Codex CLI](https://developers.openai.com/codex/cli) | agent, at least one (Gemini CLI and GitHub Copilot CLI also work, untested) |
| [Git](https://git-scm.com/downloads) | clone, branches, commits |
| [GitHub CLI](https://cli.github.com/) | issues and pull requests (optional, local branches without it) |
| [Node.js and npm](https://nodejs.org/en/download) | the app (Node.js 22), Dev Containers CLI and skills CLI, npm with a user prefix such as `~/.local` |
| [Docker Engine](https://docs.docker.com/engine/install/) | dev containers (`container` and `host-agent` modes; Podman works too) |
| [VS Code](https://code.visualstudio.com/download) | optional, attach to the devcontainer |
<!-- /generated:prerequisites -->

## Setup steps

The examples write `benchkeeper` for `npx benchkeeper@6.7.0`. Until the first npm release, run the app from a clone: `git clone --depth 1 --branch setup-v6.7 https://github.com/ESchuderer/BenchKeeper.git && npm ci --prefix BenchKeeper/app --omit=dev`, then `node BenchKeeper/app/bin/benchkeeper.mjs <command>`. The browser UI from a clone needs a build first ([app/README.md](app/README.md#setup)).

1. Install the [prerequisites](#prerequisites): at least one agent and Node.js 22.
2. Review the plan: `npx benchkeeper@6.7.0 plan`. It lists each change, file changes with their diff and commands as the command line, and writes nothing.
3. Apply: `npx benchkeeper@6.7.0 apply` asks per change. `--yes` applies the default selection without questions, `--all` applies every change including the removals. `--pack matt-pocock` adds Matt Pocock's skills. Without a command, `npx benchkeeper@6.7.0` opens the same steps in the browser: the Dashboard shows the doctor findings, and Fix everything walks through the global plan, the projects you pick and the steps left by hand. In the browser, each skills CLI install in a plan runs first in a scratch folder, so the plan lists the files it would write.
4. Restart the agents.

What a full `apply` writes (`--level lite` or `--level standard` plans the BenchKeeper plugin alone; `benchkeeper doctor` names the level it finds and what the next one adds):

- the global rules: Claude Code `~/.claude/rules/00-global.md`; Codex, Gemini CLI and Copilot a marked block in `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`, `~/.copilot/copilot-instructions.md` (text outside the block stays)
- the plugins BenchKeeper and Ponytail (pinned to a tag, since it runs a `SessionStart` hook; level `full` in `~/.config/ponytail/config.json`) in Claude Code and Codex; Gemini CLI and Copilot get copies of the BenchKeeper skills in `~/.gemini/skills` and `~/.copilot/skills`
- Claude Code settings (merged, other keys and hooks stay): error reporting, feedback survey and `/feedback` off, local transcripts kept 14 days instead of 30, the stable update channel (typically about one week behind latest, [docs](https://code.claude.com/docs/en/setup#configure-release-channel)), subagents without a model on Sonnet, the advisor on Opus, Remote Control on at startup, the clear-context offer when you accept a plan, and attribution: commits end with `Assisted-by: generative AI`, pull requests with "Created with the assistance of generative AI.", without a session link
- the default model `opusplan` in Claude Code (Opus in plan mode, Sonnet otherwise), as its own change since it replaces the model you set. Orca starts `claude` without `--model`, so it applies there too. Not benchmarked.
- default effort `high` in Claude Code (also saved for Opus 5.5 and Sonnet 5.5, which ignore the global key) and in Codex, and the Claude Code auto-compact window at 400000 tokens (defaults per model: [docs](https://code.claude.com/docs/en/model-config#default-auto-compact-thresholds)). Neither is benchmarked.
- optional, off unless chosen: the BenchKeeper tier band in Claude Code (`pluginConfigs` in `~/.claude/settings.json`), a row above the prompt with the tier of the last answer, buttons that set the tier for the session, and a board button that opens the sessions board
- everything else installed globally, as removals that are off unless chosen: other rules files (`~/.claude/CLAUDE.md`, other files in `~/.claude/rules/`, `~/.codex/AGENTS.override.md`), skills, plugins, marketplaces, MCP servers and hooks (Orca's own entries stay)
- the Dev Containers CLI at the newest release that is at least 7 days old (`npm i -g`, into your npm prefix), and the `find-skills` skill (with Orca: `orca-cli` and `orchestration`)

Settings files are merged: JSON by key with comments kept, Codex TOML by key, checked by parsing the result. A form the app cannot merge is reported for manual editing.

Undo: each run is recorded in `~/.config/benchkeeper/ledger/`, and replaced and removed files go to `~/.config/benchkeeper/backup/<run>/` (a failed backup stops its step). `benchkeeper history` lists the runs, and `benchkeeper undo <run>` (`--step` for one step) restores the files and runs the recorded reverse command of each command, such as uninstalling a plugin it installed. A command without one (removing a plugin, marketplace or MCP server you had) is reported as manual: reinstall it yourself. `benchkeeper restore <name>` restores a backup folder made by the earlier `setup.sh`. Diagnostics (`doctor`), setup profiles, eval cases, harness tests and skill evals: [app/README.md](app/README.md#commands).

The app writes its setup files below your home directory and in the projects you choose, plus scratch folders in the system temp folder and the Dev Containers CLI in your npm prefix. It needs no root, sends no telemetry and never runs on its own. In a terminal it makes one request to the npm registry for a newer version and shows it (off with `BENCHKEEPER_NO_UPDATE_CHECK=1`, and when `CI` is set).

Lite level, plugin only: `npx benchkeeper@6.7.0 apply --level lite`, or by hand `claude plugin marketplace add ESchuderer/BenchKeeper#stable --sparse .claude-plugin plugins && claude plugin install benchkeeper@benchkeeper` (Codex: `codex plugin marketplace add ESchuderer/BenchKeeper@stable --sparse .claude-plugin --sparse plugins && codex plugin add benchkeeper@benchkeeper`).

## Per repo

1. Project setup, in the repository root: `npx benchkeeper@6.7.0 project apply --agents claude,codex` (the agents the repository uses), plus `--pack <id>` for the [library packs](plugins/benchkeeper/library/README.md#packs), `--tier` for the default tier, `--env` for where the agent runs. It writes a block (the repository rules: load the workflow skill, ask open questions in one message, fix the cause of a failed check; where commands run, default tier, skill pointers), the packs' skills at pinned commits, and `.benchkeeper/state.json`, whose answers later runs reuse. By default the setup stays on this machine: the block goes into `CLAUDE.local.md` (which imports `AGENTS.md`) and `AGENTS.override.md` (Codex reads it instead of `AGENTS.md`, so the app rebuilds it from `AGENTS.md` on each apply), and every file the app writes is listed in `.git/info/exclude`, so nothing lands in the repository. `--share` commits it instead: the block in `AGENTS.md` and `CLAUDE.md` with `@AGENTS.md`. Your own `AGENTS.md` text, `docs/agents/` and `.devcontainer/` stay committed either way. `project plan` shows the same changes without writing. It lists the skills a pack choice adds and removes, and warns when two skills' descriptions overlap. `--disable <skill>` moves a skill to `.benchkeeper/disabled/` and `--enable` moves it back. Own packs: `benchkeeper packs save <id> --skill <name>...`, shared as one file with `packs export <id>` and `packs import <file>`; a pack file names library skills only.
2. The steps that need an agent, as a recorded session: `npx benchkeeper@6.7.0 record -- claude '/benchkeeper:setting-up-projects'` (Codex: `npx benchkeeper@6.7.0 record -- codex '$benchkeeper:setting-up-projects'`) for stack skills, the commands in `AGENTS.md` and the dev container. The repository must be a Git repository: the app snapshots it before and after, records the changed files (tracked and untracked, not ignored ones) and the Claude Code or Codex transcript when it finds one, and `benchkeeper undo <run>` restores those files. With the `matt-pocock` pack, also `/mattpocock-skills:setup-matt-pocock-skills` (issue tracker, triage labels, domain docs in `docs/agents/`).
3. Commit the result.

Where the agent runs (`--env`):

| Env | Agent | Project commands |
|---|---|---|
| `container` (default, unless the project's own `AGENTS.md` says the agent runs on the host: then `host-agent`, or `host` without `.devcontainer/`) | inside the dev container, started with `devcontainer exec --workspace-folder . claude`; sign-in from the host environment (`CLAUDE_CODE_OAUTH_TOKEN` through `remoteEnv`) or kept in a named volume | in the container |
| `host-agent` | on the host, with Git and file edits; `--sandbox` turns on Claude Code's sandbox with `devcontainer exec` and `podman` excluded, since rootless Podman cannot start inside it ([docs](https://code.claude.com/docs/en/sandboxing)) | through `devcontainer exec`, no host fallback |
| `sandbox` | a Docker Sandboxes microVM ([docs](https://docs.docker.com/ai/sandboxes/agents/)), not tested with this setup | in the microVM |
| `host` | on the host | on the host |

Setup scopes container mounts to the project: no host home, engine socket, privileged mode or credential forwarding beyond the sign-in variable. VS Code can forward Git credentials and SSH agents automatically ([credential sharing](https://github.com/microsoft/vscode-docs/blob/main/remote/advancedcontainers/sharing-git-credentials.md)). MCP, browser and language-server connections need container launchers; a host plugin or binary alone does not run in the container.

## Frameworks

Optional, per project: `npx benchkeeper@6.7.0 project apply --framework <id>` (`npx benchkeeper@6.7.0 frameworks` lists them with their evidence; the setup form in the browser shows the same). The doctor reports a second workflow owner, and a framework installed outside the project that the setup did not record.

<!-- generated:frameworks -->
Project setup asks first: it shows the list and installs nothing you did not choose. A framework that owns the workflow is a singleton: at most one per project, and choosing it takes BenchKeeper's own workflow skill out of that project. Parts sit beside it. Everything installs inside the project; what cannot is labelled.

| Framework | Role | Installs | Evaluation |
|---|---|---|---|
| [Superpowers](https://github.com/obra/superpowers) | workflow owner | a Claude Code plugin enabled for this project only | [superpowers.md](evaluations/workflow-frameworks/superpowers.md) |
| [Matt Pocock's skills](https://github.com/mattpocock/skills) | parts | the `matt-pocock` pack | [mattpocock-skills.md](evaluations/skill-libraries/mattpocock-skills.md) |
| [ECC](https://github.com/affaan-m/ECC) | parts | four single skills at a pinned commit, no plugin and no hooks | [EVALUATIONS.md](EVALUATIONS.md) |
| [agency-agents](https://github.com/msitarzewski/agency-agents) | parts | a pick of agent files fetched at a pinned commit | [agency-agents.md](evaluations/workflow-frameworks/agency-agents.md) |
<!-- /generated:frameworks -->

## Update

- BenchKeeper's plugin and the rules and settings: after a release ([CHANGELOG.md](CHANGELOG.md)), `npx benchkeeper@<version> plan`, then `apply` (from a clone: `git -C BenchKeeper fetch --tags && git -C BenchKeeper checkout setup-v<major>.<minor>`, then the same commands through `node BenchKeeper/app/bin/benchkeeper.mjs`). The app adds BenchKeeper's marketplace at the branch `stable`, which each release moves, so the plan updates the plugin with `claude plugin marketplace update benchkeeper` and `claude plugin update benchkeeper@benchkeeper` (Codex: `codex plugin marketplace upgrade benchkeeper`). A marketplace added at another ref, for example the default branch, stays there: the plan names the commands to move it by hand, since removing a marketplace uninstalls its plugins and deletes their options and data in Claude Code.
- Projects: `benchkeeper projects add <dir>` (or `projects scan <root>` to find them) registers projects set up by the app. `benchkeeper update-all` (in the browser: Projects, Dashboard > Fix everything, or Dashboard > one-run setup for local setups) lists each project's changes and asks once. For a local setup it writes the changes in the checkout. For a shared one (`--share`) it creates branch `chore/agent-setup-<version>` in a worktree in the app's cache folder, commits the new setup from `.benchkeeper/state.json`, and pushes and opens a pull request when `origin` is on GitHub (`--no-push` keeps it local; `--dry-run` stops after the list; one run pushes to at most 25 GitHub repositories, `--max N` raises that; a failed fetch of `origin` stops the push). A repository that still has its setup committed (set up before 6.3) gets a pull request that removes the committed copies instead (branch `chore/agent-setup-local`, also `benchkeeper projects unshare`); after you merge and pull, the next Update all writes the setup locally from the answers it kept. `project apply` refuses a local setup there until that pull request is merged and pulled (`--share` keeps it committed). Shared projects with uncommitted changes and projects without a state file are skipped, and one project's failure does not stop the others. Manage the list in Projects or with `projects rename|relocate|remove`: a display name and notes (kept in the list only), Relocate for a folder that moved (the answers and the history follow), `remove` to unregister, and `remove --setup` to take BenchKeeper's setup out of a project and keep it registered (every file is listed first; a local setup is one run you can undo, a shared one a pull request). Plugin installs and agent sessions are not part of it: run `apply` and the recorded sessions yourself.
- Matt Pocock's skills update through their marketplaces. Ponytail's marketplace stays on the tag it was added with (the app adds `v5.3.2`). A newer tag means adding the marketplace again with the new `#ref` (Claude Code) or `@ref` (Codex).
- Repository skills (library and stack) are pinned in `skills-lock.json`, and `/benchkeeper:setting-up-projects` proposes their updates. `/benchkeeper:maintaining-repos` proposes bumps for pins in docs and scripts.

## Sessions board

`benchkeeper board` writes `~/.config/benchkeeper/board.html` and opens it; the browser UI shows the same page under Sessions and rewrites the file on each scan, and the tier band's board button opens it. Per Claude Code and Codex session on this machine: project, tier and change type (first and last tier line), the setup installed at the time (BenchKeeper version, Matt Pocock's skills, Ponytail, packs), the skills used, the last test run, pull request state, time, tokens and, for Claude Code, the API-equivalent cost its transcript records. Filters by project (preset to the projects registered in the app and their Git worktrees when they have sessions, All shows every session), agent, tier, setup and period; the charts have tables beside them. It reads the transcripts in `~/.claude/projects/` and `~/.codex/sessions/`, the app's run ledger and `gh pr view`, caches in `~/.cache/benchkeeper/`; only the `gh` requests leave the machine.

## What the app writes and what it never does

Writes: the rules, settings and skill files of the agents you select (below your home folder), the files of a project you register (inside the folder, never its `.git` except `info/exclude`), a ledger and backups in the `.config/benchkeeper` folder of your home (created readable by you only), and, for Update all, a worktree, one commit and a branch per repository, plus a push and a pull request when `origin` is on GitHub and you did not pass `--no-push`. Commands such as plugin installs run the agents' own CLIs and write what those write; the app backs up and restores only the paths it names.

The app itself never: runs a command through a shell, writes outside the folders of a run (also through links), force pushes, deletes a remote branch, merges a pull request, runs `git clean` or `git reset` on your checkout, starts a second run while one is active, or adds telemetry. Removals are off until you select them, except removals of files the app identifies as its own by content. What leaves the machine: what `git`, `gh`, the package registries and the agents' own CLIs send (Update all's push and pull request for a GitHub origin; whatever an advice or eval session lets its agent read), and the update notice. The local server listens on 127.0.0.1 only, behind a one-time token, a cookie and a key header, and checks Host and Origin.

Which control enforces each limit, which tests cover it and which limits are still open: [docs/security.md](docs/security.md). Report a vulnerability as described in [SECURITY.md](SECURITY.md).

## Benchmarks

Each setup runs as its own arm on the same greenfield and brownfield briefs. Scores, time per task and app reviews per arm: [benchmark pages](https://eschuderer.github.io/BenchKeeper/bench/). Reports: [bench/results](bench/results). Method: [bench/PROTOCOL.md](bench/PROTOCOL.md).

## Contents

| Path | What | Linked as |
|---|---|---|
| [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json) | the marketplace, read by Claude Code and Codex | `~/.claude/plugins/`, `~/.codex/plugins/` |
| [plugins/benchkeeper/rules/global.md](plugins/benchkeeper/rules/global.md) | global rules | written by the app to `~/.claude/rules/00-global.md`, and as a block into the Codex, Gemini CLI and Copilot instruction files |
| [plugins/benchkeeper/rules/project.md](plugins/benchkeeper/rules/project.md) | repository rules (standard level and up) | part of the project block the app writes (`CLAUDE.local.md`, `AGENTS.override.md`, or `AGENTS.md` with `--share`) |
| [app](app) | the installer: global setup, project setup, history and undo, CLI and browser UI ([README](app/README.md)) | `npx benchkeeper@6.7.0` |
| [plugins/benchkeeper/skills/setting-up-projects](plugins/benchkeeper/skills/setting-up-projects/SKILL.md) | set up or update one repo: devcontainer, AGENTS.md, library and stack skills, Matt Pocock's repository setup (`docs/agents/`), default tier, other configuration to remove | plugin skill `benchkeeper:setting-up-projects` |
| [plugins/benchkeeper/skills/workflow](plugins/benchkeeper/skills/workflow/SKILL.md) | task kind and tier, then the playbook for software changes, docs passes or research, batch mode, long checks at the end | plugin skill `benchkeeper:workflow` |
| [plugins/benchkeeper/skills/tier](plugins/benchkeeper/skills/tier/SKILL.md) | sets the tier for the rest of the session (`quick`, `standard`, `full`, `research`, or `auto` to let the workflow pick) | plugin skill `/benchkeeper:tier`, user-invoked |
| [plugins/benchkeeper/hooks/tier](plugins/benchkeeper/hooks/tier/register.tsx) | the optional tier band in Claude Code: the tier of the last answer above the prompt, buttons for `/benchkeeper:tier` and the sessions board, the override kept through compaction and resume | Claude Code plugin option `tierBand`, off by default |
| [plugins/benchkeeper/skills/maintaining-repos](plugins/benchkeeper/skills/maintaining-repos/SKILL.md) | the Maintain pass on request: dead code, debt, dependency audit, version pins, docs drift, unused skills | plugin skill `benchkeeper:maintaining-repos` |
| [plugins/benchkeeper/library](plugins/benchkeeper/library/README.md) | skills installed per project, grouped into packs (frontend, testing, security, science, docs, data, marketing, operations, Matt Pocock's) | installed into a project by `benchkeeper project apply` or `setting-up-projects` |
| [CHANGELOG.md](CHANGELOG.md) | setup versions (tags `setup-v*`) | not linked |
| [web](web) | the site (Astro, Mantine), deployed to GitHub Pages | not linked |

## Components

| Component | Scope | Purpose |
|---|---|---|
| [Dev Containers](https://code.visualstudio.com/docs/devcontainers/devcontainer-cli) | tooling on host, configuration per repo | the agent runs inside the container by default; `--env` also offers the agent on the host with project commands in the container, a Docker Sandboxes microVM (untested), or no container |
| [Ponytail](https://github.com/DietrichGebert/ponytail), level `full` | global, Claude + Codex | implementation simplicity |
| [Matt Pocock's skills](https://github.com/mattpocock/skills), his install, optional | global plugin in both agents: Claude Code from the official marketplace (it pins a commit of his repository), Codex from his marketplace | workflow: grilling, domain docs, spec and tickets, TDD, bug diagnosis, code review, pull request, handoff. Per repo it reads the issue tracker, triage labels and domain docs from `docs/agents/` |
| [workflow](plugins/benchkeeper/skills/workflow/SKILL.md) | global, Claude + Codex | task kind (software change, docs pass, research) and tier (quick, standard, full), issue and pull request flow, pre-push correctness review, security review for risky changes; uses Matt Pocock's skills when installed |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | project connections, container browsers | browser checks |
| [find-skills](https://github.com/vercel-labs/skills) | global | skill search, used by `setting-up-projects` |

Per repo, committed: `.devcontainer/`, `AGENTS.md` (your own text), `docs/agents/` (with Matt Pocock's skills: from his `/setup-matt-pocock-skills`, with its `## Agent skills` block), `.mcp.json`, `.codex/config.toml`. Local by default, listed in `.git/info/exclude` (committed with `--share`): `CLAUDE.local.md` (shared: `CLAUDE.md`), `AGENTS.override.md`, `.agents/skills/` and `.claude/skills/` (library and stack skills), `skills-lock.json`, `.benchkeeper/`.

Global (per machine): the rules, the plugins (BenchKeeper, Ponytail, optionally Matt Pocock's skills), find-skills, settings.

Another Ponytail level for the current session: `/ponytail lite` or `/ponytail ultra` (Claude Code).

## How this stack was selected

- Quality: in BenchKeeper's brownfield runs no setup scored measurably above plain Claude Code (medians 82.9 to 86.2, Sonnet 5.5, k = 3, [report](bench/results/2026-10-17-openballistics.md)).
- Time: it depends on the version. setup-v3.3 with Matt Pocock's skills took a median 8.1 minutes against 12.8 for plain Claude Code, setup-v5.0 took 17.7 (same report). setup-v6.0 is not measured yet ([#132](https://github.com/ESchuderer/BenchKeeper/issues/132)).
- Cost: Ponytail cost less in all 6 recorded winery-react pairs (one trial each, [report](bench/results/2026-10-15-winery-react.md)); external results range from 10% less to 55% more ([evaluation](evaluations/behavior-modes/ponytail.md)).
- Skills by level: small composable skills. The full flow runs only for full-tier work, small tiers load targeted skills.
- Same setup everywhere: one machine install covers every repository. Each repository adds only its tracker, docs and stack.

For details, check the full data: [EVALUATIONS.md](https://github.com/ESchuderer/BenchKeeper/blob/main/EVALUATIONS.md) (Dev Containers and find-skills have no evaluation file), [benchmark pages](https://eschuderer.github.io/BenchKeeper/bench/).

## Telemetry

| Tool | Setting |
|---|---|
| Claude Code | `DISABLE_ERROR_REPORTING=1`, `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1`, `DISABLE_FEEDBACK_COMMAND=1` |
| Claude Code, not set | `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`: each disables feature flags and the advisor. `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` also disables Remote Control ([docs](https://code.claude.com/docs/en/env-vars)) |
| Codex | `[analytics] enabled = false` |
| skills CLI | `DO_NOT_TRACK=1` per command only |

## Recommended tools (optional)

Not installed by BenchKeeper.

**Parallel agents: pick one.** Orca, Nimbalyst and cmux each manage several agent sessions side by side. Running two duplicates the sessions and worktrees they track for the same repositories.

<!-- generated:tools -->
| Tool | Platforms | Gives you | Choose it when |
|---|---|---|---|
| [Orca](https://github.com/stablyai/orca) | macOS, Windows, Linux | one git worktree per agent, the same prompt across agents; terminal splits, SSH remote worktrees, mobile app; the app offers its `orca-cli` and `orchestration` skills | you want terminal-based parallel agents with worktrees, remote machines or mobile access |
| [Nimbalyst](https://github.com/Nimbalyst/nimbalyst) | macOS, Windows, Linux | parallel sessions on a kanban board, one-click worktree per session; every agent edit arrives as a diff you approve or reject; visual editors (Markdown, CSV, mockups, diagrams), task tracking, iOS app | you review changes visually and work on docs, mockups and tasks next to the agents |
| [cmux](https://github.com/manaflow-ai/cmux) | macOS only | Ghostty-based terminal with vertical tabs; notifications when an agent needs input and a sidebar with branch, PR status and ports; browser pane inside the terminal | you are on macOS and want a terminal without a separate app |
<!-- /generated:tools -->

Orca only: the app offers the `orca-cli` and `orchestration` skills. Existing Orca skills and hooks are kept ([Orca skill installation](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/cli/skills.mdx)).

<!-- generated:openhands -->
**Unattended or isolated runs: [OpenHands](https://github.com/OpenHands/OpenHands).** A self-hosted agent server with a web UI that runs work without you at the terminal.

- Each conversation can run in its own Docker container (`OH_CONVERSATION_RUNTIME=docker`), an isolation option BenchKeeper does not provide.
- Runs its own agent or hosts Claude Code, Codex and Gemini CLI.
- Automations on a schedule or on webhook events (GitHub, Slack, Linear), for example splitting GitHub issues into tasks.
- Without a sandbox, the local agent has full access to your filesystem.
- Unverified: whether agents inside its containers load the BenchKeeper rules and skills, which are installed on the host.
<!-- /generated:openhands -->
