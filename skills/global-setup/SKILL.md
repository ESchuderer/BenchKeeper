---
name: global-setup
description: "Check, install, and clean the machine-wide agent setup for Claude Code and Codex: devcontainer tooling, global rules, Ponytail (full), addy agent-skills, RTK, OpenSpec, codegraph, Context7 MCP, Playwright MCP, LSP, telemetry. Use on a new machine, after editing the global rules, to update the pinned tool versions, or to verify or clean the global setup."
---

# Global setup

Brings the machine to the state below: required parts present, optional parts installed only when requested. `$B` is this skill's repository (`$B/skills/global-setup/`; normally `/mnt/data/Projects/benchkeeper`).

Process: select agents first, run applicable **Check** steps, show one table (part, ok, failing, or skipped, what is wrong), ask, then run the applicable **Install** commands of each failing part and check again. Never run sudo. Merge into the selected agents' settings; never overwrite them (Orca keeps hooks there).

## Agent selection

Detect `claude` and `codex` with `command -v`, then ask which installed agents the user uses and wants configured: Claude Code, Codex, both, or neither. Reuse an explicit selection already given in this session. Installation alone does not mean an agent is used. Do not install either agent CLI. If a requested agent is missing, report it and continue only with confirmed installed agents. If none are selected, stop without changes.

Apply every check, install, update, cleanup, and restart instruction only to selected agents. Leave unselected agents' configuration, plugins, hooks, and skill placements in place; skip their steps without marking setup as failed. Shared tools are installed once. Check the versions of packages needed by the selected steps only.

Blocks listing both `claude` and `codex` commands are alternatives: run only selected agents' lines. Use `--copy` for skills CLI installs to target agent directories directly. If existing shared links would change skill content used by an unselected agent, report and skip that mutation. [Skills installation modes](https://github.com/vercel-labs/skills/blob/v1.7.2/src/installer.ts)

| Selected agent | Skills CLI flag | Global skill directory |
|---|---|---|
| Claude Code | `-a claude-code` | `~/.claude/skills/` |
| Codex | `-a codex` | `~/.agents/skills/` |

