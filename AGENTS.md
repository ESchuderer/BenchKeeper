# BenchKeeper

Agents (Claude Code, Codex) run on the host in the repository or worktree: file edits, Git, `gh` and the `skills` CLI stay there. `node`, `npm` and `npx` run only in the dev container (`.devcontainer/`: Node 22.23.4, Playwright MCP with Chromium, the Chromium headless shell of `@playwright/test`). Start it: `devcontainer up --docker-path podman --workspace-folder .`. Below, `DC` stands for the prefix `devcontainer exec --docker-path podman --workspace-folder .`; compound commands run as `DC sh -lc 'cd web && npm ci && npm run build'`.

Workflows, quality gates, the hand-bumped pins and the local agent config (`.mcp.json`, project skills, `.worktreeinclude`): [docs/development.md](docs/development.md).

## Checks
- App: `DC sh -lc 'cd app && npm ci && npm run check:imports && npm run check:baselines && npm run test:coverage && npm run smoke'`, and for a UI change `DC sh -lc 'cd app && npm ci && npm run build && npm run test:ui'`. Coverage floors (`app/package.json`, `app/quality.json` `coverage`) sit a little under the measured values: raise them when coverage rises. Baselines (`app/quality.json` `baselines`) only shrink.
- App imports: a new file under `app/src/` belongs to the `engine` module unless a pattern in `app/.dependency-cruiser.cjs` names it. Everything Orca-specific goes through `app/src/orca/index.mjs`; the Orca name (`Orca`, `ORCA_`, a quoted `orca`) appears nowhere else.
- Site: `DC sh -lc 'cd web && npm ci && npm run build && npm test'`.
- Repository scripts: `DC node --test '.github/scripts/*.test.mjs'` and the `--check` runs of the generators below.
- Required checks, named by the rulesets, so a job change keeps them: `checks`, `app (ubuntu-latest)`, `app (macos-latest)`, `app-windows-smoke`, `build`, `lychee`, `conventional`, `dependency-review`.
- CI also fails on an em dash or emoji in text files outside `.agents/` and `.claude/`. Actions are pinned to commit SHAs with a version comment.

## Conventions
- `plugins/benchkeeper/rules/global.md` applies here: no em dash, no emojis, facts only.
- Default tier: research
- Pre-push review: `plugins/` counts as code, not docs.
- Branches: `main` is the only long-lived branch. Short-lived branches, pull requests into `main`, squash merge.
- Pull request title: a Conventional Commit (`.github/workflows/pr-title.yml`); it becomes the squash commit and the changelog line. A change users should receive (under `plugins/benchkeeper/` or `app/`) is `feat`, `fix` or `perf`; `docs`, `refactor`, `test`, `chore` and `ci` release nothing. Notes for a reader go in the pull request description.
- Releases belong to release-please and the owner ([docs/releasing.md](docs/releasing.md)). A change leaves alone: `version` in `app/package.json`, `app/package-lock.json` and the `plugin.json` files, `contentVersion` and `minApp` in `plugins/benchkeeper/content.json`, every `CHANGELOG.md`, and the `npx benchkeeper@<version>` and `app-v<version>` pins in the docs (`.github/scripts/version-pins.mjs` writes them on the release pull request).
- Install commands in docs pin an exact version (`pkg@x.y.z`); skill text under `plugins/` names the major (`npx benchkeeper@6`). The app installs host tools and the skills CLI at the newest release at least 7 days old (`SKILLS_CLI` is only the minimum). Skill sources and the Ponytail and Matt Pocock plugins are not pinned.
- Generated files: edit the source, run the generator, commit both; CI fails on a difference.

  | Output | Source | Command |
  |---|---|---|
  | `docs/skills.md` | SKILL.md `writes` and `when`, `pluginSkills` in `plugins/benchkeeper/library/library.json` | `DC node .github/scripts/skills-doc.mjs` |
  | tables in `plugins/benchkeeper/library/README.md` | `library.json` | `DC node .github/scripts/library-readme.mjs` |
  | README blocks, agent support tables in `docs/setup.md`, site facts | `web/src/data/facts.json`, `app/src/agents.json` | `DC node web/scripts/readme.mjs` |
  | `app/src/baseline/` | `ESchuderer/repo-standards` at `REF` in `app/src/baseline.mjs` | `DC node app/scripts/baseline-sync.mjs` |
  | `web/public/app/*.png`, when a pull request changes a pictured view | the UI test server in demo mode | `DC sh -lc 'cd app && npm run build && npm run screenshots'` |
  | `web/public/og.png` | `web/scripts/og.svg` | `rsvg-convert -w 1200 -h 630 web/scripts/og.svg -o web/public/og.png` |

- `facts.json`: every claim names its `evidence` (a repository file or test, a Markdown `#heading`, a BenchKeeper-research result; for another product its official page; string claims in the top-level `evidence` map), checked by `.github/scripts/claims.mjs`. A new top-level key goes into its lists. A claim of effect (faster, cheaper, better, safer) without evidence becomes a statement of what the product does.
- Skills: SKILL.md `description` in double quotes (`.github/scripts/skill-lint.mjs`). Plugin skills also carry `writes` and, when no sentence after the first says when the skill runs, `when`. Each skill has `agents/openai.yaml` for Codex; user-invoked skills set `allow_implicit_invocation: false`. Before editing `plugins/benchkeeper/skills/`, `plugins/benchkeeper/rules/` or this file, call the Skill tool with `mattpocock-skills:writing-for-agents`.
- `plugins/benchkeeper/library/` is the skill library that `setting-up-projects` installs per project (`library.json` is the source; community skills follow the default branch of their source). The plugin does not load it. Own library skills follow the `skills/` conventions.
- Plugin: `claude plugin validate plugins/benchkeeper --strict` and `claude plugin validate .`; one session with a change: `claude --plugin-dir plugins/benchkeeper`. After a release, ask the user to update the plugin (`claude plugin marketplace update benchkeeper && claude plugin update benchkeeper@benchkeeper`, Codex: `codex plugin marketplace upgrade benchkeeper`) and, when `rules/global.md` or the global steps changed, to run `npx benchkeeper@<version> apply`.
- App (`app/`, npm package `benchkeeper`): rules and skills come from `plugins/benchkeeper` (copied into `app/content/` at pack time). While developing, the app runs against a temporary home only: tests set `BENCHKEEPER_HOME` and stub `gh`, the UI test server uses the fixture home, and a CLI run by hand (`node bin/benchkeeper.mjs`) sets `BENCHKEEPER_HOME` to a new temporary folder. Applying a repo-standards profile to a real repository is repo-standards's `scripts/apply.mjs`, never a test.
- Benchmarks and evaluations live in ESchuderer/BenchKeeper-research (`bench/`, `evaluations/<category>/<tool>.md`, indexed in `EVALUATIONS.md`). Update them there, as a pull request, when a component is added, removed or changed, or new evidence appears.

## Agent skills

### Issue tracker

Issues live in GitHub Issues of `ESchuderer/BenchKeeper` (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repository root, read when present (neither exists yet). See `docs/agents/domain.md`.
