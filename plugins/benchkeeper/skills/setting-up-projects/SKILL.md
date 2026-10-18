---
name: setting-up-projects
description: "Sets up or updates a repository's development container and agent tooling for Claude Code and Codex: devcontainer configuration, AGENTS.md, Matt Pocock's repository setup (issue tracker, domain docs), domain skills from the BenchKeeper library, stack-specific skills, the default task tier, other project configuration to remove. Use when the user asks to set up, onboard, update, or audit a project's agent setup, or to add skills for its stack."
disable-model-invocation: true
---

# Setting up projects

Run in the repository root. On a repository whose working tree already has devcontainer configuration, `AGENTS.md`, `skills-lock.json`, or `docs/agents/`, every step compares the current state with what it would create and proposes only the differences.

Process: plan first, then apply.
1. Read only: run agent selection and steps 1 to 6 as detection and comparison, including their questions (stack confirmation, skill choice, steps marked "ask"). Write, install, and remove nothing. Do not build or start a container.
2. Plan: one list of files created, changed, or removed, skills added or removed, packages added to the image, container build or rebuild, integrations enabled or disabled, and skipped steps with the reason. Mark destructive items: overwriting or removing files, config entries, or skills, and removing or rebuilding a container. Ask: apply all, a subset, or cancel.
3. Apply only approved items, including container launch and verification. Right before each destructive item, show the diff or list and ask again.
4. Verify and report (step 7).

Never commit. Never run sudo or AUR installs (give the user the command).

## Agent selection

Detect `claude` and `codex` with `command -v`, then ask which installed agents the user uses for this project: Claude Code, Codex, both, or neither. Reuse an explicit selection already given for this project in the session. Do not install agent CLIs or infer usage from installation. Report missing requested agents. Proceed only for confirmed installed agents. If none are selected, stop without changes.

Scope every step, including updates and cleanup, to selected agents. Leave unselected agents' files and integrations in place. `<agent-flags>` means `-a claude-code`, `-a codex`, or both, matching that selection. Never omit agent flags and rely on auto-detection. Use `--copy` for skills CLI installs to target agent directories directly. If existing shared links would change skill content used by an unselected agent, report and skip that mutation. [Skills installation modes](https://github.com/vercel-labs/skills/blob/v1.7.2/src/installer.ts)

## 1. Stack

Identify languages, frameworks, and infrastructure tools from build files, dependency manifests, config files, and file extensions. Count only technologies the repository contains code or config for (not ones its docs merely mention), and skip a language with fewer than about 10 files unless it is the main one. Show the list. The user confirms or edits it.

## 2. Development container

