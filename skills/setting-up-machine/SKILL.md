---
name: setting-up-machine
description: "Checks, installs, and cleans the machine-wide agent setup for Claude Code and Codex: devcontainer tooling, global rules, workflow skills, Ponytail (full), addy agent-skills, OpenSpec, Playwright MCP, telemetry. Use on a new machine, after editing the global rules or skills, to update the pinned tool versions, or to verify or clean the global setup."
disable-model-invocation: true
---

# Setting up the machine

Brings the machine to the state below: required parts present, optional parts installed only when requested. `$B` is this skill's repository (`$B/skills/setting-up-machine/`; normally `/mnt/data/Projects/benchkeeper`).

Process: plan first, then apply.
1. Select agents (below).
2. Read only: compare pinned versions, run applicable **Check** steps, list extras. Write, install, and remove nothing.
3. Plan: one table (part, status, what is wrong, planned action with its commands or files, destructive yes or no), plus version bumps, extras to remove, and skipped parts with the reason. Destructive: overwriting or removing files, settings entries, plugins, skills, hooks, or MCP servers, and running a downloaded script. Ask: apply all, a subset, or cancel.
4. Apply only approved items. Right before each destructive item, show what it changes (diff, list, or script) and ask again.
5. Check again and report.

Never run sudo. Merge into the selected agents' settings; never overwrite them (Orca keeps hooks there).

## Agent selection

Detect `claude` and `codex` with `command -v`, then ask which installed agents the user uses and wants configured: Claude Code, Codex, both, or neither. Reuse an explicit selection already given in this session. Installation alone does not mean an agent is used. Do not install either agent CLI. If a requested agent is missing, report it and continue only with confirmed installed agents. If none are selected, stop without changes.

Apply every check, install, update, cleanup, and restart instruction only to selected agents. Leave unselected agents' configuration, plugins, hooks, and skill placements in place; skip their steps without marking setup as failed. Shared tools are installed once. Check the versions of packages needed by the selected steps only.

Blocks listing both `claude` and `codex` commands are alternatives: run only selected agents' lines. Use `--copy` for skills CLI installs to target agent directories directly. If existing shared links would change skill content used by an unselected agent, report and skip that mutation. [Skills installation modes](https://github.com/vercel-labs/skills/blob/v1.7.2/src/installer.ts)

| Selected agent | Skills CLI flag | Global skill directory |
|---|---|---|
| Claude Code | `-a claude-code` | `~/.claude/skills/` |
| Codex | `-a codex` | `~/.agents/skills/` |

