<p align="center"><img src="assets/logo.svg" alt="BenchKeeper logo" width="160"></p>

# BenchKeeper

<!-- generated:description -->
BenchKeeper sets up Claude Code and Codex with one rules file and four skills. It is for developers who use Claude Code or Codex and want the same rules, skills and devcontainer setup in every repository. The setup skills install and check rules, skills and tools, per machine and per repository: CLIs, MCP servers and workflow plugins at pinned versions. The following-dev-workflow skill sorts each request into a tier (quick, standard, full, research), so small changes skip the steps they do not need.
<!-- /generated:description -->

<!-- generated:core -->
**Built on [mattpocock/skills](https://github.com/mattpocock/skills) by Matt Pocock:** his skills drive each SDLC phase (grilling, spec and tickets, tests first, code review, pull request).
<!-- /generated:core -->

One tool per job, exact versions for CLIs and MCP servers. To change a choice, edit [rules/global.md](rules/global.md) or the setup skills and rerun `/setting-up-machine`. After a change to `following-dev-workflow`, rerun `/setting-up-projects` in each repository.

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
4. Restart the selected agents.

## Per repo

Run `/setting-up-projects` (Codex: `$setting-up-projects`) and confirm the agents for this project. A new repo is set up, an existing setup is updated and cleaned. Plan and approval as in step 3 of the setup steps. Commit the result. On a fresh clone, it restores the skills from their recorded sources.

The agent, its sign-in, BenchKeeper, the global rules and skills stay on the host. `setting-up-machine` configures the host tooling, checks Docker and installs the pinned Dev Containers CLI. `setting-up-projects` creates or updates the repository's container and toolchain. Rootless engines, VMs and microVMs are not required.

- CLI or Orca worktree terminal: `devcontainer up --workspace-folder .`, then start `claude` or `codex` on the host.
- VS Code can attach to the same container for terminals, builds and debugging. Keep the agent in a host terminal.
- Dependency installs, builds, lint, tests and local MCP/browser tools run through `devcontainer exec --workspace-folder . ...`. File edits and Git stay on the host. If the container fails to start, dependent commands stop: there is no host fallback. Where native chat and extensions execute is not verified.
- MCP, browser and language-server connections need verified container launchers and paths. A host plugin or binary alone does not run in the container. Unsupported connections are reported as unavailable.

Launch commands: [Dev Containers CLI](https://code.visualstudio.com/docs/devcontainers/devcontainer-cli), [VS Code](https://code.visualstudio.com/docs/devcontainers/containers). Setup scopes mounts to the project: no host home, engine socket, privileged mode or credential forwarding. Check the client's defaults: VS Code can forward Git credentials and SSH agents automatically ([credential sharing](https://github.com/microsoft/vscode-docs/blob/main/remote/advancedcontainers/sharing-git-credentials.md)). The devcontainer does not isolate the agent, which stays a host process under its client permissions ([container security](https://docs.docker.com/engine/security/)).

## Update

- Workflow plugins and repository skills: pinned to tags per repository. `/setting-up-projects` compares the tags with the latest releases, proposes bumps and updates the skills.
- CLIs and MCPs: `/setting-up-machine` compares the pins with the latest releases and proposes bumps.

## Benchmarks

Each setup runs as its own arm on the same greenfield and brownfield briefs. Scores, time per task and app reviews per arm: [benchmark pages](https://eschuderer.github.io/BenchKeeper/bench/). Reports: [bench/results](bench/results). Method: [bench/PROTOCOL.md](bench/PROTOCOL.md).

## Contents

| Path | What | Linked as |
|---|---|---|
| [rules/global.md](rules/global.md) | global rules | `~/.claude/rules/00-global.md` (symlink), copy in `~/.codex/AGENTS.md` |
| [skills/setting-up-machine](skills/setting-up-machine/SKILL.md) | check, install, update and clean the global setup: rules, setup skills, settings | `~/.claude/skills/`, `~/.agents/skills/` |
| [skills/setting-up-projects](skills/setting-up-projects/SKILL.md) | set up or update one repo: devcontainer, AGENTS.md, stack skills, the workflow (following-dev-workflow, Matt Pocock's skills, Ponytail, `docs/agents/`), dead config | `~/.claude/skills/`, `~/.agents/skills/` |
| [skills/following-dev-workflow](skills/following-dev-workflow/SKILL.md) | task tiers and their steps (issue, branch, tests, spec, review, pull request), loaded before repository work | per project: `.claude/skills/`, `.agents/skills/` (copy) |
| [skills/maintaining-repos](skills/maintaining-repos/SKILL.md) | the Maintain pass on request: dead code, debt, dependency audit, docs drift, unused skills | `~/.claude/skills/`, `~/.agents/skills/` |
| [CHANGELOG.md](CHANGELOG.md) | setup versions (tags `setup-v*`) | not linked |
| [web](web) | the site (Astro, Mantine), deployed to GitHub Pages | not linked |

## Components

| Component | Scope | Purpose |
|---|---|---|
| [Dev Containers](https://code.visualstudio.com/docs/devcontainers/devcontainer-cli) | tooling on host, configuration per repo | agents run on the host, project commands run inside the container |
| [Ponytail](https://github.com/DietrichGebert/ponytail), v5.2.0, level `full` | per project, Claude + Codex | implementation simplicity within the phases of Matt Pocock's skills |
| [Matt Pocock's skills](https://github.com/mattpocock/skills), his install | Claude Code: global plugin from the official marketplace, which pins a commit of his repository. Codex: per project | workflow: grilling, domain docs, spec and tickets, TDD, bug diagnosis, code review, pull request, handoff. Per repo it reads the issue tracker, triage labels and domain docs from `docs/agents/` |
| [following-dev-workflow](skills/following-dev-workflow/SKILL.md) | per project, Claude + Codex | task tier pre-filter (quick, standard, full, research), pre-push correctness review, security review for risky changes |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | project connections, container browsers | browser checks |
| [find-skills](https://github.com/vercel-labs/skills) | global | skill search, used by `setting-up-projects` |

Per repo (committed when applicable to selected agents): `.devcontainer/`, `AGENTS.md`, `CLAUDE.md`, `.agents/skills/` and `.claude/skills/` (following-dev-workflow, stack skills, Codex copies of Matt Pocock's skills and Ponytail), `skills-lock.json`, `.claude/settings.json` (Ponytail as a plugin pinned to its tag), `docs/agents/` (from his `/setup-matt-pocock-skills`, with its `## Agent skills` block), `.mcp.json`, `.codex/config.toml`.

Global (per machine): the rules, Matt Pocock's Claude Code plugin (as he installs it), the setup skills (setting-up-machine, setting-up-projects, maintaining-repos), find-skills, settings. Nothing is installed at both levels.

The [following-dev-workflow skill](skills/following-dev-workflow/SKILL.md) combines Ponytail and Matt Pocock's skills. The integration lives here, not in the installed plugin files. Another Ponytail level for the current session: `/ponytail lite` or `/ponytail ultra` (Claude Code).

## How this stack was selected

- Quality: on par with the best setups tested.
- Time: less time per task with the BenchKeeper workflow.
- Cost: lower with Ponytail.
- Skills by level: small composable skills. The big flow runs only for big work, small tiers load targeted skills.
- Same setup everywhere: the same pinned setup in every project, for teammates and CI.

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
| [Orca](https://github.com/stablyai/orca) | macOS, Windows, Linux | one git worktree per agent, the same prompt across agents; terminal splits, SSH remote worktrees, mobile app; `/setting-up-machine` offers its `orca-cli` and `orchestration` skills after asking | you want terminal-based parallel agents with worktrees, remote machines or mobile access |
| [Nimbalyst](https://github.com/Nimbalyst/nimbalyst) | macOS, Windows, Linux | parallel sessions on a kanban board, one-click worktree per session; every agent edit arrives as a diff you approve or reject; visual editors (Markdown, CSV, mockups, diagrams), task tracking, iOS app | you review changes visually and work on docs, mockups and tasks next to the agents |
| [cmux](https://github.com/manaflow-ai/cmux) | macOS only | Ghostty-based terminal with vertical tabs; notifications when an agent needs input and a sidebar with branch, PR status and ports; browser pane inside the terminal | you are on macOS and want a terminal without a separate app |
<!-- /generated:tools -->

Orca only: `/setting-up-machine` asks before installing the optional `orca-cli` and `orchestration` skills. Declining them does not fail setup. Existing Orca skills and hooks are kept ([Orca skills in setting-up-machine](skills/setting-up-machine/SKILL.md#7-orca-skills-optional-ask), [Orca skill installation](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/cli/skills.mdx)).

<!-- generated:openhands -->
**Unattended or isolated runs: [OpenHands](https://github.com/OpenHands/OpenHands).** A self-hosted agent server with a web UI that runs work without you at the terminal.

- Each conversation can run in its own Docker container (`OH_CONVERSATION_RUNTIME=docker`), an isolation option BenchKeeper does not provide.
- Runs its own agent or hosts Claude Code, Codex and Gemini CLI.
- Automations on a schedule or on webhook events (GitHub, Slack, Linear), for example splitting GitHub issues into tasks.
- Without a sandbox, the local agent has full access to your filesystem.
- Unverified: whether agents inside its containers load the BenchKeeper rules and skills, which are installed on the host.
<!-- /generated:openhands -->
