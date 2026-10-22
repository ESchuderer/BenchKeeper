# benchkeeper

Installs, updates and undoes the BenchKeeper agent setup for Claude Code, Codex, Gemini CLI and GitHub Copilot, globally and per project, from a CLI or a local web UI. What the setup contains: the [repository README](../README.md#setup-steps).

## Setup

Node.js 22 or newer, and at least one agent. Linux and macOS are tested; Windows runs only a CI smoke test (start, plan, apply with a ledger run) and is untested by the owner.

- From npm: `npx benchkeeper@6.0.0 <command>`. Until the first npm release, run it from a clone.
- From a clone: `git clone --depth 1 https://github.com/ESchuderer/BenchKeeper.git && npm ci --prefix BenchKeeper/app --omit=dev`, then `node BenchKeeper/app/bin/benchkeeper.mjs <command>`. The web UI needs a build first: `npm ci --prefix BenchKeeper/app && npm run build --prefix BenchKeeper/app`.

Runtime dependencies, pinned: [jsonc-parser](https://github.com/microsoft/node-jsonc-parser) 3.3.1 (JSON settings with comments), [smol-toml](https://github.com/squirrelchat/smol-toml) 1.9.1 (Codex TOML). The web UI (React, Mantine) is built into `dist/` and ships in the package.

## Commands

`benchkeeper help` lists every option.

| Command | Does |
|---|---|
| `ui [--no-open] [--port N]` | the web UI (default command), see [Web UI](#web-ui) |
| `plan`, `apply [--yes] [--all]` | global setup for the installed agents (`--agents a,b`, `--pack matt-pocock`): a diff per change, then a question per change. Plugins are pinned (BenchKeeper at this app's version from tag `setup-v<major>.<minor>`, Ponytail `PONYTAIL_REF`, Matt Pocock's skills `MATT_POCOCK_REF`); one older than its pin gets update steps, a newer one is kept. Plugin state is read from `~/.claude/plugins/` and `~/.codex/config.toml`, the agent CLIs only when those cannot be read. A plugin whose marketplace was added at another ref than the pin is a step by hand, with the commands: moving the marketplace removes it, which deletes the plugin's data. An installed pack plugin whose pack no registered project uses is offered for removal, not preselected (uninstalling deletes the plugin's data) |
| `history`, `undo <run> [--step s]`, `restore <date>` | recorded runs, undo of a run or step, restore of a `setup.sh` backup. Undo puts a file back only while it is as the run (or the recorded session) left it and its backup is intact; otherwise it fails for that change and names the file. Each change is journaled before it starts, so a change cut off by a crash shows in history and can be undone |
| `project plan\|apply [dir]` | project setup: `--agents`, `--env container\|host-agent\|sandbox\|host`, `--sandbox`, `--pack`, `--skill`, `--tier`; `--disable <skill>` moves a skill to `.benchkeeper/disabled/`, `--enable` moves it back. Answers and each community skill's commit are kept in `.benchkeeper/state.json`; a skill recorded at another commit than the library pin is added again at the pin. Undo of a skills CLI command puts back the skill folders and `skills-lock.json` as they were before it, local edits included. A changed answer cleans up: sandbox off removes `sandbox.enabled` and BenchKeeper's excluded commands, a dropped agent loses the `CLAUDE.md` import, the Gemini CLI context setting and skill folders no chosen agent reads. A warning names hand-written AGENTS.md text on where commands run |
| `record [--project dir] -- <agent> [args]` | runs an agent session and records the files it changed and its transcript, so `undo` restores them |
| `packs list\|save\|export\|import\|remove` | library packs and own packs; a pack file names library skills only |
| `projects list\|add\|scan\|remove`, `update-all [--yes] [--no-push]` | registered projects; Update all builds branch `chore/agent-setup-<version>` per project in a worktree, commits, and pushes with a pull request when `origin` is on GitHub. An unmerged branch from an earlier run gets the new commit on top and may hold only commits Update all made (recorded by id in the ledger); a project whose apply or commit fails keeps its worktree under `~/.cache/benchkeeper/worktrees/` until you remove it |
| `doctor [dir]` | reports without changing anything: variables that turn agent features off (`DISABLE_TELEMETRY`, `DO_NOT_TRACK`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_GROWTHBOOK`, `CLAUDE_CODE_DISABLE_ADVISOR_TOOL`; name and file, never the value), rules and settings that differ from the setup, items outside it, a missing container engine, a newer skills CLI; in a project: summary or layout sections in `AGENTS.md`, overlapping skill descriptions, broken skill links. Exit 1 on an error |
| `profile export [file]`, `profile import <file>` | agents, packs, own packs and registered projects with their answers as one file (no file contents, environment values or tokens); import registers the projects found at the same paths and asks per change |
| `case add --target skill:<name>\|rule:<name> --expected <text> [--should-not]` | records an agent miss as an eval case; the prompt comes from `--run <session run>`, `--transcript`, `--query` or `--description` |
| `test [dir]` | deterministic checks, no agent session: files match the ledger, expected plugins or skill copies, nothing unexpected installed, project community skills at the library pins. Exit 1 on a failure |
| `eval [--agents a,b] [--model m] [--target t] [--all]` | trigger cases (`plugins/benchkeeper/evals/` and your own) as real agent sessions in scratch repositories; miss and false-trigger rates per skill, agent, agent version and model. Uses your subscription, asks first, refuses when `CI` is set; runs only targets whose skill or cases changed unless `--all` |

## Web UI

`benchkeeper ui` serves on `127.0.0.1` at a free port and opens the browser with a one-time link (`--no-open` prints it). The browser gets a file only you can read, which forwards to the link, so the token stays out of process arguments other local users can see. The link's token becomes an HttpOnly, SameSite=Strict session cookie named per port (`bk_session_<port>`) and an API key that the page keeps in its own origin's storage. API requests need both: browsers send the cookie to every server on `127.0.0.1`, the key stays with this page. The server rejects other Host headers, foreign or `null` origins, cross-site fetches, changes sent with GET, and API requests without the key in the `x-benchkeeper` header. It stops with the CLI process (Ctrl+C). Recorded agent sessions run from the CLI only. Applies, evals and setup suggestions run on the server: while one runs, the header shows it and opens its progress, also after a reload.

| View | Contents |
|---|---|
| Dashboard | install health of the global items, coverage per setup part and agent (a cell opens that agent's plan), setup flow, the last 6 runs, doctor findings with a link to the plan that fixes them |
| Projects | registered projects with setup version, skills per chosen agent (in the project, and in all with its global and plugin skills), pending changes, tree state and branch; per project its plan, skill switches and doctor findings; add, scan a parent folder, Update all with progress per project. A project without a state file is set up step by step (agents, environment with the dev container as default, packs and skills with suggestions from its files, tier, review) on a branch with one commit and a pull request, one project after the other; Change setup reopens these steps from the state file; Open folder shows the project in the file manager. Suggest with an agent asks first, then runs one read-only session (Claude Code `-p --restricted --strict-mcp-config` with Read, Grep and Glob; Codex `exec` with a permission profile that reads only the project, the system's minimal paths and Codex itself, writes nothing, and runs without web search and MCP servers) in the project on your subscription; only library packs, skills and environments from its answer are taken |
| Catalog | library skills with filters, skill detail with eval results, pack builder (warns about overlapping descriptions), packs with export, import and removal |
| Agents | detected agents and the global plan for the chosen ones; Apply shows each change as it runs, with the command output, then the run report in place of the plan. Cancel skips the changes not started yet |
| History | runs by day; the run report: counts by status and changed lines, each change with its diff (line numbers, unified or split, created and deleted files unified), command and output, or session files, undo of a step or the whole run |
| Evals | per agent and model (the newest by default): the latest miss and false-trigger rate of each target, worst first, and each target's rates over time; Run evals plans the targets and the number of agent sessions, then starts them with progress per session; Cancel stops the running session, finished targets keep their results |
| Settings | profile export and import, keyboard shortcuts, config files |

The view is part of the URL (`#/projects?path=<dir>`), so a reload keeps it. "Choose folder" opens the system dialog: `osascript` on macOS, `zenity`, then `kdialog` on Linux. With none of them, on Windows, on Linux without a display, or after a cancel, type the path. The server blocks other requests while the dialog is open.

| Keys | Action |
|---|---|
| Ctrl+K (macOS: Cmd+K), / | command palette: views, projects, skills, the last 20 runs, plan global setup, run doctor, toggle theme |
| Ctrl+1 to Ctrl+7 | views in sidebar order |
| Ctrl+J | light or dark theme |

Where the browser handles one of these keys itself, the sidebar, the palette and the header buttons do the same.

The UI is built from dev dependencies (Mantine core, charts and spotlight, Recharts, Tabler icons, the Inter font, React) into `dist/`. The published package has no extra runtime dependencies.

## Configuration

| Name | Default | Effect |
|---|---|---|
| `BENCHKEEPER_HOME` | your home directory | the home the app reads and writes; tests point it at a temporary directory |
| `BENCHKEEPER_NO_UPDATE_CHECK=1` | unset | no registry request for a newer version (it runs only in a terminal and never installs) |

Files below `~/.config/benchkeeper/`: `ledger/` (one JSON file per run), `backup/<run>/` (replaced and removed files), `projects.json`, `packs/`, `evals/` (own cases, `results.jsonl`, outputs of rule cases).

## Test

In the dev container (repository `AGENTS.md`):

- `npm test`: unit tests against temporary home directories with stubbed agent commands
- `npm run smoke`: start, plan, apply and ledger write
- `npm run build && npm run test:ui`: the web UI against a fixture home, axe in light and dark mode

## Release

The package version equals the plugin version (`plugins/benchkeeper/*/plugin.json`), checked by `test/package.test.mjs`. `npm pack` copies rules, own skills, the library catalog and eval sets into `content/` and builds the UI, so `plan` and `apply` work offline for them. The owner publishes with the "npm publish" workflow (Actions, Run workflow, the version as input), which needs the `NPM_TOKEN` secret and publishes with npm provenance.
