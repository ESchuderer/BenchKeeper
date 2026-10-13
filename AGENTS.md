# BenchKeeper

Global agent setup for Claude Code and Codex: global rules and the
global-setup and project-setup skills. Docs and config, plus a static site
in `web/` (Astro, Mantine) built and deployed by CI.

## Checks
- Links: CI (`.github/workflows/links.yml`, lychee)
- Site: CI (`.github/workflows/pages.yml`): README sync, build, axe in light and dark, lychee on the built HTML; deploys to GitHub Pages from `main`
- Site locally (no devcontainer in this repo; throwaway containers mounting only the repo):
  - build: `podman run --rm --userns=keep-id -e HOME=/tmp -v "$PWD":/repo:Z -w /repo/web docker.io/library/node:22.23.3-bookworm-slim sh -c 'npm ci && npm run build'`
  - test: same with `mcr.microsoft.com/playwright:v1.64.0-noble` and `sh -c 'npm run build && npm test'`

## Layout
- `rules/global.md`: global rules (symlinked to `~/.claude/rules`, copied to `~/.codex/AGENTS.md`)
- `skills/<name>/SKILL.md`: this repo's skills; `.claude/skills/global-setup` and `.agents/skills/global-setup` link here
- `.agents/skills/skill-creator`: vendored from `anthropics/skills` (`skills-lock.json`), update with `npx -y skills@1.7.2 update -p`, do not edit
- `assets/logo.svg`: logo
- `web/`: site; `src/components/Page.tsx` content, `src/data/facts.json` facts shared with the README, `tests/` axe test
- `web/scripts/`: `readme.mjs` writes the README blocks marked `generated` from `facts.json`; `sdlc.py` writes `src/assets/sdlc.svg`; `og.svg` is the source of `public/og.png` (`rsvg-convert -w 1200 -h 630`)

## Conventions
- `rules/global.md` applies here: no em dash, no emojis, facts only.
- Every install command pins an exact version (`pkg@x.y.z`, RTK tag); `/global-setup` bumps them at install time.
- SKILL.md front matter: `description` in double quotes (it contains colons).
- After editing `rules/global.md`, rerun `/global-setup`.
- Prerequisites and recommended tools: edit `web/src/data/facts.json`, then run `node web/scripts/readme.mjs`; never edit the generated README blocks by hand.
