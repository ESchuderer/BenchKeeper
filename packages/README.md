# CedarLoom packages

The CedarLoom packages (`@cedarloom/*`), developed in this repository until CedarLoom has its own. They form a pnpm workspace on Node 26 with strict TypeScript 7; the BenchKeeper app (`app/`) and the site (`web/`) stay separate npm projects outside it.

| Command                                           | Runs                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npx pnpm@12.16.1 install`                        | the install (pnpm is pinned in the workflow, not in `package.json`)                                  |
| `pnpm run typecheck`                              | `tsc -b` over every package and its tests                                                            |
| `pnpm run lint`                                   | Oxlint with type-aware rules and the import boundaries of `.oxlintrc.json`                           |
| `pnpm run format`                                 | Biome formatting (`format:check` only reports)                                                       |
| `pnpm run knip`, `pnpm run jscpd`                 | unused files, exports and dependencies; duplicated code                                              |
| `pnpm test`                                       | Vitest with coverage floors in each package, then the root checks in `scripts/`                      |
| `pnpm --filter @cedarloom/contracts run generate` | rewrites the JSON Schema and OpenAPI documents after a schema change; a test fails while they differ |

CI runs these in `.github/workflows/cedarloom.yml` for the changed packages and their dependents; its job `check` is the one result to require. A pull request over 30 files or 1000 changed lines in these paths (lockfile and generated documents excluded) fails until the owner sets the `size-override` label.
