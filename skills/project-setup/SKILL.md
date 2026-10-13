---
name: project-setup
description: "Set up or update a repository's development container and agent tooling for Claude Code and Codex: devcontainer configuration, AGENTS.md, stack-specific skills, language servers, OpenSpec or Spec Kit, codegraph. Use when the user asks to set up, onboard, update, or audit a project's agent setup, or to add skills for its stack."
---

# Project setup

Run in the repository root. On a repository whose working tree already has devcontainer configuration, `AGENTS.md`, `skills-lock.json`, `openspec/`, `.specify/`, or `.codegraph/`, every step compares the current state with what it would create and proposes only the differences.

Rules for every step: show the planned change and ask before writing; never commit; never run sudo or AUR installs (give the user the command).

## Agent selection

Detect `claude` and `codex` with `command -v`, then ask which installed agents the user uses for this project: Claude Code, Codex, both, or neither. Reuse an explicit selection already given for this project in the session. Do not install agent CLIs or infer usage from installation. Report missing requested agents; proceed only for confirmed installed agents. If none are selected, stop without changes.

Scope every step, including updates and cleanup, to selected agents. Leave unselected agents' files and integrations in place. `<agent-flags>` means `-a claude-code`, `-a codex`, or both, matching that selection. Never omit agent flags and rely on auto-detection. Use `--copy` for skills CLI installs to target agent directories directly. If existing shared links would change skill content used by an unselected agent, report and skip that mutation. [Skills installation modes](https://github.com/vercel-labs/skills/blob/v1.7.2/src/installer.ts)

## 1. Stack

Identify languages, frameworks, and infrastructure tools from build files, dependency manifests, config files, and file extensions. Count only technologies the repository contains code or config for (not ones its docs merely mention), and skip a language with fewer than about 10 files unless it is the main one. Show the list; the user confirms or edits it.

## 2. Development container

