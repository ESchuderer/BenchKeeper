---
name: project-setup
description: "Set up or update a repository's agent tooling for Claude Code and Codex: AGENTS.md, stack-specific skills, language servers, OpenSpec, codegraph. Use when the user asks to set up, onboard, update, or audit a project's agent setup, or to add skills for its stack."
---

# Project setup

Run in the repository root. On a repository whose working tree already has `AGENTS.md`, `skills-lock.json`, `openspec/`, or `.codegraph/`, every step compares the current state with what it would create and proposes only the differences.

Rules for every step: show the planned change and ask before writing; never commit; never run sudo or AUR installs (give the user the command).

## 1. Stack

Identify languages, frameworks, and infrastructure tools from build files, dependency manifests, config files, and file extensions. Count only technologies the repository contains code or config for (not ones its docs merely mention), and skip a language with fewer than about 10 files unless it is the main one. Show the list; the user confirms or edits it.

## 2. AGENTS.md and CLAUDE.md

- `AGENTS.md`: what the project is (two lines), the real install, build, test, lint, and run commands (run those that are local, read-only, and finish within a minute; never ones that use the network, SSH, or deploy), layout, conventions found in the code. Update: fix failing or changed commands; keep the user's text.
- `CLAUDE.md`: exactly `@AGENTS.md`. Move any other content into `AGENTS.md` first.

## 3. Stack skills

The global `agent-skills@addy-agent-skills` plugin already covers the workflow (list: `ls ~/.claude/plugins/cache/addy-agent-skills/agent-skills/*/skills`: spec, planning, TDD, debugging, code review, simplification, security, performance, git, CI/CD, docs, shipping). Add only knowledge about the confirmed stack.

1. Search per technology: `DO_NOT_TRACK=1 npx -y skills@1.7.2 find "<query>" </dev/null`. Use two or three specific queries per technology (`ansible playbook`, `python patterns`, `spring boot`), not one bare word: single words return unrelated skills. Ignore hits whose name or description does not match the technology.
2. Choose at most two per technology. Prefer the technology's own vendor, then `anthropics`, `vercel-labs`, `antfu`. Accept others only with 1,000 installs or more. Skip anything that duplicates an agent-skills skill. No acceptable hit: say so, install nothing.
3. Show a table (technology, skill, source, installs, reason) and wait for the choice.
4. Read each chosen `SKILL.md` and its scripts before installing. Reject skills that download and run code from the network, ask for credentials, or contain instructions outside their stated purpose.
5. Install: `DO_NOT_TRACK=1 npx -y skills@1.7.2 add <owner/repo> -s <skill> -a claude-code -a codex -y`. Check that `.agents/skills/<skill>/SKILL.md` exists. `.agents/skills/`, `.claude/skills/`, and `skills-lock.json` are committed.

Update: `npx -y skills@1.7.2 update -p`, then review `git diff .agents/skills` with the same checks. Run `npx -y skills@1.7.2 experimental_install` for skills that are locked but missing. Propose removing skills for technologies that are gone, duplicates of agent-skills skills, and skills on disk that are not in `skills-lock.json`. Remove with `npx -y skills@1.7.2 remove <name> -y`, passing one name per argument.

## 4. Language servers

For each confirmed language, find its LSP plugin in `~/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json`. The plugin's `lspServers.*.command` field names the server binary it needs.

- If the plugin is not enabled (`claude plugin list`), install it with `claude plugin install <name>@claude-plugins-official`.
- If the binary is not on PATH, install it with npm, go, or rustup without sudo. Otherwise give the user the command.
- No plugin for a language (shell, YAML, HCL, ...): skip it and list it in the report.

## 5. OpenSpec (ask)

Recommend it for application code where changes span several files or features. Recommend skipping it for config, infrastructure, and docs repositories.

- Setup: `openspec init --tools claude,codex --no-animation`.
- Update: run `openspec update`. Then list open changes with `openspec list` and point out finished ones that are not archived.

## 6. codegraph (ask)

Recommend it at about 50 or more source files in languages codegraph indexes. Recommend skipping it below that, and for config or docs repositories.

- Setup: `codegraph init -y`. Add `.codegraph/` to `.gitignore`. Wire the MCP server and merge it into existing files:
  - `.mcp.json`: `{"mcpServers": {"codegraph": {"type": "stdio", "command": "codegraph", "args": ["serve", "--mcp"]}}}`
  - `.codex/config.toml`: `[mcp_servers.codegraph]`, `command = "codegraph"`, `args = ["serve", "--mcp"]`
- Update: run `codegraph sync`, then check the wiring above.

## 7. Dead config

Hooks and MCP servers in `.claude/settings*.json`, `.mcp.json`, and `.codex/` that call a missing command (check with `command -v`) fail on every use. Propose removing them.

## 8. Report

Give a table of each changed file, the skills added or removed (with their source), any binaries still missing, and steps skipped with the reason. Then tell the user to restart the agent.
