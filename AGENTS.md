# BenchKeeper

Global agent setup for Claude Code and Codex: global rules and the
global-setup and project-setup skills. Docs and config only, no build.

## Checks
- Links: CI (`.github/workflows/links.yml`, lychee)

## Layout
- `rules/global.md`: global rules (symlinked to `~/.claude/rules`, copied to `~/.codex/AGENTS.md`)
- `skills/<name>/SKILL.md`: this repo's skills; `.claude/skills/global-setup` and `.agents/skills/global-setup` link here
- `.agents/skills/skill-creator`: vendored from `anthropics/skills` (`skills-lock.json`), update with `npx -y skills@1.7.2 update -p`, do not edit
- `assets/logo.svg`: logo

## Conventions
- `rules/global.md` applies here: no em dash, no emojis, facts only.
- Every install command pins an exact version (`pkg@x.y.z`, RTK tag); `/global-setup` bumps them at install time.
- SKILL.md front matter: `description` in double quotes (it contains colons).
- After editing `rules/global.md`, rerun `/global-setup`.
