---
name: global-setup
description: "Check, install, and clean the machine-wide agent setup for Claude Code and Codex: global rules, Ponytail (lite), addy agent-skills, RTK, OpenSpec, codegraph, Context7 MCP, Playwright MCP, LSP, telemetry. Use on a new machine, after editing the global rules, to update the pinned tool versions, or to verify or clean the global setup."
---

# Global setup

Brings the machine to exactly the state below: every part present, nothing else agent-related. `$B` is this skill's repository (`$B/skills/global-setup/`; normally `/mnt/data/Projects/benchkeeper`).

Process: run every **Check**, show one table (part, ok or failing, what is wrong), ask, then run the **Install** block of each failing part and check again. Never run sudo. Merge into `~/.claude/settings.json` and `~/.codex/config.toml`; never overwrite them (Orca keeps hooks there).

Needs `claude`, `codex`, `npm` with prefix `~/.local`, `jq`, `curl`. Missing: stop and tell the user.

Versions: before the checks, compare every pinned version in this file with the latest release (`npm view <pkg> version`; RTK: `curl -fsSL https://api.github.com/repos/rtk-ai/rtk/releases/latest | jq -r .tag_name`). Show a table (package, pinned, latest) and ask. For each accepted bump, edit the pin everywhere it appears in `$B` (`grep -rn '<pkg>@' $B --include='*.md'`), then install it through its part. Keep `typescript` on 5.x (part 8). The pins change only here, at install time, where the new version is tested.

## Parts

### 1. Global rules (Claude and Codex)
Check: `~/.claude/rules/00-global.md` is a symlink to `$B/rules/global.md` and is the only file in `~/.claude/rules/`; `~/.codex/AGENTS.md` equals the generated text below.
Install (also after every edit of `rules/global.md`). The `mv` replaces the whole `~/.codex/AGENTS.md`: show the diff and ask before it.
```sh
mkdir -p ~/.claude/rules && ln -sfn $B/rules/global.md ~/.claude/rules/00-global.md
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
rtk init -g --auto-patch --no-trust-filters && rtk init -g --codex && rtk telemetry disable
```

### 3. OpenSpec and codegraph
Check: `openspec --version`, `codegraph --version`; `openspec config list` shows delivery skills and telemetry false; `codegraph telemetry` disabled.
Install:
```sh
npm i -g @fission-ai/openspec@1.14.1 @colbymchenry/codegraph@1.6.2
openspec config set delivery skills && openspec config set telemetry.enabled false && codegraph telemetry off
```

### 4. Ponytail, level lite
Check: `ponytail@ponytail` enabled in `claude plugin list` and `codex plugin list`; `~/.config/ponytail/config.json` has `"defaultMode": "lite"`.
Install:
```sh
claude plugin marketplace add DietrichGebert/ponytail && claude plugin install ponytail@ponytail
codex plugin marketplace add DietrichGebert/ponytail && codex plugin add ponytail@ponytail
mkdir -p ~/.config/ponytail && echo '{"defaultMode": "lite"}' > ~/.config/ponytail/config.json
```

### 5. addy agent-skills
Check: `agent-skills@addy-agent-skills` enabled in `claude plugin list`; `agent-skills@agent-skills` installed and enabled in `codex plugin list` (not the `openai-curated-remote` copy, which would duplicate every skill).
Install:
```sh
claude plugin marketplace add https://github.com/addyosmani/agent-skills.git && claude plugin install agent-skills@addy-agent-skills
codex plugin marketplace add addyosmani/agent-skills && codex plugin add agent-skills@agent-skills
```

### 6. Context7 and Playwright MCP
Check: `claude mcp list` shows `context7` (HTTP) and `playwright` (`--browser chromium`) connected; `codex mcp list` shows both; `~/.cache/ms-playwright/chromium-*` exists.
Install:
```sh
npx -y playwright@$(npm view @playwright/mcp@0.0.83 dependencies.playwright) install chromium
claude mcp add --scope user --transport http context7 https://mcp.context7.com/mcp
claude mcp add --scope user playwright -- npx -y @playwright/mcp@0.0.83 --browser chromium
codex mcp add context7 -- npx -y @upstash/context7-mcp@4.3.0
codex mcp add playwright -- npx -y @playwright/mcp@0.0.83 --browser chromium
```