In commands below, replace `<agent-flags>` with the selected agents' flags and `<skill-dir>` with a selected agent's directory; repeat directory-specific commands for each selection. Never omit the flags and rely on auto-detection. [Skills CLI agent selection](https://github.com/vercel-labs/skills#available-options)

Needs `npm` with prefix `~/.local`, `jq`, `curl` for applicable steps. Missing: stop and tell the user. `gh` missing or `gh auth status` failing: warn that the issue and pull request flow in the `following-dev-workflow` skill falls back to local branches, and continue.

This skill sets up the host (agents, authentication, global rules, skills); `setting-up-projects` owns container toolchains and project-local MCP/browser launchers. Do not require agent installation or sign-in inside the container, or mount host agent homes or credentials; rootless engines, VMs and microVMs are not required. Check part 9 before project setup.

Versions: before the checks, compare every pinned version in this file with the latest release (`npm view <pkg> version`). Add available bumps to the plan (package, pinned, latest). For each accepted bump, edit the pin everywhere it appears in `$B` (`git -C $B grep -n '<pkg>@' -- ':!bench' ':!CHANGELOG.md'`, which also finds the Dockerfile and workflow pins (versions written as JSON values, such as the site's `web/package.json`, are bumped by Dependabot); the benchmark's pinned images and copies and the history stay), on a branch as `rules/global.md` requires, then install it through its part. The pins change only here, at install time, where the new version is tested.

## Parts

### 1. Global rules (Claude and Codex)
Check: `~/.claude/rules/00-global.md` is a symlink to `$B/rules/global.md` and is the only file in `~/.claude/rules/`; `~/.codex/AGENTS.md` equals `$B/rules/global.md`.
Install (also after every edit of `rules/global.md`). The `mv` replaces the whole `~/.codex/AGENTS.md`: show the diff and ask before it.
Claude Code only:
```sh
mkdir -p ~/.claude/rules && ln -sfn $B/rules/global.md ~/.claude/rules/00-global.md
```
Codex only:
```sh
cp $B/rules/global.md ~/.codex/AGENTS.md.new
diff ~/.codex/AGENTS.md ~/.codex/AGENTS.md.new
mv ~/.codex/AGENTS.md.new ~/.codex/AGENTS.md
```

### 2. OpenSpec
Check: `openspec --version`; `openspec config list` shows delivery skills and telemetry false.
Install:
```sh
npm i -g @fission-ai/openspec@1.14.2
openspec config set delivery skills && openspec config set telemetry.enabled false
```

### 3. Ponytail, level full
Check: `ponytail@ponytail` enabled in each selected agent's plugin list; `~/.config/ponytail/config.json` has `"defaultMode": "full"`; `PONYTAIL_DEFAULT_MODE` is unset or `full` (it overrides the file, [upstream configuration](https://github.com/DietrichGebert/ponytail/blob/main/INSTALL.md#settings)). Keep Ponytail and agent-skills; their integration lives in `$B/skills/following-dev-workflow/SKILL.md`, not in installed plugin files.
Install:
```sh
claude plugin marketplace add DietrichGebert/ponytail && claude plugin install ponytail@ponytail
codex plugin marketplace add DietrichGebert/ponytail && codex plugin add ponytail@ponytail
mkdir -p ~/.config/ponytail
f=~/.config/ponytail/config.json
test -f "$f" || printf '{}\n' > "$f"
jq '.defaultMode = "full"' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
```

### 4. addy agent-skills
Check: `agent-skills@addy-agent-skills` enabled in `claude plugin list`; `agent-skills@agent-skills` installed and enabled in `codex plugin list` (not the `openai-curated-remote` copy, which would duplicate every skill).
Install:
```sh
claude plugin marketplace add https://github.com/addyosmani/agent-skills.git && claude plugin install agent-skills@addy-agent-skills
codex plugin marketplace add addyosmani/agent-skills && codex plugin add agent-skills@agent-skills
```

### 5. Playwright MCP
Check: project Playwright runs inside its devcontainer; a host `npx` registration or host browser cache does not verify that connection. `setting-up-projects` installs `@playwright/mcp@0.0.83` and its matching Chromium inside the container, configures the project connection, and tests browser access to the project application. Report existing host Playwright registrations for migration; keep them disabled for container projects until the replacement is verified.

### 6. Skills
Check: each selected agent's skill directory links `setting-up-projects`, `setting-up-machine`, `following-dev-workflow` and `maintaining-repos` into `$B/skills/`, and has a readable `find-skills/SKILL.md`. `rules/global.md` loads `following-dev-workflow` before every repository edit, so a missing `following-dev-workflow` link is a failure.
Install:
```sh
DO_NOT_TRACK=1 npx -y skills@1.7.2 add vercel-labs/skills -s find-skills -g <agent-flags> --copy -y
mkdir -p <skill-dir>
for s in setting-up-machine setting-up-projects following-dev-workflow maintaining-repos; do ln -sfn $B/skills/$s <skill-dir>/$s; done
```

### 7. Settings and telemetry
Check: `~/.claude/settings.json` has `advisorModel` `opus`, `remoteControlAtStartup` true, `showClearContextOnPlanAccept` true, `autoCompactWindow` set (hard context limit: Claude Code compacts at this many tokens; 100000 to 1000000, default here 400000, a value the user chose stays; usage effect unmeasured, #66; [model configuration](https://code.claude.com/docs/en/model-config)), `attribution` `{"commit":"Assisted-by: generative AI","pr":"Created with the assistance of generative AI.","sessionUrl":false}` (neutral AI disclosure, no model name, no claude.ai session link), `env.DISABLE_ERROR_REPORTING` `1`, `env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY` `1`; `~/.codex/config.toml` has `[analytics]` `enabled = false` and `[feedback]` `enabled = false` (Codex has no attribution setting). [Claude attribution settings](https://code.claude.com/docs/en/settings-reference#attribution), [Codex config](https://developers.openai.com/codex/config-reference)
Install:
Claude Code only:
```sh
f=~/.claude/settings.json
jq '.advisorModel="opus" | .remoteControlAtStartup=true | .showClearContextOnPlanAccept=true | .autoCompactWindow=(.autoCompactWindow // 400000)
    | .attribution={"commit":"Assisted-by: generative AI","pr":"Created with the assistance of generative AI.","sessionUrl":false}
    | .env=((.env//{}) + {"DISABLE_ERROR_REPORTING":"1","CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY":"1"})' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
```
Codex only:
```sh
grep -q '^\[analytics\]' ~/.codex/config.toml || printf '\n[analytics]\nenabled = false\n' >> ~/.codex/config.toml
grep -q '^\[feedback\]' ~/.codex/config.toml || printf '\n[feedback]\nenabled = false\n' >> ~/.codex/config.toml
```

### 8. Advisor and Remote Control not disabled
Skip this part unless Claude Code is selected.
Check: `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_GROWTHBOOK`, `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` are set nowhere: settings `env`, current environment, `~/.config/fish/`, `~/.bashrc`, `~/.zshrc`, `~/.profile`, `/etc/environment`. The first four disable feature-flag fetching and with it the advisor and `/skill-doctor`; `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` and `DISABLE_GROWTHBOOK` also Remote Control ([env-vars](https://code.claude.com/docs/en/env-vars)); the last disables the advisor directly. A `DO_NOT_TRACK=1` prefix on a single command (as in the skills CLI lines) is fine.
Fix: remove the line after asking (`/etc/environment`: give the user the command).

### 9. Devcontainer tooling (host)
Check: `docker info` can reach a Docker Engine; `devcontainer --version` is `0.89.0`. A `docker` command alone does not prove the engine is available. Report a Podman compatibility command as a different runtime; do not replace it or change its mode automatically. If VS Code is used, `code --list-extensions --show-versions` includes `ms-vscode-remote.remote-containers`.

Install the [Dev Containers CLI](https://code.visualstudio.com/docs/devcontainers/devcontainer-cli):
```sh
npm i -g @devcontainers/cli@0.89.0
```
If Docker is missing or inaccessible, report the failure and give the platform's [Docker installation](https://docs.docker.com/engine/install/) or daemon-start instructions; never run sudo. If the VS Code extension is missing, resolve and pin its exact version before installing it. `setting-up-projects` owns each repository's configuration and launch checks. Do not report the development environment as ready until a container starts and its project checks run inside it.

### 10. Orca skills (optional, ask)
Check: `orca-cli/SKILL.md` and `orchestration/SKILL.md` are readable through each selected agent's skill directory. Keep existing installations. Missing optional skills are not a setup failure.

If either skill is missing for a selected agent, ask whether to install the optional Orca skills (`orca-cli` and `orchestration`), naming only the selected agents. Install only after an explicit yes. A no or no answer means skip; do not remove existing Orca skills or hooks.

Install only the missing skills or agent placements on the host, restricting `<agent-flags>` to selected agents missing that skill ([Orca installation instructions](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/cli/skills.mdx)):
```sh
DO_NOT_TRACK=1 npx -y skills@1.7.2 add https://github.com/stablyai/orca -s orca-cli -g <agent-flags> --copy -y
DO_NOT_TRACK=1 npx -y skills@1.7.2 add https://github.com/stablyai/orca -s orchestration -g <agent-flags> --copy -y
```
Check the skill files again after installation. The Orca application and CLI are installed separately; skill installation alone does not verify a working Orca runtime.

## Extras (clean)

List in the plan, as destructive, items belonging to selected agents that are not a part above. Do not classify an unselected agent or its tools as extras. Preserve shared files and tools still used by any unselected agent.

- Plugins and marketplaces other than `ponytail`, `addy-agent-skills` (Codex: `agent-skills`), `claude-plugins-official`: `claude plugin uninstall`, `claude plugin marketplace remove`, `codex plugin remove`, `codex plugin marketplace remove`.
- User MCP servers other than `playwright`: `claude mcp remove --scope user`, `codex mcp remove`.
- Links from before setup-v2.5 (`sdlc`, `maintain`, `global-setup`, `project-setup`) that point into `$B/skills/`: delete the symlink.
- Global skills other than parts 6 and 10: `npx -y skills@1.7.2 remove -g <name> <agent-flags>`, or delete only the selected agent's symlink.
- Hooks in `~/.claude/settings.json` and `~/.codex/hooks.json`.
- RTK, no longer part of this setup: `rtk init -g --uninstall` (Claude Code), `rtk init -g --codex --uninstall` (Codex), then the `rtk` binary, `~/.claude/RTK.md`, the `@RTK.md` line in `~/.claude/CLAUDE.md`, `~/.codex/RTK.md`.
- codegraph, no longer part of this setup: `npm rm -g @colbymchenry/codegraph`.
- Context7 MCP, no longer part of this setup: `claude mcp remove --scope user context7`, `codex mcp remove context7`.
- Spec Kit and uv, no longer part of this setup: `uv tool uninstall specify-cli`, `uv cache clean`, then `rm ~/.local/bin/uv ~/.local/bin/uvx` and `rm -r ~/.local/share/uv` when uv came from the standalone installer and nothing else uses it.
- LSP plugins, no longer part of this setup: `claude plugin uninstall pyright-lsp@claude-plugins-official`, `claude plugin uninstall typescript-lsp@claude-plugins-official`, and other `*-lsp@claude-plugins-official` plugins.
- Leftovers: a `statusLine` pointing to a missing file, rules files or `~/.codex/AGENTS.md` blocks from other toolkits, `*.bak` of the settings files, cache folders in `~/.claude/plugins/cache/` and `~/.codex/plugins/cache/` of plugins no longer installed, npm globals not used by a part above (except `@openai/codex`). Keep `@devcontainers/cli` on the host.

Never extras: `anthropic-plugin-directory` (Claude), `openai-curated-remote` (Codex), `~/.claude/skills/synced/`, `~/.claude/skills/.trash/`, npm global `@openai/codex`.

Kept unless the user says otherwise: Orca (`~/.orca`, its hooks, skills `orca-cli`, `orchestration`). Report them as kept.

## Report

List selected agents and skipped agents. Table of parts 1 to 9 (ok, fixed, failing, or skipped), optional part 10 (kept, installed, skipped, or failed), extras removed or kept. Report the container runtime and CLI separately from project container readiness. Then: restart only selected agents on the host; if Codex is selected, run `/hooks` and trust new plugin hooks; in new sessions check Ponytail reports `full`; if Claude Code is selected, check agent-skills commands (`/spec`, `/plan`), the advisor, and Remote Control.
