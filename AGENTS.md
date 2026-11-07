# AGENTS.md

## Commands

Every command runs in the dev container: start it with `devcontainer up --docker-path podman --workspace-folder .`, then run `devcontainer exec --docker-path podman --workspace-folder . <command>`, compound commands as `... sh -lc '<commands>'`. `devcontainer exec` starts in the repository root and has no working-folder option: run the commands of `app/` and `web/` as `... sh -lc 'cd app && <commands>'`. Git (fetch, commit, push) runs on the host: the container mounts the git metadata read-only.

CedarLoom (the pnpm workspace in `packages/`, from the repository root; details in [packages/README.md](packages/README.md)):
- Install: `pnpm install --frozen-lockfile`
- Types, lint, format, unused code, duplicates: `pnpm run typecheck`, `pnpm run lint`, `pnpm run format` (`pnpm run format:check` only reports), `pnpm run knip`, `pnpm run jscpd`
- Tests: `pnpm test` (every package, then `scripts/*.test.ts`); one package: `pnpm --filter @cedarloom/<package> run test`; the UI in browsers: `pnpm --filter @cedarloom/ui run test:ui`

The legacy BenchKeeper app (in `app/`):
- Install: `npm ci --ignore-scripts`
- Checks and tests: `npm run check:imports`, `npm run check:baselines`, `npm test`, `npm run test:coverage` (prints the coverage), `npm run smoke`; the UI in a browser: `npm run build && npm run test:ui`
- In the dev container 3 app tests fail because of the container ([development](docs/development.md#app-quality-gates)); any other failure is real.

The site (in `web/`): `npm ci`, `npm run build`, `npm test`.

The changed-files check, for each area the change touches:
- `packages/`: `git fetch origin main` on the host, then `pnpm --filter "...[origin/main]" run typecheck && pnpm run lint && pnpm run format:check && pnpm run knip && pnpm run jscpd && pnpm --filter "...[origin/main]" run test`. A change to the root configuration or `scripts/` runs `pnpm run typecheck` and `pnpm test` in full, as CI does. A change to `packages/ui` also runs `pnpm --filter @cedarloom/ui run catalog` (then `git diff --exit-code -- packages/ui/locales packages/ui/schema` on the host) and `pnpm --filter @cedarloom/ui run test:ui`.
- `app/`: `npm run check:imports && npm run check:baselines && npm test`
- `web/`: `npm run build && npm test`
- `plugins/` and `.github/`: the scripts of the `checks-core` job in [checks.yml](.github/workflows/checks.yml) that cover the changed files.
- CI also runs lychee over the Markdown files ([links.yml](.github/workflows/links.yml)) and typos over the CedarLoom files ([cedarloom.yml](.github/workflows/cedarloom.yml)); neither is installed in the container.

## Before you push

- Run the changed-files check after your last edit, right before every push. Never use `--no-verify`.
- Don't poll CI: wait with `gh run watch <run-id> --compact --exit-status` or `gh pr checks --watch`.
- main stays releasable. A red main is fixed before anything else merges.

## Code

- Reuse before reimplementing: before you write new logic, look for code that already does it, and extend or generalize that instead of building a parallel version.
- Don't reinvent the wheel: when a well-maintained open-source package solves the problem (recent releases, a license the project allows, a size that fits), use it instead of writing our own, and name it and the reason in the pull request. A few lines of our own still beat a new dependency.
- Comments only where the code cannot say it: one line, the why, not the how.
- Names: never call a file, folder or module `utils`, `helpers`, `common`, `misc` or `shared`. Name it after what it contains. A file that wants such a name has more than one job: split it.
- UI code follows the styleguide and tokens that Pointers links. No new colors, font sizes, spacing or shadows when a token already covers the role.

## Tests

- Do not add tests by default. Add one only when it fails if your change is reverted, hardcodes its expected values (never computed by production code, locale files or mocks), and runs at the single layer that owns the behavior.
- Never test copy or translations, CSS classes, constants, third-party libraries, private state, timing or call counts. When you touch such a test, delete it instead of updating it.
- There are no coverage thresholds. The legacy app's weekly Stryker runs ([mutation.yml](.github/workflows/mutation.yml)) and their floors stay: they measure test strength, not amount.

## Every change considers

- CedarLoom: macOS, Linux and Windows (its test job runs on all three); the CLI (`packages/cli`), the server (`packages/server`) and the UI (`packages/ui`).
- The legacy app: Linux and macOS, Node.js 22 or newer; Windows only as far as its CI smoke test goes (start, plan, apply) ([app README](app/README.md)).
- Footguns, read before changing that area: [git and child processes](docs/agents/git-and-processes.md).

## Pointers

- [docs/agents/](docs/agents/): [domain docs](docs/agents/domain.md), the [issue policy](docs/agents/issue-tracker.md) (this repository takes no issues), [triage labels](docs/agents/triage-labels.md).
- [Development](docs/development.md): workflows, checks and the dev container. [Security model](docs/security.md) of the legacy app. [Releasing](docs/releasing.md).
- Styleguide and tokens: the Mantine theme of each surface, [packages/ui/src/main.tsx](packages/ui/src/main.tsx) (CedarLoom), [app/ui/App.jsx](app/ui/App.jsx) (the legacy app) and [web/src/components/SiteShell.tsx](web/src/components/SiteShell.tsx) (the site).
- Licenses a dependency may have: the `allow-licenses` list of the dependency review in [cedarloom.yml](.github/workflows/cedarloom.yml).
