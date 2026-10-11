<p align="center"><img src="assets/logo.svg" alt="BenchKeeper logo" width="160"></p>

# BenchKeeper

Global agent setup for Claude Code and Codex: rules, two skills, rebuild steps.

## Contents

| Path | What | Linked as |
|---|---|---|
| [rules/global.md](rules/global.md) | global rules | `~/.claude/rules/00-global.md` (symlink); copy in `~/.codex/AGENTS.md` |
| [skills/global-setup](skills/global-setup/SKILL.md) | install, check, and clean the global setup (all commands) | `~/.claude/skills/`, `~/.agents/skills/`, and in this repo |
| [skills/project-setup](skills/project-setup/SKILL.md) | set up or update one repo: AGENTS.md, stack skills, LSP, OpenSpec, codegraph | `~/.claude/skills/`, `~/.agents/skills/` |

## Components

| Component | Scope | Purpose |
|---|---|---|
| [Ponytail](https://github.com/DietrichGebert/ponytail), level `lite` | global, Claude + Codex | smallest-change coding |
| [agent-skills](https://github.com/addyosmani/agent-skills) | global, Claude + Codex | workflow: spec, plan, TDD, review, ship |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec) | CLI global, wired per repo | spec files (owns the artifacts; agent-skills drives the process, [#166](https://github.com/addyosmani/agent-skills/issues/166)) |
| [codegraph](https://github.com/colbymchenry/codegraph) | CLI global, wired per repo | code index + MCP |
| [RTK](https://github.com/rtk-ai/rtk) | global, Claude + Codex | condensed command output |
| [Context7 MCP](https://github.com/upstash/context7) | global, Claude + Codex | library docs |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | global, Claude + Codex | browser checks |
| [find-skills](https://github.com/vercel-labs/skills) | global | skill search, used by `project-setup` |
| LSP `pyright-lsp`, `typescript-lsp` | global, Claude | type errors after edits; more per repo via `project-setup` |

Per repo (committed): `AGENTS.md`, `CLAUDE.md`, `.agents/skills/`, `.claude/skills/`, `skills-lock.json`, `openspec/`, `.mcp.json`, `.codex/config.toml`. Not committed: `.codegraph/`.

## Telemetry

| Tool | Setting |
|---|---|
| Claude Code | `DISABLE_ERROR_REPORTING=1`, `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1` |
| Claude Code, not set | `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`: they disable feature flags, so the advisor and Remote Control stop working ([docs](https://code.claude.com/docs/en/env-vars)) |
| Codex | `[analytics] enabled = false` |
| RTK, OpenSpec, codegraph | off |
| skills CLI | `DO_NOT_TRACK=1` per command only |

## Setup steps

1. Needs: `claude`, `codex`, `npm` (prefix `~/.local`, no sudo), `jq`, `curl`.
2. Clone to `/mnt/data/Projects/benchkeeper`, open it in Claude Code or Codex.
3. Run `/global-setup` (Codex: `$global-setup`). It checks each part, installs what is missing after confirmation, and removes extras. All commands are in [skills/global-setup/SKILL.md](skills/global-setup/SKILL.md).
4. Restart both agents; in Codex run `/hooks` and trust the plugin hooks.
5. Java LSP (needs sudo, by hand): `sudo pacman -S jdk-openjdk`, `jdtls` (AUR), `claude plugin install jdtls-lsp@claude-plugins-official`.

Rerun `/global-setup` after editing `rules/global.md` (Codex gets a copy, not a link).

## Per repo

Run `/project-setup` (Codex: `$project-setup`). New repo: sets up. Existing setup: updates and cleans. Commit the result. Fresh clone: `npx -y skills@1.7.2 experimental_install`.

## Update

- Plugins: `claude plugin marketplace update`, `codex plugin marketplace update` (not pinned).
- CLIs and MCPs: `/global-setup` compares the pinned versions with the latest releases and proposes bumps before installing.
- Repo skills: `npx -y skills@1.7.2 update -p`.

## Recommended: Orca

[Orca](https://github.com/stablyai/orca) ([onorca.dev](https://onOrca.dev)): desktop app to run and orchestrate parallel agents (Claude Code, Codex) with your own subscriptions; desktop, mobile, remote. Installed separately through its own app, not by `/global-setup`. It adds hooks to `~/.claude/settings.json` and `~/.codex/hooks.json` and the skills `orca-cli`, `orchestration`; `/global-setup` keeps them.
