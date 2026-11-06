# CedarLoom packages

The CedarLoom packages (`@cedarloom/*`), developed in this repository until CedarLoom has its own. They form a pnpm workspace on Node 26 with strict TypeScript 7; the BenchKeeper app (`app/`) and the site (`web/`) stay separate npm projects outside it. The commands below need pnpm 12.16.1 on the `PATH` (`npm install -g pnpm@12.16.1`); `package.json` names no `packageManager`, because GitHub's dependency graph does not read the lockfile that field produces.

| Command                                           | Runs                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm install`                                    | the install                                                                                          |
| `pnpm run typecheck`                              | `tsc -b` over every package and its tests                                                            |
| `pnpm run lint`                                   | Oxlint with type-aware rules and the import boundaries of `.oxlintrc.json`                           |
| `pnpm run format`                                 | Biome formatting (`format:check` only reports)                                                       |
| `pnpm run knip`, `pnpm run jscpd`                 | unused files, exports and dependencies; duplicated code                                              |
| `pnpm test`                                       | Vitest with a coverage report in each package, then the root checks in `scripts/`                    |
| `pnpm --filter @cedarloom/contracts run generate` | rewrites the JSON Schema and OpenAPI documents after a schema change; a test fails while they differ |

CI runs these in `.github/workflows/cedarloom.yml` for the changed packages and their dependents; its job `check` is the one result to require. A pull request over 30 files or 1000 changed lines in these paths (lockfile and generated documents excluded) fails until the owner sets the `size-override` label.
