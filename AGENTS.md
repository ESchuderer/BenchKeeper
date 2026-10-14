# BenchKeeper

## Checks
- Links: CI (`.github/workflows/links.yml`, lychee)
- Site: CI (`.github/workflows/pages.yml`): README sync, build, axe in light and dark, lychee on the built HTML; deploys to GitHub Pages from `main`
- Site locally (no devcontainer in this repo; throwaway containers mounting only the repo):
  - build: `podman run --rm --userns=keep-id -e HOME=/tmp -e ASTRO_TELEMETRY_DISABLED=1 -v "$PWD":/repo:Z -w /repo/web docker.io/library/node:22.23.3-bookworm-slim sh -c 'npm ci && npm run build'`
  - test: same with `mcr.microsoft.com/playwright:v1.64.0-noble` and `sh -c 'npm run build && npm test'`

## Conventions
- `rules/global.md` applies here: no em dash, no emojis, facts only.
- Default tier: research
- Every install command pins an exact version (`pkg@x.y.z`); `/global-setup` bumps them at install time.
- SKILL.md front matter: `description` in double quotes (it contains colons).
- After editing `rules/global.md`, rerun `/global-setup`.
- Description, SDLC steps, prerequisites and recommended tools: edit `web/src/data/facts.json`, then run `node web/scripts/readme.mjs`; never edit the generated README blocks by hand.
- `rules/global.md` is symlinked to `~/.claude/rules` and copied to `~/.codex/AGENTS.md`.
- `.agents/skills/skill-creator` is vendored from `anthropics/skills` (`skills-lock.json`): do not edit; update with `DO_NOT_TRACK=1 npx -y skills@1.7.2 add anthropics/skills -s skill-creator -a claude-code -a codex --copy -y`.
- Update `EVALUATIONS.md` when a component is added, removed, or changed.
- `web/scripts/og.svg` is the source of `web/public/og.png`: `rsvg-convert -w 1200 -h 630`.
- Specs use OpenSpec (`openspec/`: current specs in `specs/`, changes in `changes/`). Generated OpenSpec skills in `.claude/skills/openspec-*`, `.agents/skills/openspec-*` are vendored: do not edit.
