# Development

How the checks, the workflows and the local agent setup of this repository work.

## Workflows

- `checks.yml` runs `checks-core`, `app-ui-tests` and `plugin-checks` in parallel; the job `checks` gates all three.
- Every workflow has `permissions: {}` at the top and per job, `timeout-minutes` on every job and a `concurrency` group that cancels superseded pull request runs.
- Every required check runs on pull requests into `main` and on pushes to `main`, except `conventional` (the pull request title) and `dependency-review`, which run on pull requests only.
- The rulesets name the required checks: `checks`, `app (ubuntu-latest)`, `app (macos-latest)`, `app-windows-smoke`, `build`, `conventional`, `dependency-review`. A job change keeps these names.
- `checks-core`: `actionlint`, `zizmor` (a checkout keeps its credentials only with a `zizmor: ignore[artipacked]` reason), no em dash or emoji in text files outside the `.agents/` and `.claude/` folders, the `.github/scripts/` tests and checks (skill lint, generated docs, version pins, claims).
- Actions are pinned to commit SHAs with a version comment. Dependabot (`.github/dependabot.yml`) updates the `uses:` pins and the npm packages of the site, the app and `.github/pnpm` (the pnpm of the CedarLoom CI) weekly. By hand: the actionlint image digest, `node-version` in every workflow, the dev container image and its pnpm (they follow the Node 26 line of `cedarloom.yml` and the pnpm of `.github/pnpm`, and the CI step `Version pins` fails when the Node or the pnpm differs; bump the image's tag and digest together, since the step reads the tag; BenchKeeper's own workflows stay on Node 22), and the Claude Code pin of the `plugin-checks` job (`.github/claude-code/package.json` and its lockfile, the npm `stable` tag).
- The Chromium headless shell version of `@playwright/test` in `web/package.json` and `app/package.json` is also set in `.devcontainer/Dockerfile`; the CI step `Version pins` fails when they differ.

## App quality gates

The CI job `app` runs `npm run check:imports`, `npm run check:baselines`, `npm run test:coverage` and `npm run smoke` in `app/`.

- Coverage: `npm run test:coverage` prints it and has no floors. Counted: `src/**` and `ui/*.js`, not `ui/api.js` (browser fetch wrapper, covered by the UI tests) nor the `draw()` page script of `src/board.mjs` (browser-only, `node:coverage disable`).
- Imports: dependency-cruiser with `app/.dependency-cruiser.cjs`, one rule per module (`core`, `agents`, `content`, `orca`, `engine`, `server`, `cli`, `ui`) for what it may import, and no cycle. `app/scripts/imports.mjs` also fails on the Orca name (`Orca`, `ORCA_`, a quoted `orca`) outside `app/src/orca/`. A new file under `src/` belongs to `engine` unless a module pattern names it; a file moved into a folder changes only its pattern.
- Baselines: knip and jscpd against `baselines` in `app/quality.json`. A new knip finding or more duplicated lines fail, and so does a fixed finding still listed: `node scripts/quality.mjs baselines --write` removes it (it never adds one).
- Mutation: `.github/workflows/mutation.yml` runs Stryker (command runner: `node --test` has no Stryker runner) per module of `app/quality.json` `mutation`, weekly and on `workflow_dispatch` for one module. In the dev container: `MUTATE_MODULE=<module> npm run mutate` in `app/`. It mutates `src/` in place (tests read files outside `app/`) and restores it at the end; after a killed run, restore `app/src/` with Git. The tests are the files that import `src/<module>.mjs`, or the module's `tests`. A module's `floor` is its first measured score minus 2 points; `floor: null` only reports, so set it from the first run.
- SonarCloud: automatic analysis, no workflow. The gate on new code is set by the owner in SonarCloud: 0 open issues, duplication not above the recorded baseline. It has no coverage condition.

In the dev container, 3 app tests fail because of the container, not the code or its Node version; on the CI runners the first two pass and the third is skipped. A failure beyond these three is a real one.

- `machine setup` and `machine session variables` need `ssh-keygen`, which the image lacks ([#979](https://github.com/ESchuderer/BenchKeeper/issues/979)).
- `sandbox: srt confines a real command ...` runs because `.devcontainer/compose.yaml` sets `BENCHKEEPER_SANDBOX_TEST=1` (CI does not, so it skips the test there), and srt does not start in the rootless podman container ([#1019](https://github.com/ESchuderer/BenchKeeper/issues/1019)).

## Site

`.github/workflows/pages.yml` runs the README sync check, the build, and axe in light and dark. It deploys on pushes to `main`, on a published release and by hand ([releasing](releasing.md#site)); a failing `build` job fails the run and the previous deployment stays. Pushes share one concurrency group, so deployments are ordered.

Preview: `npm run preview` in `web/` in the dev container serves the site under `/BenchKeeper/` on a free host port: `podman port $(podman ps -q --filter label=devcontainer.local_folder="$PWD") 4321`.

## Dev container in VS Code

Set `dev.containers.copyGitConfig` to `false` and `dev.containers.gitCredentialHelperConfigLocation` to `none` in the local user settings (the extension reads them only there), and do not forward the SSH agent.

## Agent config

The project skills (`.claude/skills/`, `.agents/skills/`), `skills-lock.json`, `.mcp.json` and `.codex/config.toml` are local to each checkout and not tracked. In a new clone:

1. Run the project setup of [setup](setup.md#per-repo) with `--agents claude,codex`. It installs the skills and the lock file and lists them in `.git/info/exclude`.
2. Write the Playwright MCP server `playwright` into `.mcp.json` (`mcpServers.playwright`: `type` `stdio`, `command` `sh`, `args` `-c` and the line below) and into `.codex/config.toml` (`[mcp_servers.playwright]`, the same `command` and `args`). The line:

   ```sh
   root=$(git rev-parse --show-toplevel) && devcontainer up --docker-path podman --workspace-folder "$root" < /dev/null > /dev/null 2>&1 && exec devcontainer exec --docker-path podman --workspace-folder "$root" playwright-mcp --browser chromium --headless
   ```

3. Add `/.mcp.json`, `/.codex/config.toml`, `/.claude/skills` and `/.agents/skills` to `.git/info/exclude`.

A new worktree (Orca, Claude Code `--worktree`) gets a copy of the paths that `.worktreeinclude` in the primary checkout lists, when Git ignores them there. The project setup of step 1 writes that file with its own list between `# benchkeeper:worktrees` markers and adds `/.worktreeinclude` to `.git/info/exclude`. Add `.mcp.json` and `.codex/config.toml` below the block, one path per line; the setup keeps lines outside it.