### 7. Skills
Check: `~/.claude/skills/` and `~/.agents/skills/` link `project-setup` and `global-setup` into `$B/skills/`; `~/.agents/skills/find-skills/SKILL.md` exists.
Install:
```sh
DO_NOT_TRACK=1 npx -y skills@1.7.2 add vercel-labs/skills -s find-skills -g -a claude-code -a codex -y
for s in project-setup global-setup; do ln -sfn $B/skills/$s ~/.claude/skills/$s; ln -sfn $B/skills/$s ~/.agents/skills/$s; done
```

### 8. LSP (Claude)
Check: `pyright-lsp@claude-plugins-official` and `typescript-lsp@claude-plugins-official` enabled; `pyright-langserver` and `typescript-language-server` on PATH; `npm ls -g typescript` is 5.x (7.x lacks `tsserver.js`).
Install:
```sh
npm i -g typescript@5.9.3 typescript-language-server@6.0.2 pyright@1.1.414
claude plugin install pyright-lsp@claude-plugins-official && claude plugin install typescript-lsp@claude-plugins-official
```

### 9. Settings and telemetry
Check: `~/.claude/settings.json` has `advisorModel` `opus`, `remoteControlAtStartup` true, `env.DISABLE_ERROR_REPORTING` `1`, `env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY` `1`; `~/.codex/config.toml` has `[analytics]` `enabled = false`.
Install:
```sh
f=~/.claude/settings.json
jq '.advisorModel="opus" | .remoteControlAtStartup=true | .showClearContextOnPlanAccept=true
    | .env=((.env//{}) + {"DISABLE_ERROR_REPORTING":"1","CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY":"1"})' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
grep -q '^\[analytics\]' ~/.codex/config.toml || printf '\n[analytics]\nenabled = false\n' >> ~/.codex/config.toml
```

### 10. Advisor and Remote Control not disabled
Check: `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_GROWTHBOOK` are set nowhere: settings `env`, current environment, `~/.config/fish/`, `~/.bashrc`, `~/.zshrc`, `~/.profile`, `/etc/environment`. Each disables feature flags and with them the advisor; some also Remote Control.
Fix: remove the line after asking (`/etc/environment`: give the user the command).

## Extras (clean)

List and propose removing everything agent-related that is not a part above:

- Plugins and marketplaces other than `ponytail`, `addy-agent-skills` (Codex: `agent-skills`), `claude-plugins-official` with its LSP plugins: `claude plugin uninstall`, `claude plugin marketplace remove`, `codex plugin remove`, `codex plugin marketplace remove`.
- User MCP servers other than `context7`, `playwright`: `claude mcp remove --scope user`, `codex mcp remove`.
- Global skills other than part 7: `npx -y skills@1.7.2 remove -g <name>`, or delete the symlink.
- Hooks in `~/.claude/settings.json` and `~/.codex/hooks.json` other than RTK.
- Leftovers: a `statusLine` pointing to a missing file, rules files or `~/.codex/AGENTS.md` blocks from other toolkits, `*.bak` of the settings files, cache folders in `~/.claude/plugins/cache/` and `~/.codex/plugins/cache/` of plugins no longer installed, npm globals not used by a part above (except `@openai/codex`).

Never extras: `anthropic-plugin-directory` (Claude), `openai-curated-remote` (Codex), `~/.claude/skills/synced/`, `~/.claude/skills/.trash/`, npm global `@openai/codex`, LSP plugins added by `project-setup`.

Kept unless the user says otherwise: Orca (`~/.orca`, its hooks, skills `orca-cli`, `orchestration`). Report them as kept.

## Report

Table of parts 1 to 10 (ok or fixed or failing), extras removed or kept. Then: restart Claude Code and Codex; in Codex run `/hooks` and trust new plugin hooks; in a new Claude session check Ponytail reports `lite`, agent-skills commands (`/spec`, `/plan`) exist, the advisor is available, Remote Control connects.