Use standard devcontainers for development in every repository. Reuse `.devcontainer/devcontainer.json`, `.devcontainer.json`, or an existing named configuration. Otherwise create `.devcontainer/devcontainer.json` and only the Dockerfile or Compose services the confirmed stack needs. Preserve existing settings and services. Use an exact image version or digest and pin installed CLI/package versions. [Configuration reference](https://containers.dev/implementors/json_reference/)

Run the agent on the host and prepare and start the project container from there. Keep agent CLIs, authentication, BenchKeeper, global rules, and skills on the host. The machine setup (BenchKeeper's plugin and `setup.sh`) runs on the host. Run project commands through `devcontainer exec --workspace-folder . ...`. No agent installation or sign-in inside the container is required.

- Install the project toolchain and required local MCP/browser tools inside the image, resolving exact package versions before writing install commands. Configure project-local MCP launchers to execute inside the container. Verify their execution location before using them.
- For project Playwright, use `@playwright/mcp@0.0.83` and install its matching browser inside the container. Use a project-specific stdio launcher through `devcontainer exec`. Verify the workspace, protocol connection, and browser access to the application. Inspect effective client configuration and override or disable inherited host Playwright entries for this project. If routing is unavailable, keep the project integration disabled and report it.
- Run project commands as a non-root container user. Mount only the project and required project data. Do not mount the host home or Docker socket, enable privileged mode, or forward credentials by default. Review existing mounts, Features, and lifecycle commands before launch. `initializeCommand` runs on the host. [Lifecycle reference](https://github.com/devcontainers/spec/blob/main/docs/specs/devcontainer-reference.md)
- Keep the same configuration for all clients. Run the agent in a host terminal, including CLI and Orca terminals, and route project commands through the commands below from the intended repository or worktree. VS Code may attach to the same container for project terminals, builds, and debugging. Keep the agent on the host. Verify execution location separately for native chat or agent extensions. [VS Code](https://code.visualstudio.com/docs/devcontainers/containers), [Orca terminals](https://github.com/stablyai/orca#supported-agents)
- Before VS Code attachment, disable host Git credential integration and SSH-agent forwarding, then check the effective container environment and mounts. VS Code can forward these automatically. Do not assume this policy changes the client's defaults. [Credential sharing](https://github.com/microsoft/vscode-docs/blob/main/remote/advancedcontainers/sharing-git-credentials.md)

Host launch and verification ([CLI reference](https://code.visualstudio.com/docs/devcontainers/devcontainer-cli)):
```sh
devcontainer read-configuration --workspace-folder .
devcontainer up --workspace-folder .
devcontainer exec --workspace-folder . git status --short
devcontainer exec --workspace-folder . id -un
```
Launch `claude` or `codex` on the host in the repository or worktree. Host inspection, file edits, Git operations, and agent configuration stay on the host. Route project dependency installs, builds, lint, tests, and local MCP/browser tools through `devcontainer exec --workspace-folder . ...`. From an existing container terminal, run project commands directly.

Keep compound project commands inside the container shell: `devcontainer exec --workspace-folder . sh -lc 'npm test && npm run lint'` is an example for a project with those scripts. Resolve the workspace and named configuration for every launcher. Do not assume an MCP server starts in the agent's working directory. Host agents retain host access under the client's permissions. This setup contains project command execution, not the agent process.

For a named configuration, pass its `--config` path consistently. For linked Git worktrees, inspect the `.git` file and `git rev-parse --git-common-dir`. Preserve the referenced paths with narrowly scoped mounts for the required Git metadata, then verify `git status` inside the container. That metadata is shared with the repository's other worktrees. Do not mount a broad parent directory. [Git worktree layout](https://git-scm.com/docs/git-worktree#_details)

Configuration parsing alone is not runtime validation. If the container cannot start or a required tool is missing, report the failure and stop dependent development commands. Do not fall back to the host.

After changing the image, Dockerfile, or container creation settings, rebuild instead of reusing the old container: VS Code **Dev Containers: Rebuild Container**, or `devcontainer up --workspace-folder . --remove-existing-container`. First identify data in the old container's writable layer and ask before removing it. Preserve required data in project storage. Repeat container-local setup and checks after rebuilding.

## 3. AGENTS.md and CLAUDE.md

- `AGENTS.md`: host agent launch and permitted host operations, container command prefixes, the real install, build, test, lint, and run commands (verify inside the container when local, read-only, and under a minute; never run network, SSH, or deploy commands merely to verify documentation), conventions found in the code that differ from the stack defaults. No project summary or layout. Update: remove a project summary or layout section after asking, fix failing or changed commands, keep the user's text.
- `CLAUDE.md`, only when Claude Code is selected: `@AGENTS.md`, plus the `## Agent skills` block that Matt Pocock's setup writes there when Codex is not selected. Move any other content into `AGENTS.md` first. Otherwise leave an existing file unchanged and do not create one.

## 4. Skills

Matt Pocock's skills (step 5) cover the workflow: grilling, specs and tickets, TDD, bug diagnosis, code review, domain docs, pull request text. Add only domain knowledge (library) and knowledge about the confirmed stack (search). Every skill here is installed in the project, never globally.

### Library (ask)

The catalog is `library/README.md` in the BenchKeeper plugin, two levels above this skill's folder. Read it, then propose the entries whose "Pick when" matches what the repository contains, each set as one question the user can trim skill by skill. Install as the catalog says:
- Own skills (a folder in the library): copy the folder to `.agents/skills/<name>/` when Codex is selected and to `.claude/skills/<name>/` when Claude Code is selected. With both selected, `.claude/skills/<name>` is a link to `../../.agents/skills/<name>`. When the catalog names folders for `paths` and the user names them, add `paths:` with their globs to the copied front matter. Claude Code then loads the skill only for files there, and Codex ignores the key. Add the catalog's pointer line to the `AGENTS.md` it names.
- Community skills: read and check them as in item 4 below, then install with the command in item 5. `skills-lock.json` pins their content.
- Entries marked Codex only: only when Codex is selected, installed with `-a codex` alone even when both agents are selected.

Update: compare each installed library skill with the catalog version (own skills: the folder, ignoring `paths`; community skills: reinstall and review the diff) and propose the differences.

### Stack search

Skip what the library already covers.

1. Search per technology: `DO_NOT_TRACK=1 npx -y skills@1.7.2 find "<query>" </dev/null`. Use two or three specific queries per technology (`ansible playbook`, `python patterns`, `spring boot`), not one bare word: single words return unrelated skills. Ignore hits whose name or description does not match the technology.
   Science, data or research repositories beyond the library's science set: also search the domain the repository works in (for example `single cell`, `cheminformatics`). Choose single skills, never a whole collection.
2. Choose at most two per technology. Prefer the technology's own vendor, then `anthropics`, `vercel-labs`, `antfu`. Accept others only with 1,000 installs or more. Skip anything that duplicates one of Matt Pocock's skills. No acceptable hit: say so, install nothing.
3. Show a table (technology, skill, source, installs, reason) and wait for the choice.
4. Read each chosen `SKILL.md` and its scripts before installing. Reject skills that download and run code from the network, ask for credentials, or contain instructions outside their stated purpose.
5. Install: `DO_NOT_TRACK=1 npx -y skills@1.7.2 add <owner/repo> -s <skill> <agent-flags> --copy -y`. Check that each selected agent can read the installed `SKILL.md`. The resulting skill files, selected agent placements, and `skills-lock.json` belong in version control. [Skills CLI agent selection](https://github.com/vercel-labs/skills#available-options)

Update or restore missing skills by reinstalling each selected skill from its recorded source with the scoped `add` command above, then review the diff with the same checks. Do not run bulk `update` or `experimental_install` when they would touch unselected agents. Propose removing skills for technologies that are gone. Remove with `npx -y skills@1.7.2 remove <name> <agent-flags> -y`, passing one name per argument. Preserve shared skill content still used by unselected agents.

## 5. Workflow setup and default tier (ask)

The workflow itself (Matt Pocock's skills, Ponytail, `following-dev-workflow`) is installed once per machine as plugins, by the user (README quick start, `setup.sh`). This step sets up what his skills read in this repository.

- Matt Pocock's skills come from his plugin in both agents ([installation](https://github.com/mattpocock/skills#installation-30-second-setup)), so project copies of them load twice (step 6). Do not install a skill named `code-review` into `.claude/skills/`: it would replace Claude Code's `/code-review`.
- Matt Pocock's repository setup: ask the user to run `/mattpocock-skills:setup-matt-pocock-skills` (Codex: `$mattpocock-skills:setup-matt-pocock-skills`) once. It asks for the issue tracker, the triage labels and where docs go, and writes `docs/agents/` and its `## Agent skills` block (into `CLAUDE.md` when it exists). With Codex selected, keep the single block in `AGENTS.md`, which Codex reads, and leave `CLAUDE.md` at `@AGENTS.md`. After one of his releases, he recommends running it again.

Ask for the default task tier of `following-dev-workflow`: none (the agent picks per request), `quick`, `standard`, `full` or `research`. Recommend none for code repositories. Write the choice as one `Default tier: <tier>` line in the `AGENTS.md` conventions. It applies only when neither the change type nor the tier table clearly matches. None writes nothing and removes an existing line after asking.

## 6. Other configuration (ask)

List everything agent-related in the project that the plan does not create or keep, for selected agents only:
- skills in `.claude/skills/` and `.agents/skills/` that are neither in `skills-lock.json` nor library skills, and copies of skills a global plugin already provides
- plugin and marketplace entries in `.claude/settings*.json` (`enabledPlugins`, `extraKnownMarketplaces`)
- MCP servers in `.mcp.json` and `.codex/config.toml`
- hooks in `.claude/settings*.json`, `.codex/hooks.json` and the `[hooks]` table of `.codex/config.toml`
- other agent rules files (for example `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md`)
- spec or workflow tool folders with their skills and CI entries (for example `openspec/`, `.specify/`)

For each item, say what it is and whether it still works, checked in its execution environment: host hooks on the host, container launchers through `devcontainer exec`. A missing host binary does not make a container launcher dead. Ask which to remove and remove only those. Skills listed in `skills-lock.json` are removed with the step 4 `remove` command, so the lock entry goes too. A tool folder with open work: propose moving the open items into the issue tracker first. `AGENTS.md` and `CLAUDE.md` are updated in step 3, never removed. An unselected agent's configuration is not listed.

## 7. Report

List selected and skipped agents. Give a table of each changed file, the skills added or removed (with their source), any binaries still missing, and steps skipped with the reason. Include the container launch result and the project checks actually run inside it. Report MCP/browser connections separately as verified, unavailable, skipped, or untested. Then give launch commands only for selected host agents and the container command prefix for project work.
