<p align="center"><img src="assets/logo.svg" alt="BenchKeeper logo" width="160"></p>

# BenchKeeper

<!-- generated:description -->
BenchKeeper sets up Claude Code and Codex with short global rules, a workflow skill that sizes each task (quick, standard, full, research) and runs long checks once at the end, and a per-repository setup: devcontainer, AGENTS.md, stack skills at pinned versions. setup.sh, which you run yourself, installs the rules, settings and plugins (BenchKeeper, Ponytail, optionally Matt Pocock's skills) and asks before each change.
<!-- /generated:description -->

<!-- generated:core -->
**Optional: [mattpocock/skills](https://github.com/mattpocock/skills) by Matt Pocock:** his skills run the phases of standard and full work when installed (grilling, spec and tickets, tests first, code review, pull request).
<!-- /generated:core -->

One tool per job, exact versions for CLIs and MCP servers. BenchKeeper ships as a plugin for Claude Code and Codex ([plugins/benchkeeper](plugins/benchkeeper)), plus [setup.sh](plugins/benchkeeper/setup.sh) for what a plugin cannot carry: the global rules and settings.

Claude Code and Codex are each optional. `setup.sh` configures the agents it finds on `PATH`. It does not install agent CLIs.

## Prerequisites

Not installed by BenchKeeper. The generated blocks in this README come from [web/src/data/facts.json](web/src/data/facts.json) (`devcontainer exec --docker-path podman --workspace-folder . node web/scripts/readme.mjs`).

<!-- generated:prerequisites -->
| Tool | Needed for |
|---|---|
| [Claude Code](https://code.claude.com/docs/en/setup) | agent (one or both) |
| [Codex CLI](https://developers.openai.com/codex/cli) | agent (one or both) |
| [Git](https://git-scm.com/downloads) | clone, branches, commits |
| [GitHub CLI](https://cli.github.com/) | issues and pull requests (optional, local branches without it) |
| [Node.js and npm](https://nodejs.org/en/download) | Dev Containers CLI and skills CLI, user prefix such as `~/.local` |
| [jq](https://jqlang.org/download/) | `setup.sh` |
| [Docker Engine](https://docs.docker.com/engine/install/) | devcontainers |
| [VS Code](https://code.visualstudio.com/download) | optional, attach to the devcontainer |
<!-- /generated:prerequisites -->

## Setup steps

1. Install the [prerequisites](#prerequisites): at least one agent and jq, plus the tools for the parts you apply. npm uses a user prefix such as `~/.local`, no sudo.
2. Clone: `git clone --depth 1 https://github.com/ESchuderer/BenchKeeper.git`
3. Review the plan: `sh BenchKeeper/plugins/benchkeeper/setup.sh`. This dry run lists each change and changes nothing.
4. Apply: `sh BenchKeeper/plugins/benchkeeper/setup.sh --apply`. It asks before each change. `--apply-all` applies every change from the dry run without asking, removals included:
   - the global rules (`~/.claude/rules/00-global.md`, `~/.codex/AGENTS.md`)
   - the plugins: BenchKeeper, Matt Pocock's skills and Ponytail (pinned to a tag, since it runs a `SessionStart` hook), in each agent
   - settings and telemetry (merged, other keys and hooks stay): error reporting, feedback survey and `/feedback` off, local transcripts kept 14 days instead of 30, the stable update channel (about one week behind latest), subagents without a model on Sonnet
   - the default model `opusplan` in Claude Code (Opus in plan mode, Sonnet otherwise), as its own question since it replaces the model you set. Orca starts `claude` without `--model`, so it applies there too. Not benchmarked.
   - default effort `high` in Claude Code (also saved for Opus 5.5 and Sonnet 5.5, which ignore the global key) and in Codex, and the Claude Code auto-compact window at 400000 tokens (default about 967K on 1M models). Changes are offered separately. Codex effort is set at the root, preserving profile settings. Neither is benchmarked. Anthropic gives no recommended window.
   - everything else installed globally, one item at a time: other rules files (`~/.claude/CLAUDE.md`, other files in `~/.claude/rules/`, `~/.codex/AGENTS.override.md`), skills, plugins, marketplaces, MCP servers and hooks. Files go to `~/.config/benchkeeper/backup/<date>/`, never deleted, and `setup.sh --restore <date>` moves them back. Plugins, marketplaces and MCP servers are removed with the agent's own command. Hooks are offered per event, and Orca's own entries are only reported.
   - the Dev Containers CLI at the newest release that is at least 7 days old

   Existing Codex analytics and feedback values are set to false, and the original TOML is backed up for restore. Unsupported multiline, inline, dotted or array target forms and CRLF files require manual editing. A failed backup prevents replacement. Shell diagnostics show variable names and locations without values.

   It needs no root and writes only under `~/.claude`, `~/.claude.json`, `~/.codex`, `~/.agents/skills`, `~/.config` and the npm user prefix. It never runs on its own.
5. Restart the agents.

Skills only, without rules and settings: `claude plugin marketplace add ESchuderer/BenchKeeper --sparse .claude-plugin plugins && claude plugin install benchkeeper@benchkeeper` (Codex: `codex plugin marketplace add ESchuderer/BenchKeeper --sparse .claude-plugin --sparse plugins && codex plugin add benchkeeper@benchkeeper`).

## Per repo

1. Project setup, in the repository root: run `/benchkeeper:setting-up-projects` (Codex: `$benchkeeper:setting-up-projects`) and confirm the agents for this project. A new repo is set up, an existing setup is updated and cleaned. It shows one plan and applies only what you approve. On a fresh clone, it restores the skills from their recorded sources.
2. Matt Pocock setup, when project setup asks for it: run `/mattpocock-skills:setup-matt-pocock-skills` (Codex: `$mattpocock-skills:setup-matt-pocock-skills`). It asks for the issue tracker, the triage labels and where docs go, and writes `docs/agents/`. Project setup then finishes (with Codex it keeps his block in `AGENTS.md`).
3. Commit the result.

The agent, its sign-in, BenchKeeper, the global rules and skills stay on the host. `setup.sh` checks Docker and installs the Dev Containers CLI. `setting-up-projects` creates or updates the repository's container and toolchain. Rootless engines, VMs and microVMs are not required.

- CLI or Orca worktree terminal: `devcontainer up --workspace-folder .`, then start `claude` or `codex` on the host.
- VS Code can attach to the same container for terminals, builds and debugging. Keep the agent in a host terminal.
- Dependency installs, builds, lint, tests and local MCP/browser tools run through `devcontainer exec --workspace-folder . ...`. File edits and Git stay on the host. If the container fails to start, dependent commands stop: there is no host fallback. Where native chat and extensions execute is not verified.
- MCP, browser and language-server connections need verified container launchers and paths. A host plugin or binary alone does not run in the container. Unsupported connections are reported as unavailable.

Launch commands: [Dev Containers CLI](https://code.visualstudio.com/docs/devcontainers/devcontainer-cli), [VS Code](https://code.visualstudio.com/docs/devcontainers/containers). Setup scopes mounts to the project: no host home, engine socket, privileged mode or credential forwarding. Check the client's defaults: VS Code can forward Git credentials and SSH agents automatically ([credential sharing](https://github.com/microsoft/vscode-docs/blob/main/remote/advancedcontainers/sharing-git-credentials.md)). The devcontainer does not isolate the agent, which stays a host process under its client permissions ([container security](https://docs.docker.com/engine/security/)).

## Update

- BenchKeeper's plugin: its `version` changes with each setup release ([CHANGELOG.md](CHANGELOG.md)). Claude Code: `claude plugin marketplace update benchkeeper && claude plugin update benchkeeper@benchkeeper`, or turn on auto-update for the marketplace in `/plugin` (off by default for marketplaces outside Anthropic's, [docs](https://code.claude.com/docs/en/plugins/loading#which-marketplaces-and-plugins-auto-update)). Codex upgrades Git marketplaces at startup.
- Rules and settings: after a release that changes them, `git -C BenchKeeper pull`, then `sh BenchKeeper/plugins/benchkeeper/setup.sh --apply` (or `--apply-all`).
- Matt Pocock's skills update through their marketplaces. After one of his releases, he recommends running his setup again in each repository. Ponytail's marketplace stays on the tag it was added with (`setup.sh` adds `v5.3.2`). A newer tag means adding the marketplace again with the new `#ref` (Claude Code) or `@ref` (Codex).
- Repository skills (library and stack) are pinned in `skills-lock.json`, and `/benchkeeper:setting-up-projects` proposes their updates. `/benchkeeper:maintaining-repos` proposes bumps for pins in docs and scripts.

## Benchmarks

Each setup runs as its own arm on the same greenfield and brownfield briefs. Scores, time per task and app reviews per arm: [benchmark pages](https://eschuderer.github.io/BenchKeeper/bench/). Reports: [bench/results](bench/results). Method: [bench/PROTOCOL.md](bench/PROTOCOL.md).

## Contents

| Path | What | Linked as |
|---|---|---|
| [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json) | the marketplace, read by Claude Code and Codex | `~/.claude/plugins/`, `~/.codex/plugins/` |
| [plugins/benchkeeper/rules/global.md](plugins/benchkeeper/rules/global.md) | global rules | copied by `setup.sh` to `~/.claude/rules/00-global.md` and `~/.codex/AGENTS.md` |
| [plugins/benchkeeper/rules/codex.rules](plugins/benchkeeper/rules/codex.rules) | Codex asks before merging a pull request, force pushing, `git reset --hard`, `git branch -D`, `git clean` (Claude Code: the ask list `setup.sh` adds to `~/.claude/settings.json`) | copied by `setup.sh` to `~/.codex/rules/benchkeeper.rules` |
| [plugins/benchkeeper/setup.sh](plugins/benchkeeper/setup.sh) | rules, settings, plugin installs, host checks, everything else installed globally offered for removal ([self-check](plugins/benchkeeper/setup.test.sh)) | run from the clone |
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
| [Orca](https://github.com/stablyai/orca) | macOS, Windows, Linux | one git worktree per agent, the same prompt across agents; terminal splits, SSH remote worktrees, mobile app; `setup.sh` offers its `orca-cli` and `orchestration` skills after asking | you want terminal-based parallel agents with worktrees, remote machines or mobile access |
| [Nimbalyst](https://github.com/Nimbalyst/nimbalyst) | macOS, Windows, Linux | parallel sessions on a kanban board, one-click worktree per session; every agent edit arrives as a diff you approve or reject; visual editors (Markdown, CSV, mockups, diagrams), task tracking, iOS app | you review changes visually and work on docs, mockups and tasks next to the agents |
| [cmux](https://github.com/manaflow-ai/cmux) | macOS only | Ghostty-based terminal with vertical tabs; notifications when an agent needs input and a sidebar with branch, PR status and ports; browser pane inside the terminal | you are on macOS and want a terminal without a separate app |
<!-- /generated:tools -->

Orca only: `setup.sh` asks before installing the optional `orca-cli` and `orchestration` skills. Existing Orca skills and hooks are kept ([Orca skill installation](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/cli/skills.mdx)).

<!-- generated:openhands -->
**Unattended or isolated runs: [OpenHands](https://github.com/OpenHands/OpenHands).** A self-hosted agent server with a web UI that runs work without you at the terminal.

- Each conversation can run in its own Docker container (`OH_CONVERSATION_RUNTIME=docker`), an isolation option BenchKeeper does not provide.
- Runs its own agent or hosts Claude Code, Codex and Gemini CLI.
- Automations on a schedule or on webhook events (GitHub, Slack, Linear), for example splitting GitHub issues into tasks.
- Without a sandbox, the local agent has full access to your filesystem.
- Unverified: whether agents inside its containers load the BenchKeeper rules and skills, which are installed on the host.
<!-- /generated:openhands -->
