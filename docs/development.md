# Development

How the checks, the workflows and the local agent setup of this repository work.

## Workflows

- `checks.yml` runs `checks-core`, `app-ui-tests` and `plugin-checks` in parallel; the job `checks` gates all three.
- Every workflow has `permissions: {}` at the top and per job, `timeout-minutes` on every job and a `concurrency` group that cancels superseded pull request runs.
- Every required check runs on pull requests into `main` and on pushes to `main`, except `conventional` (the pull request title) and `dependency-review`, which run on pull requests only, and `check`, which runs on pull requests, the merge queue and weekly.
- The rulesets name the required checks: `checks`, `app (ubuntu-latest)`, `app (macos-latest)`, `app-windows-smoke`, `build`, `check` (the CedarLoom gate of `cedarloom.yml`), `conventional`, `dependency-review`. A job change keeps these names.
- `checks-core`: `actionlint`, `zizmor` (a checkout keeps its credentials only with a `zizmor: ignore[artipacked]` reason), no em dash or emoji in text files outside the `.agents/` and `.claude/` folders and the vendored `packages/packs/bundled/cedarloom.mantine/skills/mantine-form/`, the `.github/scripts/` tests and checks (skill lint, generated docs, version pins, claims).
- Actions are pinned to commit SHAs with a version comment. Dependabot (`.github/dependabot.yml`) updates the `uses:` pins and the npm packages of the site, the app, the CedarLoom workspace at the root (group `mantine` for every `@mantine/*` version update, else group `cedarloom` for minor and patch) and `.github/pnpm` (the pnpm of the CedarLoom CI) weekly. By hand: the actionlint image digest, `node-version` in every workflow, the dev container image and its pnpm (they follow the Node 26 line of `cedarloom.yml` and the pnpm of `.github/pnpm`, and the CI step `Version pins` fails when the Node or the pnpm differs; bump the image's tag and digest together, since the step reads the tag; BenchKeeper's own workflows stay on Node 22), the Claude Code pin of the `plugin-checks` job (`.github/claude-code/package.json` and its lockfile, the npm `stable` tag), and the workspace packages that a peer range ties to each other's version, which move together in one commit: `@mantine/core` with `@mantine/hooks`, `vitest` with `@vitest/coverage-v8`, `commander` with `@commander-js/extra-typings`. Dependabot raises one package at a time, `strictPeerDependencies` (`pnpm-workspace.yaml`) refuses that state, and its run reports `dependency_file_not_resolvable` for each.
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

## Plugin mod types

The plugin's mod (`plugins/benchkeeper/hooks/`: the tier band and the coordinator rotation) is type-checked by hand, not in CI: Claude Code writes the types it imports (`claude-code`, `claude-code/testing`) only when a logged-in session loads the mod, into `plugins/benchkeeper/.claude-plugin/types/` (git-ignored), and no `claude plugin` command writes them.

1. Load the mod once: `claude --plugin-dir plugins/benchkeeper`, then quit the session.
2. In the dev container: `node_modules/.bin/tsc -p plugins/benchkeeper` (the options are the ones the types file names for a hooks module).

The types are those of the Claude Code that loaded the mod, which can be newer than the `plugin-checks` pin.

## Site

`.github/workflows/pages.yml` runs the README sync check, the build, and axe in light and dark. It deploys on pushes to `main`, on a published release and by hand ([releasing](releasing.md#site)); a failing `build` job fails the run and the previous deployment stays. Pushes share one concurrency group, so deployments are ordered.

Preview: `npm run preview` in `web/` in the dev container serves the site under `/BenchKeeper/` on a free host port: `podman port $(podman ps -q --filter label=devcontainer.local_folder="$PWD") 4321`.

## Dev container in VS Code

Set `dev.containers.copyGitConfig` to `false` and `dev.containers.gitCredentialHelperConfigLocation` to `none` in the local user settings (the extension reads them only there), and do not forward the SSH agent.

## Agent config

`.mcp.json` is committed: Claude Code's project MCP servers, `playwright` (a browser in the dev container) and `mantine` (Mantine's docs from mantine.dev, which follow the latest Mantine release: check an answer against the installed `@mantine/core` before using an API it names). `mantine` runs the root devDependency `@mantine/mcp-server` in the dev container, like `playwright`, so code that the container writes into `node_modules` never runs on the host; Dependabot's `mantine` group moves it with the other `@mantine/*` packages, majors included; before merging that pull request, copy `mantine-form` anew (the group's comment in `.github/dependabot.yml`). In an interactive session Claude Code asks before it starts each one ([project scope](https://code.claude.com/docs/en/mcp#project-scope)); a `claude -p` run starts both without asking, unless it passes `--strict-mcp-config` (the MCP scoping row of the [security model](security.md)). The project skills (`.claude/skills/`, `.agents/skills/`), `skills-lock.json` and `.codex/config.toml` are local to each checkout and not tracked. In a new clone:

1. Run the project setup of [setup](setup.md#per-repo) with `--agents claude,codex`. It installs the skills and the lock file and lists them in `.git/info/exclude`.
2. Install the CedarLoom packages in the dev container (`pnpm install --frozen-lockfile`), which `mantine` needs.
3. For Codex, write both servers into `.codex/config.toml` (`[mcp_servers.playwright]` and `[mcp_servers.mantine]`, each with the `command` and `args` of its `.mcp.json` entry).
4. Copy Mantine's `mantine-form` skill, which the `cedarloom.mantine` pack carries at a recorded upstream commit, into both skill folders: `cp -R packages/packs/bundled/cedarloom.mantine/skills/mantine-form .claude/skills/` and the same into `.agents/skills/`. Copy it again after a `@mantine/*` update.
5. Add `/.codex/config.toml`, `/.claude/skills` and `/.agents/skills` to `.git/info/exclude`.

A new worktree (Orca, Claude Code `--worktree`) gets a copy of the paths that `.worktreeinclude` in the primary checkout lists, when Git ignores them there. The project setup of step 1 writes that file with its own list between `# benchkeeper:worktrees` markers and adds `/.worktreeinclude` to `.git/info/exclude`. Add `.codex/config.toml`, `.claude/skills` and `.agents/skills` below the block, one path per line; the setup keeps lines outside it. A worktree's `mantine` server starts once step 2 has run in that worktree.
