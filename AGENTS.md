# BenchKeeper

Agents (Claude Code, Codex) run on the host in the repository or worktree. File edits, Git and `gh` stay on the host, and so does the `skills` CLI install below (agent tooling). `node`, `npm` and `npx` run only in the dev container (`.devcontainer/`: Node 22.23.3, Playwright MCP 0.0.83 with Chromium, the Chromium headless shell of `@playwright/test` 1.64.0). When that version changes in `web/package.json`, change it in `.devcontainer/Dockerfile` too. Start it: `devcontainer up --docker-path podman --workspace-folder .`. Prefix: `devcontainer exec --docker-path podman --workspace-folder .`, compound commands as `... sh -lc 'cd web && npm ci && npm run build'`. `.mcp.json` and `.codex/config.toml` start Playwright MCP in the container through the same prefix (they run `devcontainer up` first, at the repository root). VS Code attached to the container: set `dev.containers.copyGitConfig` to `false` and `dev.containers.gitCredentialHelperConfigLocation` to `none` in the local user settings (the extension reads them only there), and do not forward the SSH agent.

## Checks
- Links and bench tests: CI (`.github/workflows/links.yml`). lychee checks all hosts except github.com. `.github/scripts/github-links.mjs` checks github.com through the GitHub API. The workflow also runs the bench unit, scorer and brief check tests and `bench/scripts/arm-rules.mjs --check`. Link checker test: `devcontainer exec --docker-path podman --workspace-folder . node --test .github/scripts/github-links.test.mjs`
- Repository: CI (`.github/workflows/checks.yml`): `actionlint`, no em dash or emoji in text files outside the vendored `.agents/` and `.claude/` folders and the recorded trial data in `bench/results/*/round-*`, SKILL.md `description` in double quotes. Actions are pinned to commit SHAs with a version comment. Dependabot (`.github/dependabot.yml`) updates the `uses:` pins and the site's npm packages weekly. The actionlint image digest and `node-version` are bumped by hand.
- Site: CI (`.github/workflows/pages.yml`): README sync, build, axe in light and dark, lychee on the built HTML. Deploys to GitHub Pages from `main`
- Site locally: `devcontainer exec --docker-path podman --workspace-folder . sh -lc 'cd web && npm ci && npm run build && npm test'`. Preview (`npm run preview`) under `/BenchKeeper/` on a free host port: `podman port $(podman ps -q --filter label=devcontainer.local_folder="$PWD") 4321`

## Conventions
- `plugins/benchkeeper/rules/global.md` applies here: no em dash, no emojis, facts only.
- Default tier: research
- Pre-push review: `plugins/` counts as code, not docs.
- Every install command in docs pins an exact version (`pkg@x.y.z`). `/benchkeeper:maintaining-repos` proposes bumps. The app installs host tools at the newest release at least 7 days old instead of a pin. Ponytail's marketplace tag (`PONYTAIL_REF` in `app/src/steps/global.mjs`) and the skills CLI version (`SKILLS_CLI`) are bumped by hand.
- SKILL.md front matter: `description` in double quotes (it contains colons). CI runs `.github/scripts/skill-lint.mjs` on own skills.
- Editing `plugins/benchkeeper/skills/` or `plugins/benchkeeper/rules/`: call the Skill tool with `mattpocock-skills:writing-for-agents`. Each skill has `agents/openai.yaml` for Codex: user-invoked skills set `allow_implicit_invocation: false`.
- `plugins/benchkeeper/library/`: the skill library that `setting-up-projects` installs per project. `library.json` is the source (skills, pinned refs, packs). `README.md` tables are generated: `devcontainer exec --docker-path podman --workspace-folder . node .github/scripts/library-readme.mjs`. The plugin does not load it. Own library skills follow the `skills/` conventions (SKILL.md, `agents/openai.yaml`).
- Plugin: `.claude-plugin/marketplace.json` (both agents read it) lists `plugins/benchkeeper/`. Its `version` in `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` equals the setup version and changes with each changelog entry. Check: `claude plugin validate .`. Try a change for one session: `claude --plugin-dir plugins/benchkeeper`. After a release, ask the user to update the plugin (`claude plugin marketplace update benchkeeper && claude plugin update benchkeeper@benchkeeper`, Codex: `codex plugin marketplace upgrade benchkeeper`) and, when `rules/global.md` or the global steps changed, to run `npx benchkeeper@<version> apply`. Neither starts on its own.
- Benchmark conventions (pinned BenchKeeper layer versions, arm variants): `bench/AGENTS.md`.
- Setup versions: `CHANGELOG.md` and tags `setup-v<major>.<minor>`. A change under `plugins/benchkeeper/` raises `version` (`<major>.<minor>.0`) in both `plugin.json` files and adds its changelog entry. The Release workflow checks this on pull requests, and on merge tags the version and publishes its GitHub Release (`.github/scripts/release.sh`, self-check `release.test.sh`).
- Description, core framework, prerequisites, recommended tools and OpenHands (README), SDLC steps (site only): edit `web/src/data/facts.json`, then run `devcontainer exec --docker-path podman --workspace-folder . node web/scripts/readme.mjs`. Never edit the generated README blocks by hand.
- App (`app/`): package `benchkeeper`, its `version` equals the plugin `version`. Rules and skills come from `plugins/benchkeeper` (copied into `app/content/` at pack time). Tests: `devcontainer exec --docker-path podman --workspace-folder . sh -lc 'cd app && npm ci && npm test'`. Never run `apply` against the real home directory while developing: tests use a temporary one (`BENCHKEEPER_HOME`).
- `.agents/skills/skill-creator` is vendored from `anthropics/skills` (`skills-lock.json`): do not edit. Update with `DO_NOT_TRACK=1 npx -y skills@1.7.2 add anthropics/skills -s skill-creator -a claude-code -a codex --copy -y`.
- Evaluations live in `evaluations/<category>/<tool>.md`, indexed in `EVALUATIONS.md`. Update both when a component is added, removed, changed, or new evidence appears.
- `web/scripts/og.svg` is the source of `web/public/og.png`: `rsvg-convert -w 1200 -h 630`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues of `ESchuderer/BenchKeeper` (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repository root, read when present (neither exists yet). See `docs/agents/domain.md`.
