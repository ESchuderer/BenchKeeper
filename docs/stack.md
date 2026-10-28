# Stack

BenchKeeper ships as a plugin for Claude Code and Codex ([plugins/benchkeeper](../plugins/benchkeeper)), plus the [app](../app) for what a plugin cannot carry: project setup, the global rules and settings, history and undo.

The components BenchKeeper sets up, where each file lives and why these were chosen. Install and update steps: [setup guide](setup.md).

## Components

| Component | Scope | Purpose |
|---|---|---|
| [Dev Containers](https://code.visualstudio.com/docs/devcontainers/devcontainer-cli) | tooling on host, configuration per repo | the agent runs inside the container by default; `--env` also offers the agent on the host with project commands in the container, a Docker Sandboxes microVM (untested), or no container |
| [Ponytail](https://github.com/DietrichGebert/ponytail), level `full`, optional | the `ponytail` pack: global plugin in both agents, its level written when the pack is chosen | implementation simplicity |
| [Matt Pocock's skills](https://github.com/mattpocock/skills), his install, optional | global plugin in both agents: Claude Code from the official marketplace (it pins a commit of his repository), Codex from his marketplace | workflow: grilling, domain docs, spec and tickets, TDD, bug diagnosis, code review, pull request, handoff. Per repo it reads the issue tracker, triage labels and domain docs from `docs/agents/` |
| [workflow](../plugins/benchkeeper/skills/workflow/SKILL.md) | global, Claude + Codex | task kind (software change, docs pass, research) and tier (quick, standard, full), issue and pull request flow, pre-push correctness review, security review for risky changes; uses Matt Pocock's skills when installed |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | project connections, container browsers | browser checks |
| [find-skills](https://github.com/vercel-labs/skills) | global | skill search, used by `setting-up-projects` |

Per repo, committed: `.devcontainer/`, `AGENTS.md` (your own text), `docs/agents/` (with Matt Pocock's skills: from his `/setup-matt-pocock-skills`, with its `## Agent skills` block), `.mcp.json`, `.codex/config.toml`. Local by default, listed in `.git/info/exclude` (committed with `--share`): `CLAUDE.local.md` (shared: `CLAUDE.md`), `AGENTS.override.md`, `.agents/skills/` and `.claude/skills/` (library and stack skills), `skills-lock.json`, `.benchkeeper/`.

Global (per machine): the rules, the BenchKeeper plugin, the plugins of the packs chosen (Ponytail, Matt Pocock's skills), find-skills, settings.

With the `ponytail` pack, another Ponytail level for the current session: `/ponytail lite` or `/ponytail ultra` (Claude Code).

<!-- generated:core -->
**Optional: [mattpocock/skills](https://github.com/mattpocock/skills) by Matt Pocock:** his skills run the phases of standard and full work when installed (grilling, spec and tickets, tests first, code review, pull request).
<!-- /generated:core -->

## Contents

| Path | What | Linked as |
|---|---|---|
| [.claude-plugin/marketplace.json](../.claude-plugin/marketplace.json) | the marketplace, read by Claude Code and Codex | `$HOME/.claude/plugins/`, `$HOME/.codex/plugins/` |
| [plugins/benchkeeper/rules/global.md](../plugins/benchkeeper/rules/global.md) | global rules | written by the app to `$HOME/.claude/rules/00-global.md`, and as a block into the Codex, Gemini CLI and Copilot instruction files |
| [plugins/benchkeeper/rules/project.md](../plugins/benchkeeper/rules/project.md) | repository rules (standard level and up) | part of the project block the app writes (`CLAUDE.local.md`, `AGENTS.override.md`, or `AGENTS.md` with `--share`) |
| [app](../app) | the installer: global setup, project setup, history and undo, CLI and browser UI ([README](../app/README.md)) | `npx benchkeeper@6.25.0` |
| [plugins/benchkeeper/skills/setting-up-projects](../plugins/benchkeeper/skills/setting-up-projects/SKILL.md) | set up or update one repo: devcontainer, AGENTS.md, library and stack skills, Matt Pocock's repository setup (`docs/agents/`), default tier, other configuration to remove | plugin skill `benchkeeper:setting-up-projects` |
| [plugins/benchkeeper/skills/workflow](../plugins/benchkeeper/skills/workflow/SKILL.md) | task kind and tier, then the playbook for software changes, docs passes or research, batch mode, long checks at the end | plugin skill `benchkeeper:workflow` |
| [plugins/benchkeeper/skills/tier](../plugins/benchkeeper/skills/tier/SKILL.md) | sets the tier for the rest of the session (`quick`, `standard`, `full`, `research`, or `auto` to let the workflow pick) | plugin skill `/benchkeeper:tier`, user-invoked |
| [plugins/benchkeeper/hooks/tier](../plugins/benchkeeper/hooks/tier/register.tsx) | the optional status band in the Claude Code terminal and desktop app: project, branch, last test run and Ponytail's level, the tier of the last answer, buttons for `/benchkeeper:tier`, the sessions board and the doctor, the override kept through compaction and resume ([setup](setup.md#the-status-band)) | Claude Code plugin option `tierBand`, off by default |
| [plugins/benchkeeper/skills/maintaining-repos](../plugins/benchkeeper/skills/maintaining-repos/SKILL.md) | the Maintain pass on request: dead code and duplicates, dependency cycles, test audit by mutation, debt, dependency audit, version pins, docs drift, unused skills | plugin skill `benchkeeper:maintaining-repos` |
| [plugins/benchkeeper/skills/orchestrating-projects](../plugins/benchkeeper/skills/orchestrating-projects/SKILL.md) | the coordinator on request: one worker per project on labeled issues, projects in parallel, outcomes verified, merge and cleanup by each repository's written policy | plugin skill `benchkeeper:orchestrating-projects` |
| [plugins/benchkeeper/skills/operating-benchkeeper](../plugins/benchkeeper/skills/operating-benchkeeper/SKILL.md) | how an agent manages its own setup through the CLI: plan, review, apply with `--yes`, read the JSON, undo, doctor, update one project | plugin skill `benchkeeper:operating-benchkeeper`, model-invoked |
| [plugins/benchkeeper/library](../plugins/benchkeeper/library/README.md) | skills installed per project, grouped into packs (frontend, testing, security, science, docs, data, marketing, operations, Matt Pocock's) | installed into a project by `benchkeeper projects apply` or `setting-up-projects` |
| [CHANGELOG.md](../CHANGELOG.md) | setup versions (tags `setup-v*`) | not linked |
| [web](../web) | the site (Astro, Mantine), deployed to GitHub Pages | not linked |

## How this stack was selected

- Quality: in BenchKeeper's mistreevous brownfield run only ECC scored measurably above plain Claude Code; Matt Pocock's skills, Ponytail and BenchKeeper stayed within the round-to-round spread (medians 84.1 to 90.1, Sonnet 5.5, k = 3, [report](https://github.com/ESchuderer/BenchKeeper-research/blob/main/bench/results/2026-10-18-mistreevous.md)).
- Time: it depends on the version. setup-v4.0 with Matt Pocock's skills took a median 13.1 minutes against 22.7 for plain Claude Code, setup-v5.0 took 24.9 (same report). setup-v6.0 is not measured yet ([#132](https://github.com/ESchuderer/BenchKeeper/issues/132)).
- Cost: Ponytail alone cost 0.58 times plain Claude Code in the mistreevous run (k = 3, same report); external results range from 10% less to 55% more ([evaluation](../evaluations/behavior-modes/ponytail.md)).
- Skills by level: small composable skills. The full flow runs only for full-tier work, small tiers load targeted skills.
- Same setup everywhere: one machine install covers every repository. Each repository adds only its tracker, docs and stack.

For details, check the full data: [EVALUATIONS.md](https://github.com/ESchuderer/BenchKeeper/blob/main/EVALUATIONS.md) (Dev Containers and find-skills have no evaluation file), [benchmark results](https://github.com/ESchuderer/BenchKeeper-research#recorded-results).

## Benchmarks

Each setup runs as its own arm on the same brownfield brief. Scores, time per task and app reviews per arm are in the reports: [BenchKeeper-research `bench/results`](https://github.com/ESchuderer/BenchKeeper-research/tree/main/bench/results). Method: [bench/PROTOCOL.md](../bench/PROTOCOL.md) (the run machinery and raw run data were removed, [#256](https://github.com/ESchuderer/BenchKeeper/issues/256)).

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