In commands below, replace `<agent-flags>` with the selected agents' flags and `<skill-dir>` with a selected agent's directory; repeat directory-specific commands for each selection. Never omit the flags and rely on auto-detection. [Skills CLI agent selection](https://github.com/vercel-labs/skills#available-options)

Needs `npm` with prefix `~/.local`, `jq`, `curl`, and `gh` (authenticated, for the issue and pull request flow in `rules/global.md`) for applicable steps. Missing: stop and tell the user.

Agents run on the host; project development commands run in standard devcontainers. Apply this skill to the host agent setup and check part 11 before project setup. Keep BenchKeeper, agent authentication, global rules, and skills on the host. `project-setup` owns container toolchains and project-local MCP/browser launchers. Do not require agent installation or sign-in inside the container, or mount host agent homes or credentials. Rootless engines, VMs, and microVMs are not required.

Versions: before the checks, compare every pinned version in this file with the latest release (`npm view <pkg> version`; RTK: `curl -fsSL https://api.github.com/repos/rtk-ai/rtk/releases/latest | jq -r .tag_name`). Show a table (package, pinned, latest) and ask. For each accepted bump, edit the pin everywhere it appears in `$B` (`grep -rn '<pkg>@' $B --include='*.md'`), then install it through its part. Keep `typescript` on 5.x (part 8). The pins change only here, at install time, where the new version is tested.

## Parts

### 1. Global rules (Claude and Codex)
Check: `~/.claude/rules/00-global.md` is a symlink to `$B/rules/global.md` and is the only file in `~/.claude/rules/`; `~/.codex/AGENTS.md` equals the generated text below.
Install (also after every edit of `rules/global.md`). The `mv` replaces the whole `~/.codex/AGENTS.md`: show the diff and ask before it.
Claude Code only:
```sh
mkdir -p ~/.claude/rules && ln -sfn $B/rules/global.md ~/.claude/rules/00-global.md
```
Codex only:
```sh
{ cat $B/rules/global.md; printf '\n@%s/.codex/RTK.md\n' "$HOME"; } > ~/.codex/AGENTS.md.new
diff ~/.codex/AGENTS.md ~/.codex/AGENTS.md.new
mv ~/.codex/AGENTS.md.new ~/.codex/AGENTS.md
```

### 2. RTK
Check: `rtk --version`; `rtk hook claude` in `~/.claude/settings.json`; `rtk hook codex` in `~/.codex/hooks.json`; `~/.claude/CLAUDE.md` is `@RTK.md`; `rtk telemetry status` not consenting.
Install. The installer is a downloaded script: show it to the user and ask before running it.
```sh
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/v0.51.0/install.sh -o /tmp/rtk-install.sh
RTK_VERSION=v0.51.0 sh /tmp/rtk-install.sh
rtk telemetry disable
```
Initialize only the selected integrations:
```sh
# Claude Code only
rtk init -g --auto-patch --no-trust-filters
# Codex only
rtk init -g --codex
```

### 3. OpenSpec and codegraph
Check: `openspec --version`, `codegraph --version`; `openspec config list` shows delivery skills and telemetry false; `codegraph telemetry` disabled.
Install:
```sh
npm i -g @fission-ai/openspec@1.14.1 @colbymchenry/codegraph@1.6.2
openspec config set delivery skills && openspec config set telemetry.enabled false && codegraph telemetry off
```

### 4. Ponytail, level full
Check: `ponytail@ponytail` enabled in each selected agent's plugin list; `~/.config/ponytail/config.json` has `"defaultMode": "full"`; `PONYTAIL_DEFAULT_MODE` is unset or `full` (it overrides the file, [upstream configuration](https://github.com/DietrichGebert/ponytail/blob/main/INSTALL.md#settings)). Keep Ponytail and agent-skills; their integration lives in `$B/rules/global.md`, not in installed plugin files.
Install:
```sh
claude plugin marketplace add DietrichGebert/ponytail && claude plugin install ponytail@ponytail
codex plugin marketplace add DietrichGebert/ponytail && codex plugin add ponytail@ponytail
mkdir -p ~/.config/ponytail
f=~/.config/ponytail/config.json
test -f "$f" || printf '{}\n' > "$f"
jq '.defaultMode = "full"' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
```

### 5. addy agent-skills
Check: `agent-skills@addy-agent-skills` enabled in `claude plugin list`; `agent-skills@agent-skills` installed and enabled in `codex plugin list` (not the `openai-curated-remote` copy, which would duplicate every skill).
Install:
```sh
claude plugin marketplace add https://github.com/addyosmani/agent-skills.git && claude plugin install agent-skills@addy-agent-skills
codex plugin marketplace add addyosmani/agent-skills && codex plugin add agent-skills@agent-skills
```

### 6. Context7 and Playwright MCP
Check: selected agents use the Context7 HTTP endpoint. Project Playwright runs inside its devcontainer; a host `npx` registration or host browser cache does not verify that connection. `project-setup` installs `@playwright/mcp@0.0.83` and its matching Chromium inside the container, configures the project connection, and tests browser access to the project application. Report existing host Playwright registrations for migration; keep them disabled for container projects until the replacement is verified.
Install Context7 on the host:
```sh
claude mcp add --scope user --transport http context7 https://mcp.context7.com/mcp
codex mcp add context7 --url https://mcp.context7.com/mcp
```

### 7. Skills
Check: each selected agent's skill directory links `project-setup` and `global-setup` into `$B/skills/`, and has a readable `find-skills/SKILL.md`.
Install:
```sh
DO_NOT_TRACK=1 npx -y skills@1.7.2 add vercel-labs/skills -s find-skills -g <agent-flags> --copy -y
mkdir -p <skill-dir>
for s in project-setup global-setup; do ln -sfn $B/skills/$s <skill-dir>/$s; done
```

### 8. LSP (Claude)
Skip this part unless Claude Code is selected.
Check: `pyright-lsp@claude-plugins-official` and `typescript-lsp@claude-plugins-official` are installed on the host, with default host launches disabled. Check effective project overrides too; enable a project only after `project-setup` verifies the container connection and file paths. Host binaries on PATH do not establish container execution. Container defaults are `typescript@5.9.3`, `typescript-language-server@6.0.2`, and `pyright@1.1.414`; keep TypeScript on 5.x because 7.x lacks `tsserver.js`. Existing host binaries are not removed by this migration. [Plugin scopes](https://code.claude.com/docs/en/plugins/install)
Install the host plugins:
```sh
claude plugin install pyright-lsp@claude-plugins-official && claude plugin install typescript-lsp@claude-plugins-official
claude plugin disable pyright-lsp@claude-plugins-official --scope user
claude plugin disable typescript-lsp@claude-plugins-official --scope user
```

### 9. Settings and telemetry
Check: `~/.claude/settings.json` has `advisorModel` `opus`, `remoteControlAtStartup` true, `attribution.commit` `""` (disables commit co-author attribution), `env.DISABLE_ERROR_REPORTING` `1`, `env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY` `1`; `~/.codex/config.toml` has `[analytics]` `enabled = false`. [Claude attribution settings](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)
Install:
Claude Code only:
```sh
f=~/.claude/settings.json
jq '.advisorModel="opus" | .remoteControlAtStartup=true | .showClearContextOnPlanAccept=true
    | .attribution.commit=""
    | .env=((.env//{}) + {"DISABLE_ERROR_REPORTING":"1","CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY":"1"})' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
```
Codex only:
```sh
grep -q '^\[analytics\]' ~/.codex/config.toml || printf '\n[analytics]\nenabled = false\n' >> ~/.codex/config.toml
```

### 10. Advisor and Remote Control not disabled
Skip this part unless Claude Code is selected.
Check: `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_GROWTHBOOK` are set nowhere: settings `env`, current environment, `~/.config/fish/`, `~/.bashrc`, `~/.zshrc`, `~/.profile`, `/etc/environment`. Each disables feature flags and with them the advisor; some also Remote Control.
Fix: remove the line after asking (`/etc/environment`: give the user the command).

### 11. Devcontainer tooling (host)
Check: `docker info` can reach a Docker Engine; `devcontainer --version` is `0.89.0`. A `docker` command alone does not prove the engine is available. Report a Podman compatibility command as a different runtime; do not replace it or change its mode automatically. If VS Code is used, `code --list-extensions --show-versions` includes `ms-vscode-remote.remote-containers`.

Install the [Dev Containers CLI](https://code.visualstudio.com/docs/devcontainers/devcontainer-cli):
```sh
npm i -g @devcontainers/cli@0.89.0
```
If Docker is missing or inaccessible, report the failure and give the platform's [Docker installation](https://docs.docker.com/engine/install/) or daemon-start instructions; never run sudo. If the VS Code extension is missing, resolve and pin its exact version before installing it. `project-setup` owns each repository's configuration and launch checks. Do not report the development environment as ready until a container starts and its project checks run inside it.

### 12. Orca skills (optional, ask)
Check: `orca-cli/SKILL.md` and `orchestration/SKILL.md` are readable through each selected agent's skill directory. Keep existing installations. Missing optional skills are not a setup failure.

If either skill is missing for a selected agent, ask whether to install the optional Orca skills (`orca-cli` and `orchestration`), naming only the selected agents. Install only after an explicit yes. A no or no answer means skip; do not remove existing Orca skills or hooks.

Install only the missing skills or agent placements on the host, restricting `<agent-flags>` to selected agents missing that skill ([Orca installation instructions](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/cli/skills.mdx)):
```sh
DO_NOT_TRACK=1 npx -y skills@1.7.2 add https://github.com/stablyai/orca -s orca-cli -g <agent-flags> --copy -y
DO_NOT_TRACK=1 npx -y skills@1.7.2 add https://github.com/stablyai/orca -s orchestration -g <agent-flags> --copy -y
```
Check the skill files again after installation. The Orca application and CLI are installed separately; skill installation alone does not verify a working Orca runtime.

## Extras (clean)

List and propose removing items belonging to selected agents that are not a part above. Do not classify an unselected agent or its tools as extras. Preserve shared files and tools still used by any unselected agent.

- Plugins and marketplaces other than `ponytail`, `addy-agent-skills` (Codex: `agent-skills`), `claude-plugins-official` with its LSP plugins: `claude plugin uninstall`, `claude plugin marketplace remove`, `codex plugin remove`, `codex plugin marketplace remove`.
- User MCP servers other than `context7`, `playwright`: `claude mcp remove --scope user`, `codex mcp remove`.
- Global skills other than parts 7 and 12: `npx -y skills@1.7.2 remove -g <name> <agent-flags>`, or delete only the selected agent's symlink.
- Hooks in `~/.claude/settings.json` and `~/.codex/hooks.json` other than RTK.
- Leftovers: a `statusLine` pointing to a missing file, rules files or `~/.codex/AGENTS.md` blocks from other toolkits, `*.bak` of the settings files, cache folders in `~/.claude/plugins/cache/` and `~/.codex/plugins/cache/` of plugins no longer installed, npm globals not used by a part above (except `@openai/codex`). Keep `@devcontainers/cli` on the host.

Never extras: `anthropic-plugin-directory` (Claude), `openai-curated-remote` (Codex), `~/.claude/skills/synced/`, `~/.claude/skills/.trash/`, npm global `@openai/codex`, LSP plugins added by `project-setup`.

Kept unless the user says otherwise: Orca (`~/.orca`, its hooks, skills `orca-cli`, `orchestration`). Report them as kept.

## Report

List selected agents and skipped agents. Table of parts 1 to 11 (ok, fixed, failing, or skipped), optional part 12 (kept, installed, skipped, or failed), extras removed or kept. Report the container runtime and CLI separately from project container readiness. Then: restart only selected agents on the host; if Codex is selected, run `/hooks` and trust new plugin hooks; in new sessions check Ponytail reports `full`; if Claude Code is selected, check agent-skills commands (`/spec`, `/plan`), the advisor, and Remote Control.
