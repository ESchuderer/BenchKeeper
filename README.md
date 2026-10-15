<p align="center"><img src="assets/logo.svg" alt="BenchKeeper logo" width="160"></p>

# BenchKeeper

<!-- generated:description -->
BenchKeeper keeps your AI coding agents' workbench in order: Claude Code or Codex runs its skills to install and check rules, skills and tools at pinned versions, machine-wide and per repository. A full agentic SDLC fits features and risky changes, not every change, so the rules size each request first and small changes skip the steps they do not need.
<!-- /generated:description -->

Global agent setup for Claude Code and Codex: rules, two skills, rebuild steps.

Opinionated: one SDLC sized to each change, one tool per job, exact versions everywhere. To change a choice, edit [rules/global.md](rules/global.md) or the skills and rerun `/global-setup`.

Site: [eschuderer.github.io/BenchKeeper](https://eschuderer.github.io/BenchKeeper/)

Claude Code and Codex are independently optional. Setup detects installed agents and asks which you use. Only selected agents receive configuration, plugins, hooks, and skills. Agent CLIs are not installed by setup; unused or absent agents are skipped.

## Contents

| Path | What | Linked as |
|---|---|---|
| [rules/global.md](rules/global.md) | global rules | `~/.claude/rules/00-global.md` (symlink); copy in `~/.codex/AGENTS.md` |
| [skills/global-setup](skills/global-setup/SKILL.md) | install, check, and clean the global setup (all commands) | `~/.claude/skills/`, `~/.agents/skills/`, and in this repo |
| [skills/project-setup](skills/project-setup/SKILL.md) | set up or update one repo: AGENTS.md, stack skills, OpenSpec | `~/.claude/skills/`, `~/.agents/skills/` |
| [web](web) | the site (Astro, Mantine), deployed to GitHub Pages | not linked |

## Components

| Component | Scope | Purpose |
|---|---|---|
| [Dev Containers](https://code.visualstudio.com/docs/devcontainers/devcontainer-cli) | tooling on host, configuration per repo | agents run on the host; project commands run inside the container |
| [Ponytail](https://github.com/DietrichGebert/ponytail), level `full` | global, Claude + Codex | implementation simplicity within agent-skills phases |
| [agent-skills](https://github.com/addyosmani/agent-skills) | global, Claude + Codex | workflow: spec, plan, TDD, review, ship |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec) | CLI global, wired per repo | spec files (owns the artifacts; agent-skills drives the process, [#166](https://github.com/addyosmani/agent-skills/issues/166)) |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | project connections, container browsers | browser checks |
| [find-skills](https://github.com/vercel-labs/skills) | global | skill search, used by `project-setup` |

Per repo (committed when applicable to selected agents): `.devcontainer/`, `AGENTS.md`, `CLAUDE.md`, `.agents/skills/`, `.claude/skills/`, `skills-lock.json`, `openspec/`, `.mcp.json`, `.codex/config.toml`.

Ponytail and agent-skills remain separate plugins. [Global rules](rules/global.md#ponytail-and-agent-skills) integrate them: agent-skills drives the workflow; Ponytail `full` guides implementation within agreed scope, architecture, and required checks. Integration changes live here, not in installed plugin files. Select another Ponytail mode when needed.

Every component evaluated, what is in and what is not, with the research behind each decision: [EVALUATIONS.md](EVALUATIONS.md).

## Telemetry

| Tool | Setting |
|---|---|
| Claude Code | `DISABLE_ERROR_REPORTING=1`, `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1` |
| Claude Code, not set | `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`: they disable feature flags, so the advisor and Remote Control stop working ([docs](https://code.claude.com/docs/en/env-vars)) |
| Codex | `[analytics] enabled = false` |
| OpenSpec | off |
| skills CLI | `DO_NOT_TRACK=1` per command only |

## Prerequisites

Not installed by BenchKeeper; see each official page. Tables marked as generated come from [web/src/data/facts.json](web/src/data/facts.json) (`devcontainer exec --docker-path podman --workspace-folder . node web/scripts/readme.mjs`).

<!-- generated:prerequisites -->
| Tool | Needed for |
|---|---|
| [Claude Code](https://code.claude.com/docs/en/setup) | agent (one or both) |
| [Codex CLI](https://developers.openai.com/codex/cli) | agent (one or both) |
| [Git](https://git-scm.com/downloads) | clone, branches, commits |
| [GitHub CLI](https://cli.github.com/) | issues and pull requests (optional, local branches without it) |
| [Node.js and npm](https://nodejs.org/en/download) | global CLIs, prefix `~/.local` |
| [jq](https://jqlang.org/download/) | setup scripts |
| [curl](https://curl.se/download.html) | setup scripts |
| [Docker Engine](https://docs.docker.com/engine/install/) | devcontainers |
| [VS Code](https://code.visualstudio.com/download) | optional, attach to the devcontainer |
<!-- /generated:prerequisites -->

## Setup steps

1. Install the [prerequisites](#prerequisites): at least one agent you use, plus the tools for the steps you apply. npm uses prefix `~/.local`, no sudo.
2. Clone to `/mnt/data/Projects/benchkeeper`, open it in Claude Code or Codex.
3. Run `/global-setup` (Codex: `$global-setup`). Confirm which installed agents you use. It checks applicable parts without changing anything, shows one plan (installs, changes, removals, version bumps) with destructive items marked, and applies only what you approve; destructive items are confirmed again right before they run. Cleanup stays within that scope. All commands are in [skills/global-setup/SKILL.md](skills/global-setup/SKILL.md).
4. Restart selected agents; if Codex is selected, run `/hooks` and trust the plugin hooks.

Rerun `/global-setup` after editing `rules/global.md` (Codex gets a copy, not a link).

## Per repo

Run `/project-setup` (Codex: `$project-setup`). Confirm the agents used for this project. New repo: sets up. Existing setup: updates and cleans selected integrations. Both show one plan first and apply only what you approve; destructive items are confirmed again. Commit the result. Fresh clone: use `project-setup` to restore skills for selected agents from their recorded sources.

Agents run on the host and use standard devcontainers for project commands. `global-setup` configures host agent tooling, checks host Docker, and installs the pinned Dev Containers CLI; `project-setup` creates or updates the repository's container and project toolchain. Agent authentication, BenchKeeper, global rules, and skills stay on the host. Rootless engines, VMs, and microVMs are not required.

- CLI or an Orca worktree terminal: start the container with `devcontainer up --workspace-folder .`, then launch `claude` or `codex` on the host.
- VS Code may attach to the same container for project terminals, builds, and debugging. Keep the agent in a host terminal.
- Route project dependency installs, builds, lint, tests, and local MCP/browser tools through `devcontainer exec --workspace-folder . ...`. Host file inspection, edits, and Git operations remain available. Container startup failures stop dependent commands; they do not trigger a host fallback. Native chat and extension execution locations need separate verification.
- Project MCP/browser and language-server connections need verified container launchers and file paths. A host plugin or binary installation alone does not establish container execution; unsupported connections are reported as unavailable.

Launch commands: [Dev Containers CLI](https://code.visualstudio.com/docs/devcontainers/devcontainer-cli), [VS Code](https://code.visualstudio.com/docs/devcontainers/containers). The setup policy scopes mounts to the project and excludes host homes, engine sockets, privileged mode, and credential forwarding. Client defaults need checking; VS Code can forward Git credentials and SSH agents automatically. [Credential sharing](https://github.com/microsoft/vscode-docs/blob/main/remote/advancedcontainers/sharing-git-credentials.md)

The agent remains a host process with access governed by its client permissions. The devcontainer scopes project commands and their mounts; it does not isolate the host agent. [Container security](https://docs.docker.com/engine/security/)

## Update

- Plugins: run `claude plugin marketplace update` only for selected Claude Code, `codex plugin marketplace update` only for selected Codex (not pinned).
- CLIs and MCPs: `/global-setup` compares the pinned versions with the latest releases and proposes bumps before installing.
- Repo skills: use `project-setup` to update selected skills and agent placements.

## Recommended tools (optional)

Not installed by BenchKeeper. Each one works with the agents and rules set up here.

**Parallel agents: pick one.** Orca, Nimbalyst and cmux all manage several agent sessions side by side; running more than one duplicates that layer, each tracking its own sessions and worktrees for the same repositories.

<!-- generated:tools -->
| Tool | Platforms | Gives you | Choose it when |
|---|---|---|---|
| [Orca](https://github.com/stablyai/orca) | macOS, Windows, Linux | one git worktree per agent; the same prompt across several agents to compare results; terminal splits, SSH remote worktrees, mobile companion app; `/global-setup` offers its `orca-cli` and `orchestration` skills, only after asking | you want terminal-centered parallel agents with worktrees, remote machines or mobile access |
| [Nimbalyst](https://github.com/Nimbalyst/nimbalyst) | macOS, Windows, Linux | parallel sessions on a kanban board, one-click worktree per session; every agent edit arrives as a diff you approve or reject; visual editors (Markdown, CSV, mockups, diagrams), task tracking, iOS app | you want to review each change visually and work on docs, mockups and tasks next to the agents |
| [cmux](https://github.com/manaflow-ai/cmux) | macOS only | Ghostty-based terminal with vertical tabs; notifications when an agent needs input; sidebar with branch, PR status and ports; browser pane inside the terminal | you are on macOS and want a terminal-first workflow without a separate app layer |
<!-- /generated:tools -->

Orca only: `/global-setup` asks before installing the optional `orca-cli` and `orchestration` skills for selected agents. Declining skips them without failing setup; existing Orca skills and hooks are kept. See [setup part 10](skills/global-setup/SKILL.md#10-orca-skills-optional-ask) and [Orca's skill installation instructions](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/cli/skills.mdx).

<!-- generated:openhands -->
**Unattended or isolated runs: [OpenHands](https://github.com/OpenHands/OpenHands).** A different role from the three above: a self-hosted agent server with a web UI that runs work without you at the terminal.

- Each conversation can run in its own Docker container (`OH_CONVERSATION_RUNTIME=docker`), one of the isolation options BenchKeeper does not provide.
- Runs its own agent or hosts Claude Code, Codex and Gemini CLI; works with any LLM.
- Automations on a schedule or on webhook events (GitHub, Slack, Linear), for example splitting GitHub issues into tasks.
- Without a sandbox, the local agent has full access to your filesystem.
- Unverified: whether agents inside its containers load the BenchKeeper rules and skills; they are installed on the host, not in those containers.
<!-- /generated:openhands -->
