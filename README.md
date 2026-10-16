<p align="center"><img src="assets/logo.svg" alt="BenchKeeper logo" width="160"></p>

# BenchKeeper

<!-- generated:description -->
BenchKeeper sets up Claude Code and Codex with one rules file and four skills. It is for developers who use Claude Code or Codex and want the same rules, skills and devcontainer setup in every repository. The setup skills install and check rules, skills and tools, per machine and per repository: CLIs and MCP servers at pinned versions, plugins at their latest release. The following-dev-workflow skill sorts each request into a tier (quick, standard, full, research), so small changes skip the steps they do not need.
<!-- /generated:description -->

<!-- generated:core -->
**Built on [agent-skills](https://github.com/addyosmani/agent-skills) by Addy Osmani:** its skills drive each SDLC phase (specify, plan, tests first, build, review, ship).
<!-- /generated:core -->

One tool per job, exact versions for CLIs and MCP servers. To change a choice, edit [rules/global.md](rules/global.md) or the skills and rerun `/setting-up-machine`.

Claude Code and Codex are each optional. Setup detects installed agents, asks which you use, and configures only those (configuration, plugins, hooks, skills). It does not install agent CLIs.

## Prerequisites

Not installed by BenchKeeper. The generated blocks in this README come from [web/src/data/facts.json](web/src/data/facts.json) (`devcontainer exec --docker-path podman --workspace-folder . node web/scripts/readme.mjs`).

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

1. Install the [prerequisites](#prerequisites): at least one agent, plus the tools for the parts you apply. npm uses prefix `~/.local`, no sudo.
2. Clone it (`git clone https://github.com/ESchuderer/BenchKeeper.git`) and open the folder in Claude Code or Codex.
3. Run `/setting-up-machine` (Codex: `$setting-up-machine`) and confirm the agents you use. It checks without changing anything, shows one plan (installs, changes, removals, version bumps), and applies only what you approve. Destructive items are marked and confirmed again before they run. Commands: [skills/setting-up-machine/SKILL.md](skills/setting-up-machine/SKILL.md).
4. Restart the selected agents. Codex: run `/hooks` and trust the plugin hooks.

## Per repo

Run `/setting-up-projects` (Codex: `$setting-up-projects`) and confirm the agents for this project. A new repo is set up, an existing setup is updated and cleaned. It shows one plan first and applies only what you approve. Destructive items are confirmed again. Commit the result. On a fresh clone, it restores the skills from their recorded sources.

The agent, its sign-in, BenchKeeper, the global rules and skills stay on the host. `setting-up-machine` configures the host tooling, checks Docker and installs the pinned Dev Containers CLI. `setting-up-projects` creates or updates the repository's container and toolchain. Rootless engines, VMs and microVMs are not required.

- CLI or Orca worktree terminal: `devcontainer up --workspace-folder .`, then start `claude` or `codex` on the host.
- VS Code can attach to the same container for terminals, builds and debugging. Keep the agent in a host terminal.
- Dependency installs, builds, lint, tests and local MCP/browser tools run through `devcontainer exec --workspace-folder . ...`. File edits and Git stay on the host. If the container fails to start, dependent commands stop: there is no host fallback. Where native chat and extensions execute is not verified.
- MCP, browser and language-server connections need verified container launchers and paths. A host plugin or binary alone does not run in the container. Unsupported connections are reported as unavailable.

Launch commands: [Dev Containers CLI](https://code.visualstudio.com/docs/devcontainers/devcontainer-cli), [VS Code](https://code.visualstudio.com/docs/devcontainers/containers). Setup scopes mounts to the project: no host home, engine socket, privileged mode or credential forwarding. Check the client's defaults: VS Code can forward Git credentials and SSH agents automatically ([credential sharing](https://github.com/microsoft/vscode-docs/blob/main/remote/advancedcontainers/sharing-git-credentials.md)). The devcontainer does not isolate the agent, which stays a host process under its client permissions ([container security](https://docs.docker.com/engine/security/)).

## Update

- Plugins (not pinned): `claude plugin marketplace update`, `codex plugin marketplace update`, each only for a selected agent.
- CLIs and MCPs: `/setting-up-machine` compares the pins with the latest releases and proposes bumps.
- Repo skills: `/setting-up-projects` updates them.

## Benchmarks

The published runs measure BenchKeeper layer v1 (the SDLC in the rules file, no workflow skill). It does not beat several frameworks without it. Cartridges brief, Claude Sonnet 5.5, one trial per arm, final score: the best layer arm (E, with ECC and OpenSpec) ranks 5th of 29 arms (Claude Code and OpenCode), plain Claude Code 19th. Layer v3 (arms AD and AE, with the following-dev-workflow skill) is being benchmarked.

Summary: [benchmark page](https://eschuderer.github.io/BenchKeeper/bench/). Reports: [bench/results](bench/results). Method: [bench/PROTOCOL.md](bench/PROTOCOL.md).

## Contents

| Path | What | Linked as |
|---|---|---|
| [rules/global.md](rules/global.md) | global rules | `~/.claude/rules/00-global.md` (symlink), copy in `~/.codex/AGENTS.md` |
| [skills/setting-up-machine](skills/setting-up-machine/SKILL.md) | check, install, update and clean the global setup | `~/.claude/skills/`, `~/.agents/skills/` |
| [skills/setting-up-projects](skills/setting-up-projects/SKILL.md) | set up or update one repo: devcontainer, AGENTS.md, stack skills, OpenSpec, dead config | `~/.claude/skills/`, `~/.agents/skills/` |
| [skills/following-dev-workflow](skills/following-dev-workflow/SKILL.md) | task tiers and their steps (issue, branch, tests, spec, review, pull request), loaded before repository work | `~/.claude/skills/`, `~/.agents/skills/` |
| [skills/maintaining-repos](skills/maintaining-repos/SKILL.md) | the Maintain pass on request: dead code, debt, dependency audit, docs drift, unused skills | `~/.claude/skills/`, `~/.agents/skills/` |
| [CHANGELOG.md](CHANGELOG.md) | setup versions (tags `setup-v*`) | not linked |
| [web](web) | the site (Astro, Mantine), deployed to GitHub Pages | not linked |

## Components

| Component | Scope | Purpose |
|---|---|---|
| [Dev Containers](https://code.visualstudio.com/docs/devcontainers/devcontainer-cli) | tooling on host, configuration per repo | agents run on the host, project commands run inside the container |
| [Ponytail](https://github.com/DietrichGebert/ponytail), level `full` | global, Claude + Codex | implementation simplicity within agent-skills phases |
| [agent-skills](https://github.com/addyosmani/agent-skills) | global, Claude + Codex | workflow: spec, plan, TDD, review, ship |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec) | CLI global, wired per repo | spec files (owns the artifacts, agent-skills drives the process, [#166](https://github.com/addyosmani/agent-skills/issues/166)) |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | project connections, container browsers | browser checks |
| [find-skills](https://github.com/vercel-labs/skills) | global | skill search, used by `setting-up-projects` |

Per repo (committed when applicable to selected agents): `.devcontainer/`, `AGENTS.md`, `CLAUDE.md`, `.agents/skills/`, `.claude/skills/`, `skills-lock.json`, `openspec/`, `.mcp.json`, `.codex/config.toml`.

The [following-dev-workflow skill](skills/following-dev-workflow/SKILL.md) combines Ponytail and agent-skills. The integration lives here, not in the installed plugin files. Another Ponytail level for the current session: `/ponytail lite` or `/ponytail ultra` (Claude Code).

Components evaluated, included or not, with the research behind them (Dev Containers and find-skills have no evaluation file): [EVALUATIONS.md](EVALUATIONS.md).

## Telemetry

| Tool | Setting |
|---|---|
| Claude Code | `DISABLE_ERROR_REPORTING=1`, `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1` |
| Claude Code, not set | `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`: each disables feature flags and the advisor. `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` also disables Remote Control ([docs](https://code.claude.com/docs/en/env-vars)) |
| Codex | `[analytics] enabled = false` |
| OpenSpec | off |
| skills CLI | `DO_NOT_TRACK=1` per command only |

## Recommended tools (optional)

Not installed by BenchKeeper.

**Parallel agents: pick one.** Orca, Nimbalyst and cmux each manage several agent sessions side by side. Running two duplicates the sessions and worktrees they track for the same repositories.

<!-- generated:tools -->
| Tool | Platforms | Gives you | Choose it when |
|---|---|---|---|
| [Orca](https://github.com/stablyai/orca) | macOS, Windows, Linux | one git worktree per agent, the same prompt across agents; terminal splits, SSH remote worktrees, mobile app; `/setting-up-machine` offers its `orca-cli` and `orchestration` skills after asking | you want terminal-based parallel agents with worktrees, remote machines or mobile access |
| [Nimbalyst](https://github.com/Nimbalyst/nimbalyst) | macOS, Windows, Linux | parallel sessions on a kanban board, one-click worktree per session; every agent edit arrives as a diff you approve or reject; visual editors (Markdown, CSV, mockups, diagrams), task tracking, iOS app | you review changes visually and work on docs, mockups and tasks next to the agents |
| [cmux](https://github.com/manaflow-ai/cmux) | macOS only | Ghostty-based terminal with vertical tabs; notifications when an agent needs input and a sidebar with branch, PR status and ports; browser pane inside the terminal | you are on macOS and want a terminal without a separate app |
<!-- /generated:tools -->

Orca only: `/setting-up-machine` asks before installing the optional `orca-cli` and `orchestration` skills. Declining them does not fail setup. Existing Orca skills and hooks are kept ([setup part 10](skills/setting-up-machine/SKILL.md#10-orca-skills-optional-ask), [Orca skill installation](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/cli/skills.mdx)).

<!-- generated:openhands -->
**Unattended or isolated runs: [OpenHands](https://github.com/OpenHands/OpenHands).** A self-hosted agent server with a web UI that runs work without you at the terminal.

- Each conversation can run in its own Docker container (`OH_CONVERSATION_RUNTIME=docker`), an isolation option BenchKeeper does not provide.
- Runs its own agent or hosts Claude Code, Codex and Gemini CLI.
- Automations on a schedule or on webhook events (GitHub, Slack, Linear), for example splitting GitHub issues into tasks.
- Without a sandbox, the local agent has full access to your filesystem.
- Unverified: whether agents inside its containers load the BenchKeeper rules and skills, which are installed on the host.
<!-- /generated:openhands -->
