<p align="center"><img src="assets/logo.svg" alt="BenchKeeper logo" width="160"></p>

# BenchKeeper

<!-- generated:description -->
BenchKeeper sets up Claude Code and Codex with short global rules, a workflow skill that sizes each task (quick, standard, full, research) and runs long checks once at the end, and a per-repository setup: devcontainer, AGENTS.md, stack skills at pinned versions. The app (`npx benchkeeper`), which you run yourself, installs the rules, settings and plugins (BenchKeeper, Ponytail, optionally Matt Pocock's skills), shows a diff before each change, and records every run for undo.
<!-- /generated:description -->

<!-- generated:core -->
**Optional: [mattpocock/skills](https://github.com/mattpocock/skills) by Matt Pocock:** his skills run the phases of standard and full work when installed (grilling, spec and tickets, tests first, code review, pull request).
<!-- /generated:core -->

One tool per job, exact versions for CLIs and MCP servers. BenchKeeper ships as a plugin for Claude Code and Codex ([plugins/benchkeeper](plugins/benchkeeper)), plus the [app](app) for what a plugin cannot carry: the global rules and settings, project setup, history and undo.

Claude Code, Codex, Gemini CLI and GitHub Copilot CLI are each optional (Gemini CLI and Copilot untested). The app configures the agents it finds on `PATH`. It does not install agent CLIs.

## Prerequisites

Not installed by BenchKeeper. The generated blocks in this README come from [web/src/data/facts.json](web/src/data/facts.json) (`devcontainer exec --docker-path podman --workspace-folder . node web/scripts/readme.mjs`).

<!-- generated:prerequisites -->
| Tool | Needed for |
|---|---|
| [Claude Code](https://code.claude.com/docs/en/setup) | agent (one or both) |
| [Codex CLI](https://developers.openai.com/codex/cli) | agent (one or both) |
| [Git](https://git-scm.com/downloads) | clone, branches, commits |
| [GitHub CLI](https://cli.github.com/) | issues and pull requests (optional, local branches without it) |
| [Node.js and npm](https://nodejs.org/en/download) | the app (Node.js 22), Dev Containers CLI and skills CLI, npm with a user prefix such as `~/.local` |
| [Docker Engine](https://docs.docker.com/engine/install/) | devcontainers |
| [VS Code](https://code.visualstudio.com/download) | optional, attach to the devcontainer |
<!-- /generated:prerequisites -->

## Setup steps

1. Install the [prerequisites](#prerequisites): at least one agent and Node.js 22.
2. Review the plan: `npx benchkeeper@6.0.0 plan`. It lists each change with a diff and writes nothing. Until the first npm release, run the app from a clone: `git clone --depth 1 https://github.com/ESchuderer/BenchKeeper.git && npm ci --prefix BenchKeeper/app --omit=dev`, then `node BenchKeeper/app/bin/benchkeeper.mjs plan`.
3. Apply: `npx benchkeeper@6.0.0 apply` asks before each change. `--yes` applies the default selection, `--all` adds the removals. `--pack matt-pocock` adds Matt Pocock's skills. Without a command, `npx benchkeeper@6.0.0` opens the same steps in the browser. The steps:
   - the global rules: Claude Code `~/.claude/rules/00-global.md`; Codex, Gemini CLI and Copilot a marked block in `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`, `~/.copilot/copilot-instructions.md` (text outside the block stays)
   - ask before `gh pr merge`, force pushes, `git reset --hard`, `git branch -D` and `git clean`: added to the ask list in `~/.claude/settings.json` (it prompts in bypass and auto mode too), and `~/.codex/rules/benchkeeper.rules`
   - the plugins BenchKeeper and Ponytail (pinned to a tag, since it runs a `SessionStart` hook) in Claude Code and Codex; Gemini CLI and Copilot get copies of the BenchKeeper skills in `~/.gemini/skills` and `~/.copilot/skills`
   - settings and telemetry (merged, other keys and hooks stay): error reporting, feedback survey and `/feedback` off, local transcripts kept 14 days instead of 30, the stable update channel (about one week behind latest), subagents without a model on Sonnet
   - the default model `opusplan` in Claude Code (Opus in plan mode, Sonnet otherwise), as its own change since it replaces the model you set. Orca starts `claude` without `--model`, so it applies there too. Not benchmarked.
   - default effort `high` in Claude Code (also saved for Opus 5.5 and Sonnet 5.5, which ignore the global key) and in Codex, and the Claude Code auto-compact window at 400000 tokens (default about 967K on 1M models). Neither is benchmarked. Anthropic gives no recommended window.
   - everything else installed globally, as removals that are off unless chosen: other rules files (`~/.claude/CLAUDE.md`, other files in `~/.claude/rules/`, `~/.codex/AGENTS.override.md`), skills, plugins, marketplaces, MCP servers and hooks (Orca's own entries stay)
   - the Dev Containers CLI at the newest release that is at least 7 days old, and the `find-skills` skill (with Orca: `orca-cli` and `orchestration`)

   Settings files are merged: JSON by key with comments kept, Codex TOML by key, checked by parsing the result. A form the app cannot merge is reported for manual editing. Each run is recorded in `~/.config/benchkeeper/ledger/`, replaced and removed files go to `~/.config/benchkeeper/backup/<run>/`, and a failed backup stops its step. `benchkeeper history` lists the runs, `benchkeeper undo <run>` restores them (`--step` for one step), `benchkeeper restore <date>` restores a backup made by the earlier `setup.sh`. Plugins, marketplaces and MCP servers are removed with the agent's own command, so their undo is a reinstall. `benchkeeper doctor [dir]` reports, without changing anything: variables that turn agent features off (`DISABLE_TELEMETRY`, `DO_NOT_TRACK`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_GROWTHBOOK`, `CLAUDE_CODE_DISABLE_ADVISOR_TOOL`, by name and file, never their values), rules and settings that differ from the setup, items outside the setup, a missing container engine, a newer skills CLI, and in a project: summary or layout sections in `AGENTS.md`, more than 5 skills, overlapping skill descriptions and broken skill links. It exits 1 on an error.

   The app writes only below your home directory and the projects you choose, needs no root, sends no telemetry and never runs on its own.
4. Restart the agents.

Skills only, without rules and settings: `claude plugin marketplace add ESchuderer/BenchKeeper --sparse .claude-plugin plugins && claude plugin install benchkeeper@benchkeeper` (Codex: `codex plugin marketplace add ESchuderer/BenchKeeper --sparse .claude-plugin --sparse plugins && codex plugin add benchkeeper@benchkeeper`).

## Per repo

1. Project setup, in the repository root: `npx benchkeeper@6.0.0 project apply --agents claude,codex`, plus `--pack <id>` for the [library packs](plugins/benchkeeper/library/README.md#packs), `--tier` for the default tier, `--env` for where the agent runs. It writes a block in `AGENTS.md` (where commands run, default tier, skill pointers), `CLAUDE.md` with `@AGENTS.md`, the packs' skills at pinned commits, and `.benchkeeper/state.json`, whose answers later runs reuse. `project plan` shows the same changes without writing. It lists the skills a pack choice adds and removes, and warns above 5 skills or when two skills' descriptions overlap. `--disable <skill>` moves a skill to `.benchkeeper/disabled/` and `--enable` moves it back. Own packs: `benchkeeper packs save <id> --skill <name>...`, shared as one file with `packs export <id>` and `packs import <file>`; a pack file names library skills only.
2. The steps that need an agent, as a recorded session: `npx benchkeeper@6.0.0 record -- claude '/benchkeeper:setting-up-projects'` (Codex: `codex '$benchkeeper:setting-up-projects'`) for stack skills, the commands in `AGENTS.md` and the dev container. The app records the files the session changed and its transcript, and `benchkeeper undo <run>` restores them. With the `matt-pocock` pack, also `/mattpocock-skills:setup-matt-pocock-skills` (issue tracker, triage labels, domain docs in `docs/agents/`).
3. Commit the result.

Where the agent runs (`--env`):

| Env | Agent | Project commands |
|---|---|---|
| `container` (default) | inside the dev container, started with `devcontainer exec --workspace-folder . claude`; sign-in from the host environment (`CLAUDE_CODE_OAUTH_TOKEN` through `remoteEnv`) or kept in a named volume | in the container |
| `host-agent` | on the host, with Git and file edits; `--sandbox` turns on Claude Code's sandbox with `devcontainer exec` and `podman` excluded, since rootless Podman cannot start inside it ([docs](https://code.claude.com/docs/en/sandboxing)) | through `devcontainer exec`, no host fallback |
| `sandbox` | a Docker Sandboxes microVM ([docs](https://docs.docker.com/ai/sandboxes/agents/)), not tested with this setup | in the microVM |
| `host` | on the host | on the host |

Setup scopes container mounts to the project: no host home, engine socket, privileged mode or credential forwarding beyond the sign-in variable. VS Code can forward Git credentials and SSH agents automatically ([credential sharing](https://github.com/microsoft/vscode-docs/blob/main/remote/advancedcontainers/sharing-git-credentials.md)). MCP, browser and language-server connections need container launchers; a host plugin or binary alone does not run in the container.

## Update

- BenchKeeper's plugin: its `version` changes with each setup release ([CHANGELOG.md](CHANGELOG.md)). Claude Code: `claude plugin marketplace update benchkeeper && claude plugin update benchkeeper@benchkeeper`, or turn on auto-update for the marketplace in `/plugin` (off by default for marketplaces outside Anthropic's, [docs](https://code.claude.com/docs/en/plugins/loading#which-marketplaces-and-plugins-auto-update)). Codex upgrades Git marketplaces at startup.
- Rules and settings: after a release that changes them, `npx benchkeeper@<version> apply` (from a clone: `git -C BenchKeeper pull`, then the same command through `node BenchKeeper/app/bin/benchkeeper.mjs`).
- Projects: `benchkeeper projects add <dir>` (or `projects scan <root>` to find them) registers projects set up by the app. `benchkeeper update-all` lists each project's changes, asks once, then per project creates branch `chore/agent-setup-<version>` in a worktree under `~/.cache/benchkeeper/worktrees/`, commits the new setup from `.benchkeeper/state.json`, and pushes and opens a pull request when `origin` is on GitHub (`--no-push` keeps it local). Projects with uncommitted changes or without a state file are skipped, and one project's failure does not stop the others. Plugin installs and agent sessions are not part of it: run `apply` and the recorded sessions yourself.
- Matt Pocock's skills update through their marketplaces. After one of his releases, he recommends running his setup again in each repository. Ponytail's marketplace stays on the tag it was added with (the app adds `v5.3.2`). A newer tag means adding the marketplace again with the new `#ref` (Claude Code) or `@ref` (Codex).
- Repository skills (library and stack) are pinned in `skills-lock.json`, and `/benchkeeper:setting-up-projects` proposes their updates. `/benchkeeper:maintaining-repos` proposes bumps for pins in docs and scripts.

## Benchmarks

Each setup runs as its own arm on the same greenfield and brownfield briefs. Scores, time per task and app reviews per arm: [benchmark pages](https://eschuderer.github.io/BenchKeeper/bench/). Reports: [bench/results](bench/results). Method: [bench/PROTOCOL.md](bench/PROTOCOL.md).

## Contents

| Path | What | Linked as |
|---|---|---|
| [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json) | the marketplace, read by Claude Code and Codex | `~/.claude/plugins/`, `~/.codex/plugins/` |
| [plugins/benchkeeper/rules/global.md](plugins/benchkeeper/rules/global.md) | global rules | written by the app to `~/.claude/rules/00-global.md`, and as a block into the Codex, Gemini CLI and Copilot instruction files |
| [plugins/benchkeeper/rules/codex.rules](plugins/benchkeeper/rules/codex.rules) | Codex asks before merging a pull request, force pushing, `git reset --hard`, `git branch -D`, `git clean` (Claude Code: the ask list the app adds to `~/.claude/settings.json`) | written by the app to `~/.codex/rules/benchkeeper.rules` |
| [app](app) | the installer: global setup, project setup, history and undo, CLI and browser UI ([README](app/README.md)) | `npx benchkeeper@6.0.0` |
| [plugins/benchkeeper/skills/setting-up-projects](plugins/benchkeeper/skills/setting-up-projects/SKILL.md) | set up or update one repo: devcontainer, AGENTS.md, library and stack skills, Matt Pocock's repository setup (`docs/agents/`), default tier, other configuration to remove | plugin skill `benchkeeper:setting-up-projects` |
| [plugins/benchkeeper/skills/workflow](plugins/benchkeeper/skills/workflow/SKILL.md) | task kind and tier, then the playbook for software changes or research, batch mode, long checks at the end | plugin skill `benchkeeper:workflow` |
| [plugins/benchkeeper/skills/maintaining-repos](plugins/benchkeeper/skills/maintaining-repos/SKILL.md) | the Maintain pass on request: dead code, debt, dependency audit, version pins, docs drift, unused skills | plugin skill `benchkeeper:maintaining-repos` |
| [plugins/benchkeeper/library](plugins/benchkeeper/library/README.md) | skills installed per project: own (`designing-technical-uis`), Anthropic, science, marketing, security, docs and data, operations, legal, product | copied or installed into a project by `setting-up-projects` |
| [CHANGELOG.md](CHANGELOG.md) | setup versions (tags `setup-v*`) | not linked |
| [web](web) | the site (Astro, Mantine), deployed to GitHub Pages | not linked |

## Components

| Component | Scope | Purpose |
|---|---|---|
| [Dev Containers](https://code.visualstudio.com/docs/devcontainers/devcontainer-cli) | tooling on host, configuration per repo | the agent runs inside the container by default; `setting-up-projects` also offers the agent on the host with project commands in the container, or no container |
| [Ponytail](https://github.com/DietrichGebert/ponytail), level `full` | global, Claude + Codex | implementation simplicity |
| [Matt Pocock's skills](https://github.com/mattpocock/skills), his install, optional | global plugin in both agents: Claude Code from the official marketplace (it pins a commit of his repository), Codex from his marketplace | workflow: grilling, domain docs, spec and tickets, TDD, bug diagnosis, code review, pull request, handoff. Per repo it reads the issue tracker, triage labels and domain docs from `docs/agents/` |
| [workflow](plugins/benchkeeper/skills/workflow/SKILL.md) | global, Claude + Codex | task tier (quick, standard, full, research), issue and pull request flow, pre-push correctness review, security review for risky changes; uses Matt Pocock's skills when installed |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | project connections, container browsers | browser checks |
| [find-skills](https://github.com/vercel-labs/skills) | global | skill search, used by `setting-up-projects` |

Per repo (committed when applicable to selected agents): `.devcontainer/`, `AGENTS.md`, `CLAUDE.md`, `.agents/skills/` and `.claude/skills/` (library and stack skills), `skills-lock.json`, `docs/agents/` (with Matt Pocock's skills: from his `/setup-matt-pocock-skills`, with its `## Agent skills` block), `.mcp.json`, `.codex/config.toml`.

Global (per machine): the rules, the plugins (BenchKeeper, Ponytail, optionally Matt Pocock's skills), find-skills, settings. Nothing is installed at both levels.

Another Ponytail level for the current session: `/ponytail lite` or `/ponytail ultra` (Claude Code).

## How this stack was selected

- Quality: on par with the best setups tested.
- Time: less time per task with the BenchKeeper workflow.
- Cost: lower with Ponytail.
- Skills by level: small composable skills. The big flow runs only for big work, small tiers load targeted skills.
- Same setup everywhere: one machine install covers every repository. Each repository adds only its tracker, docs and stack.

For details, check the full data: [EVALUATIONS.md](https://github.com/ESchuderer/BenchKeeper/blob/main/EVALUATIONS.md) (Dev Containers and find-skills have no evaluation file), [benchmark pages](https://eschuderer.github.io/BenchKeeper/bench/).

## Telemetry

| Tool | Setting |
|---|---|
| Claude Code | `DISABLE_ERROR_REPORTING=1`, `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1` |
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
