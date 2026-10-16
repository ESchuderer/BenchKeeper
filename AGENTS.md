# BenchKeeper

Agents (Claude Code, Codex) run on the host in the repository or worktree; file edits, Git and `gh` stay on the host, and so does the `skills` CLI install below (agent tooling). `node`, `npm` and `npx` run only in the dev container (`.devcontainer/`: Node 22.23.3, Playwright MCP 0.0.83 with Chromium, the Chromium headless shell of `@playwright/test` 1.64.0; when that version changes in `web/package.json`, change it in `.devcontainer/Dockerfile` too). Start it: `devcontainer up --docker-path podman --workspace-folder .`; prefix: `devcontainer exec --docker-path podman --workspace-folder .`, compound commands as `... sh -lc 'cd web && npm ci && npm run build'`. `.mcp.json` and `.codex/config.toml` start Playwright MCP in the container through the same prefix (they run `devcontainer up` first, at the repository root). VS Code attached to the container: set `dev.containers.copyGitConfig` to `false` and `dev.containers.gitCredentialHelperConfigLocation` to `none` in the local user settings (the extension reads them only there), and do not forward the SSH agent.

## Checks
- Links: CI (`.github/workflows/links.yml`): lychee for all hosts except github.com, which `.github/scripts/github-links.mjs` checks through the GitHub API (test: `devcontainer exec --docker-path podman --workspace-folder . node --test .github/scripts/github-links.test.mjs`)
- Site: CI (`.github/workflows/pages.yml`): README sync, build, axe in light and dark, lychee on the built HTML; deploys to GitHub Pages from `main`
- Site locally: `devcontainer exec --docker-path podman --workspace-folder . sh -lc 'cd web && npm ci && npm run build && npm test'`; preview (`npm run preview`) under `/BenchKeeper/` on a free host port: `podman port $(podman ps -q --filter label=devcontainer.local_folder="$PWD") 4321`

## Conventions
- `rules/global.md` applies here: no em dash, no emojis, facts only.
- Default tier: research
- Pre-push review: `rules/` and `skills/` count as code, not docs.
- Every install command pins an exact version (`pkg@x.y.z`); `/global-setup` bumps them at install time.
- SKILL.md front matter: `description` in double quotes (it contains colons).
- After editing `rules/global.md`, rerun `/global-setup`.
- Description, SDLC steps, prerequisites and recommended tools: edit `web/src/data/facts.json`, then run `devcontainer exec --docker-path podman --workspace-folder . node web/scripts/readme.mjs`; never edit the generated README blocks by hand.
- `rules/global.md` is symlinked to `~/.claude/rules` and copied to `~/.codex/AGENTS.md`.
- `.agents/skills/skill-creator` is vendored from `anthropics/skills` (`skills-lock.json`): do not edit; update with `DO_NOT_TRACK=1 npx -y skills@1.7.2 add anthropics/skills -s skill-creator -a claude-code -a codex --copy -y`.
- Evaluations live in `evaluations/<category>/<tool>.md`, indexed in `EVALUATIONS.md`; update both when a component is added, removed, changed, or new evidence appears.
- `web/scripts/og.svg` is the source of `web/public/og.png`: `rsvg-convert -w 1200 -h 630`.
- Specs use OpenSpec (`openspec/`: current specs in `specs/`, changes in `changes/`). Generated OpenSpec skills in `.claude/skills/openspec-*`, `.agents/skills/openspec-*` are vendored: do not edit.