Use standard devcontainers for development in every repository. Reuse `.devcontainer/devcontainer.json`, `.devcontainer.json`, or an existing named configuration. Otherwise create `.devcontainer/devcontainer.json` and only the Dockerfile or Compose services the confirmed stack needs. Preserve existing settings and services. Use an exact image version or digest and pin installed CLI/package versions. [Configuration reference](https://containers.dev/implementors/json_reference/)

Run the agent on the host and prepare and start the project container from there. Keep agent CLIs, authentication, BenchKeeper, global rules, and skills on the host. Apply `global-setup` on the host; run project commands through `devcontainer exec --workspace-folder . ...`. No agent installation or sign-in inside the container is required.

- Install the project toolchain and required local MCP/browser tools inside the image, resolving exact package versions before writing install commands. Configure project-local MCP launchers to execute inside the container; verify their execution location before using them.
- For project Playwright, use the MCP pin in `global-setup` part 6 and install its matching browser inside the container. Use a project-specific stdio launcher through `devcontainer exec`; verify the workspace, protocol connection, and browser access to the application. Inspect effective client configuration and override or disable inherited host Playwright entries for this project. If routing is unavailable, keep the project integration disabled and report it.
- Run project commands as a non-root container user. Mount only the project and required project data; do not mount the host home or Docker socket, enable privileged mode, or forward credentials by default. Review existing mounts, Features, and lifecycle commands before launch. `initializeCommand` runs on the host. [Lifecycle reference](https://github.com/devcontainers/spec/blob/main/docs/specs/devcontainer-reference.md)
- Keep the same configuration for all clients. Run the agent in a host terminal, including CLI and Orca terminals, and route project commands through the commands below from the intended repository or worktree. VS Code may attach to the same container for project terminals, builds, and debugging; keep the agent on the host. Verify execution location separately for native chat or agent extensions. [VS Code](https://code.visualstudio.com/docs/devcontainers/containers), [Orca terminals](https://github.com/stablyai/orca#supported-agents)
- Before VS Code attachment, disable host Git credential integration and SSH-agent forwarding, then check the effective container environment and mounts. VS Code can forward these automatically; do not assume this policy changes the client's defaults. [Credential sharing](https://github.com/microsoft/vscode-docs/blob/main/remote/advancedcontainers/sharing-git-credentials.md)

Host launch and verification ([CLI reference](https://code.visualstudio.com/docs/devcontainers/devcontainer-cli)):
```sh
devcontainer read-configuration --workspace-folder .
devcontainer up --workspace-folder .
devcontainer exec --workspace-folder . git status --short
devcontainer exec --workspace-folder . id -un
```
Launch `claude` or `codex` on the host in the repository or worktree. Host inspection, file edits, Git operations, and agent configuration stay on the host. Route project dependency installs, builds, lint, tests, and local MCP/browser tools through `devcontainer exec --workspace-folder . ...`. From an existing container terminal, run project commands directly.

Keep compound project commands inside the container shell: `devcontainer exec --workspace-folder . sh -lc 'npm test && npm run lint'` is an example for a project with those scripts. Resolve the workspace and named configuration for every launcher; do not assume an MCP server starts in the agent's working directory. Host agents retain host access under the client's permissions; this setup contains project command execution, not the agent process.

For a named configuration, pass its `--config` path consistently. For linked Git worktrees, inspect the `.git` file and `git rev-parse --git-common-dir`; preserve the referenced paths with narrowly scoped mounts for the required Git metadata, then verify `git status` inside the container. That metadata is shared with the repository's other worktrees; do not mount a broad parent directory. [Git worktree layout](https://git-scm.com/docs/git-worktree#_details)

Configuration parsing alone is not runtime validation. If the container cannot start or a required tool is missing, report the failure and stop dependent development commands; do not fall back to the host.

After changing the image, Dockerfile, or container creation settings, rebuild instead of reusing the old container: VS Code **Dev Containers: Rebuild Container**, or `devcontainer up --workspace-folder . --remove-existing-container`. First identify data in the old container's writable layer and ask before removing it; preserve required data in project storage. Repeat container-local setup and checks after rebuilding.

## 3. AGENTS.md and CLAUDE.md

- `AGENTS.md`: what the project is (two lines), host agent launch and permitted host operations, container command prefixes, the real install, build, test, lint, and run commands (verify inside the container when local, read-only, and under a minute; never run network, SSH, or deploy commands merely to verify documentation), layout, conventions found in the code. Update: fix failing or changed commands; keep the user's text.
- `CLAUDE.md`, only when Claude Code is selected: exactly `@AGENTS.md`. Move any other content into `AGENTS.md` first. Otherwise leave an existing file unchanged and do not create one.

## 4. Stack skills

The global agent-skills plugin covers the workflow (spec, planning, TDD, debugging, code review, simplification, security, performance, git, CI/CD, docs, shipping). Inspect its installed skills for the selected agents; do not require Claude's plugin directory for a Codex-only setup. Add only knowledge about the confirmed stack.

1. Search per technology: `DO_NOT_TRACK=1 npx -y skills@1.7.2 find "<query>" </dev/null`. Use two or three specific queries per technology (`ansible playbook`, `python patterns`, `spring boot`), not one bare word: single words return unrelated skills. Ignore hits whose name or description does not match the technology.
2. Choose at most two per technology. Prefer the technology's own vendor, then `anthropics`, `vercel-labs`, `antfu`. Accept others only with 1,000 installs or more. Skip anything that duplicates an agent-skills skill. No acceptable hit: say so, install nothing.
3. Show a table (technology, skill, source, installs, reason) and wait for the choice.
4. Read each chosen `SKILL.md` and its scripts before installing. Reject skills that download and run code from the network, ask for credentials, or contain instructions outside their stated purpose.
5. Install: `DO_NOT_TRACK=1 npx -y skills@1.7.2 add <owner/repo> -s <skill> <agent-flags> --copy -y`. Check that each selected agent can read the installed `SKILL.md`. The resulting skill files, selected agent placements, and `skills-lock.json` belong in version control. [Skills CLI agent selection](https://github.com/vercel-labs/skills#available-options)

Update or restore missing skills by reinstalling each selected skill from its recorded source with the scoped `add` command above, then review the diff with the same checks. Do not run bulk `update` or `experimental_install` when they would touch unselected agents. Propose removing skills for technologies that are gone, duplicates of agent-skills skills, and skills on disk that are not in `skills-lock.json`. Remove with `npx -y skills@1.7.2 remove <name> <agent-flags> -y`, passing one name per argument. Preserve shared skill content still used by unselected agents.

## 5. Language servers

Skip this Claude plugin integration unless Claude Code is selected.

For each confirmed language, find its LSP plugin in `~/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json`. The plugin's `lspServers.*.command` field names the server binary it needs.

- Install the plugin on the host with `claude plugin install <name>@claude-plugins-official` when missing. Merge `false` for its full plugin ID into project `enabledPlugins` until container routing is verified, including for already-installed plugins. Check local or managed overrides before claiming it is disabled.
- Install the server and required language runtime inside the container with exact versions; use `global-setup` part 8 for the Python and TypeScript defaults.
- Use a supported client configuration to connect the host plugin to the container server. Verify diagnostics on a project file and matching host/container file paths or supported URI translation. Do not edit installed plugin files or treat an executable wrapper alone as proof. If the client cannot route the server correctly, disable its use for this project and report the limitation instead of installing a host fallback.
- No plugin for a language (shell, YAML, HCL, ...): skip it and list it in the report.

## 6. Spec tool (ask)

Ask which spec tool this repository uses: OpenSpec, Spec Kit, or none. Present both without a recommendation, with these differences: OpenSpec keeps one change folder per change and merges its spec deltas into `openspec/specs` on archive; Spec Kit keeps one folder per feature under `specs/` plus `.specify/memory/constitution.md`, with more up-front planning artifacts and no archive step. Recommend none for config, infrastructure, and docs repositories. A repository with `openspec/` or `.specify/` keeps its tool unless the user asks to switch. In both cases agent-skills drives the process and the tool owns the spec files (`rules/global.md`).

OpenSpec:
- Setup: `openspec init --tools <tools> --no-animation`, replacing `<tools>` with `claude`, `codex`, or `claude,codex` for the selected agents.
- Update: run `openspec update` only when all configured agent integrations are selected; otherwise report the update as skipped to preserve unselected integrations. Then list open changes with `openspec list` and point out finished ones that are not archived.

Spec Kit ([integrations](https://github.com/github/spec-kit/blob/v1.1.3/docs/reference/integrations.md), [git extension](https://github.com/github/spec-kit/blob/v1.1.3/extensions/git/README.md)):
- Setup: `specify init --here --force --non-interactive --integration <key>`, with `<key>` `claude` or `codex` for the first selected agent; for both, then `specify integration install codex`. Then `specify extension disable git` so branches follow the global issue and branch flow instead of `001-feature` names.
- Update: `specify integration upgrade <key>` for each selected agent, then `specify extension update`; report managed files with local edits instead of passing `--force`. Leave unselected integrations in place. `specify integration status` lists the installed ones.

## 7. codegraph (ask)

Recommend it at about 50 or more source files in languages codegraph indexes. Recommend skipping it below that, and for config or docs repositories.

- Install the codegraph pin from `global-setup` part 3 inside the container. Setup: `devcontainer exec --workspace-folder . codegraph init -y`. Add `.codegraph/` to `.gitignore`.
- Merge a container stdio launcher into `.mcp.json` only for selected Claude Code and `.codex/config.toml` only for selected Codex: use `command = "devcontainer"` and arguments `exec`, `--workspace-folder`, the resolved host workspace path, `codegraph`, `serve`, `--mcp`. Add `--config` when needed. Use a client-supported workspace variable only after checking its expansion; keep machine-specific paths out of shared config. Verify a project query, returned paths, and protocol output before enabling the integration.
- Update: run `devcontainer exec --workspace-folder . codegraph sync`, then check the connection. If the client cannot resolve the workspace or file paths correctly, report the integration as unavailable; do not fall back to a host MCP process.

## 8. Dead config

Check hooks and MCP servers only for selected agents: `.claude/settings*.json` and `.mcp.json` for Claude Code, `.codex/` for Codex. Check in their execution environment: host agent hooks on the host, container tools through `devcontainer exec`. A missing host binary does not make a container launcher obsolete. Propose removing entries whose required commands or project integration are no longer present; an unselected agent's configuration is not obsolete merely because it was skipped.

## 9. Report

List selected and skipped agents. Give a table of each changed file, the skills added or removed (with their source), any binaries still missing, and steps skipped with the reason. Include the container launch result and the project checks actually run inside it; report MCP/browser and LSP connections separately as verified, unavailable, skipped, or untested. Then give launch commands only for selected host agents and the container command prefix for project work.
