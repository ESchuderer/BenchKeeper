---
name: setting-up-projects
description: "Sets up or updates a repository's development container and agent tooling for Claude Code and Codex: devcontainer configuration and where the agent runs, AGENTS.md, domain skills from the BenchKeeper library, stack-specific skills, the default task tier, other project configuration to remove. Use when the user asks to set up, onboard, update, or audit a project's agent setup, or to add skills for its stack."
disable-model-invocation: true
writes: "After you approve its plan: the dev container configuration, the commands and conventions in `AGENTS.md`, `CLAUDE.md` with `@AGENTS.md` in a shared setup, stack and library skills with `skills-lock.json`, and the removals you confirm in step 6: skills, plugin and marketplace entries, MCP servers, hooks, other agent rules files and tool folders. The BenchKeeper block and `.benchkeeper/state.json` come from `benchkeeper projects apply`."
---

# Setting up projects

Run in the repository root. Where devcontainer configuration, `AGENTS.md`, `skills-lock.json`, or `docs/agents/` already exist, every step compares the current state with what it would create and proposes only the differences.

The BenchKeeper app owns the deterministic part: `npx benchkeeper@6 projects apply` writes the BenchKeeper block (the repository rules, where commands run, default tier, skill pointers), the pack and library skills and `.benchkeeper/state.json`. Local setup (the default, state `share: false`): the block goes into `CLAUDE.local.md` and `AGENTS.override.md` (Codex reads it instead of `AGENTS.md`; the app's block there also holds the text of `AGENTS.md` and is rebuilt on every apply, lines outside the block stay; [what each setup writes](https://github.com/ESchuderer/BenchKeeper/blob/main/app/README.md#commands)), and every file the app writes is listed in `.git/info/exclude`, so none of it is committed; leave the app's block in `.worktreeinclude` (it lists them for new worktrees) as written. Shared setup (`projects apply --share`): the block in `AGENTS.md`, `CLAUDE.md` importing it, all committed. With a state file, compare those parts and change an answer through `projects apply` (`--env`, `--tier`, `--pack`, `--skill`). Without one, propose `npx benchkeeper@6 projects plan` for them first.

Process: plan first, then apply.
1. Read only: run agent selection and steps 1 to 6 as detection and comparison, including their questions (stack confirmation, skill choice, steps marked "ask"). Write, install, and remove nothing. Do not build or start a container.
2. Plan: one list of files created, changed, or removed, skills added or removed, packages added to the image, container build or rebuild, integrations enabled or disabled, and skipped steps with the reason. Mark destructive items: overwriting or removing files, config entries, or skills, and removing or rebuilding a container. Ask: apply all, a subset, or cancel.
3. Apply only approved items, including container launch and verification. Right before each destructive item, show the diff or list and ask again.
4. Review (step 7), then report (step 8).

Never run sudo or AUR installs (give the user the command).

## Agent selection

Detect `claude` and `codex` with `command -v`, then ask which installed agents the user uses for this project: Claude Code, Codex, both, or neither. Reuse an explicit selection already given for this project in the session. Do not install agent CLIs or infer usage from installation. Report missing requested agents. Proceed only for confirmed installed agents; with none selected, stop without changes. A state file that also names `gemini` or `copilot` (untested in the app): leave their files unchanged and report that this skill covers Claude Code and Codex.

Scope every step, including updates and cleanup, to selected agents: leave unselected agents' files and integrations in place. `<agent-flags>` means `-a claude-code`, `-a codex`, or both, matching that selection. Never omit agent flags and rely on auto-detection. If existing shared links would change skill content used by an unselected agent, report and skip that mutation.

## 1. Stack

Identify languages, frameworks, and infrastructure tools from build files, dependency manifests, config files, and file extensions. Count only technologies the repository contains code or config for (not ones its docs merely mention), and skip a language with fewer than about 10 files unless it is the main one. Show the list for the user to confirm or edit.

## 2. Development container

Ask where the agent runs, recommending the first (`projects apply --env container`, `host-agent`, `sandbox`, `host`, in this order):
- **Agent in the container** (default): the agent CLIs selected above are installed in the image at exact versions, and the user starts them with `devcontainer exec --workspace-folder . claude` (or `codex`). Login: the subscription token from the host environment through `remoteEnv` (`"CLAUDE_CODE_OAUTH_TOKEN": "${localEnv:CLAUDE_CODE_OAUTH_TOKEN}"`), never written into the image or the repository, or a login inside the container kept in a named volume for the agent's config folder.
- **Agent on the host**: toolchains in the container, the agent on the host, project commands routed through `devcontainer exec`.
  `projects apply --sandbox` then turns on Claude Code's command sandbox, with `devcontainer exec` and `podman` excluded (state `sandbox: true`).
- **Docker Sandboxes microVM** (`sbx`, untested): the agent and its builds and tests run inside it. Set with `projects apply --env sandbox`, then skip the rest of this step.
- **Host only**: no container. Skip the rest of this step.

Reuse `.devcontainer/devcontainer.json`, `.devcontainer.json`, or an existing named configuration. Otherwise create `.devcontainer/devcontainer.json` and only the Dockerfile or Compose services the confirmed stack needs. Preserve existing settings and services. Use an exact image version or digest and pin installed CLI/package versions. [Configuration reference](https://containers.dev/implementors/json_reference/)

- Install the project toolchain and required local MCP/browser tools inside the image, resolving exact package versions before writing install commands.
- For a browser check, install the browser tool the project uses at an exact version and its matching browser inside the container, with a project-specific stdio launcher through `devcontainer exec`. Verify the connection and browser access to the application. Inspect effective client configuration and override or disable inherited host entries of the same tool for this project. If routing fails, keep the integration disabled.
- Run project-local MCP launchers inside the container: resolve the workspace and named configuration for every launcher and verify the execution location (an MCP server may start outside the agent's working directory).
- Run project commands as a non-root container user. Mount only the project and required project data. Do not mount the host home or Docker socket, enable privileged mode, or forward credentials by default. Review existing mounts, Features, and lifecycle commands before launch. `initializeCommand` runs on the host. [Lifecycle reference](https://github.com/devcontainers/spec/blob/main/docs/specs/devcontainer-reference.md)
- VS Code may attach to the same container for project terminals, builds, and debugging. Verify where native chat or agent extensions run. [VS Code](https://code.visualstudio.com/docs/devcontainers/containers)
- Before VS Code attachment, disable host Git credential integration and SSH-agent forwarding, then check the effective container environment and mounts. VS Code can forward these automatically. [Credential sharing](https://github.com/microsoft/vscode-docs/blob/main/remote/advancedcontainers/sharing-git-credentials.md)

Host launch and verification:
```sh
devcontainer up --workspace-folder .
devcontainer exec --workspace-folder . git status --short
devcontainer exec --workspace-folder . id -un
```
Agent on the host: launch `claude` or `codex` on the host in the repository or worktree, and route project dependency installs, builds, lint, tests, and local MCP/browser tools through `devcontainer exec --workspace-folder . ...`. From an existing container terminal, run project commands directly.

Keep compound project commands inside the container shell: `devcontainer exec --workspace-folder . sh -lc 'npm test && npm run lint'`.

For a named configuration, pass its `--config` path consistently. For linked Git worktrees, inspect the `.git` file and `git rev-parse --git-common-dir`. Preserve the referenced paths with narrowly scoped mounts for the required Git metadata, then verify `git status` inside the container. That metadata is shared with the repository's other worktrees. Do not mount a broad parent directory. [Git worktree layout](https://git-scm.com/docs/git-worktree#_details)

After changing the image, Dockerfile, or container creation settings, rebuild instead of reusing the old container: VS Code **Dev Containers: Rebuild Container**, or `devcontainer up --workspace-folder . --remove-existing-container`. First identify data in the old container's writable layer and ask before removing it. Preserve required data in project storage.

## 3. AGENTS.md and CLAUDE.md

- `AGENTS.md` (committed in both setups): where project commands run sits in the BenchKeeper block (`projects apply --env`). Outside the block: the real install, build, test, lint, and run commands (verify inside the container when local, read-only, and under a minute; never run network, SSH, or deploy commands merely to verify documentation), conventions found in the code that differ from the stack defaults. No project summary or layout. Update: remove a project summary or layout section after asking, fix failing or changed commands.
- `CLAUDE.md`, only when Claude Code is selected and the setup is shared or the repository already has one: `@AGENTS.md`. Move any other content into `AGENTS.md` first. Otherwise leave an existing file unchanged and do not create one. A local setup reads `AGENTS.md` through the import in `CLAUDE.local.md`.
- After changing `AGENTS.md` in a local setup with Codex selected, run `npx benchkeeper@6 projects apply` so `AGENTS.override.md` carries the new text.

## 4. Skills

Add only domain knowledge (library) and knowledge about the confirmed stack (search). Every skill here is installed in the project, never globally.

### Library (ask)

The catalog is `library/library.json` in the BenchKeeper plugin, two levels above this skill's folder (`library/README.md` renders it). Propose the packs and single skills whose `pickWhen` matches what the repository contains, each pack as one question the user can trim skill by skill. Install as the catalog README says, community skills from the default branch of their source:
- Own skills: copy the folder. When the catalog names folders for `paths` and the user names them, add `paths:` with their globs to the copied front matter. Add the catalog's pointer line to the `AGENTS.md` it names.
- Community skills: read and check them as in item 4 below, then install with the command in item 5.
- Entries marked Codex only: only when Codex is selected, installed with `-a codex` alone even when both agents are selected.

Update: compare each installed library skill with the catalog version (own skills: the folder, ignoring `paths`; community skills: reinstall and review the diff) and propose the differences.

### Stack search

Skip what the library already covers.

Run `npx benchkeeper@6 skills cli` once. It prints the environment and `npx` command of the checked skills CLI release; `<skills>` below stands for that printed line, and every skills CLI command starts with it. A non-zero exit means the check failed: install nothing and show its output. The printed package is `skills@npm:skills@<version>`: with that alias npx runs the registry package, never a `skills` the repository ships in `node_modules`.

1. Search per technology: `<skills> find "<query>" </dev/null`. Use two or three specific queries per technology (`ansible playbook`, `python patterns`, `spring boot`); single words return unrelated skills. Ignore hits whose name or description does not match the technology.
   Science, data or research repositories beyond the library's science set: also search the domain the repository works in (for example `single cell`, `cheminformatics`). Choose single skills, never a whole collection.
2. Choose at most two per technology. Prefer the technology's own vendor, then `anthropics`, `vercel-labs`, `antfu`. Accept others only with 1,000 installs or more. No acceptable hit: say so, install nothing.
3. Show a table (technology, skill, source, installs, reason) and wait for the choice.
4. Read each chosen `SKILL.md` and its scripts before installing. Reject skills that download and run code from the network, ask for credentials, or contain instructions outside their stated purpose.
5. Install: `<skills> add <owner/repo> -s <skill> <agent-flags> --copy -y`, then in a local setup `npx benchkeeper@6 projects apply`, which adds the new folders and `skills-lock.json` to `.git/info/exclude`. Check that each selected agent can read the installed `SKILL.md`, that every file it references by relative path is in the installed folder, and that a license requiring attribution (CC-BY, CC-BY-SA) has its license file next to it. Copy missing files from the source, or remove the skill and say so. [Skills CLI agent selection](https://github.com/vercel-labs/skills#available-options)

Update or restore missing skills by reinstalling each selected skill from its recorded source with the scoped `add` command above, then review the diff with the same checks. Do not run bulk `update` or `experimental_install` when they would touch unselected agents. Propose removing skills for technologies that are gone. Remove with `<skills> remove <name> <agent-flags> -y`, passing one name per argument, then check that the folder and the `skills-lock.json` entry are gone. The CLI keeps a `.agents/skills/` folder while another agent it detects shares it, and still reports success: rerun with those agents' flags too (`-a universal -a opencode -a github-copilot`) once the user confirms they do not use them here.

## 5. Workflow setup and default tier (ask)

The workflow itself (`benchkeeper:workflow`) is installed once per machine as a plugin, by the user (README setup steps, `npx benchkeeper@6 apply`). A pack that installs a plugin has its own setup command in the catalog (`prompts`): it writes into the repository outside BenchKeeper's plan and undo, so the user runs it. When such a pack is on, name its command once; `npx benchkeeper@6 doctor` names it again while its sections are missing from `AGENTS.md`. Keep skills named `code-review` out of `.claude/skills/`: one there replaces Claude Code's `/code-review`.

Ask for the default task tier of `benchkeeper:workflow`: none (the agent picks per request), `quick`, `standard`, `full` or `research`. Recommend none for code repositories. Set the choice with `npx benchkeeper@6 projects apply --tier <tier>`, which writes the `Default tier:` line into the BenchKeeper block. For none, pass `--tier=` (an unset `--tier` keeps the saved tier) and remove a `Default tier:` line outside the block after asking.

### State file

`.benchkeeper/state.json` (git ignores it in a local setup; committed in a shared one) holds the answers, so a later run and the BenchKeeper app read the same. Keys whose names do not explain them: `env` (`container`, `host-agent`, `sandbox`, `host`: the four choices of step 2 in their order, `projects apply --env`), `contentVersion` (the plugin `version`; a project is behind when it or `appVersion` differs; a version 1 file with `setupVersion` is read as both and rewritten by the next `projects apply`), `singles` (skills chosen besides the packs'), `share` (true: committed), `guards` (the deny rules and the guard hook, Claude Code only), `paths` (skill name to globs), `disabled` (skills turned off, their folders kept in `.benchkeeper/disabled/`), `agentOwned` and `frameworkRefs` (the agent files the app fetched and the commit each source was fetched at). The app writes it; read it and leave it unchanged. When it exists, its answers are the defaults of every question above. After adding or removing a library skill by hand, run `npx benchkeeper@6 projects apply` so the file matches. Update all covers registered projects with a state file: register this one with `npx benchkeeper@6 projects add .`. A repository that still tracks `.benchkeeper/state.json` while the setup is local: `npx benchkeeper@6 projects unshare .` commits the removal of the committed copies on the local branch `chore/agent-setup-local` for the user to push; after merging and pulling, Update all writes the local setup again.

## 6. Other configuration (ask)

List everything agent-related in the project that the plan does not create or keep:
- skills in `.claude/skills/` and `.agents/skills/` that are neither in `skills-lock.json` nor library skills, and copies of skills a global plugin already provides
- plugin and marketplace entries in `.claude/settings*.json` (`enabledPlugins`, `extraKnownMarketplaces`)
- MCP servers in `.mcp.json` and `.codex/config.toml`
- hooks in `.claude/settings*.json`, `.codex/hooks.json` and the `[hooks]` table of `.codex/config.toml`
- other agent rules files (for example `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md`)
- spec or workflow tool folders with their skills and CI entries (for example `openspec/`, `.specify/`)

For each item, say what it is and whether it still works, checked in its execution environment: host hooks on the host, container launchers through `devcontainer exec`. A missing host binary does not make a container launcher dead. Skills listed in `skills-lock.json` are removed with the step 4 `remove` command, so the lock entry goes too. A tool folder with open work: propose moving the open items into the issue tracker first. `AGENTS.md` and `CLAUDE.md` are updated in step 3, never removed.

## 7. Review

After the apply step, give the diff (`git diff` against the default branch plus untracked files, and in a local setup the ignored files from `git status --ignored`) and the plan to a review subagent (Claude Code: the Agent tool, Codex: a subagent). It reports each failed item with the file and line:
- Every command and tool named in the touched `AGENTS.md` files exists where that file says it runs (container or host). Instructions for a tool whose skills or binary this run removed are gone.
- Statements in `AGENTS.md` that the run checked (commands, test status, build output, reproducibility) match what the checks showed.
- A folder `AGENTS.md` or `CLAUDE.md` added inside a docs or site source folder is excluded from that build (for example `exclude_docs` in MkDocs).
- Each installed skill passes the step 4 install checks, and each removal left no folder or lock entry.
- The branch merges cleanly into the default branch. Otherwise merge the default branch in and resolve the conflicts before pushing.

Fix the findings within the approved plan. Report the others.

## 8. Report

Give a table of each changed file, the skills added or removed (with their source), and steps skipped with the reason. Include the container launch result and the project checks run inside it. Report MCP/browser connections as verified, unavailable, skipped, or untested. Then give launch commands for selected host agents and the container command prefix.
