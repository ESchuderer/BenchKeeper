# Tools per stack

Deterministic tools first, your reading second: a tool names a candidate, you decide it. Run commands where the repository's `AGENTS.md` runs `node`, `python` or `cargo`. Install into a scratch folder outside the repository (`npm i --prefix <scratch> --ignore-scripts <pkg>@<version>`, then call `<scratch>/node_modules/.bin/<tool>` from the project root), so the tree stays clean. Every tool name below is a candidate list; skip a tool the repository's own scripts already run.

Versions are the newest release at least 7 days old on 2026-10-26; this skill proposes their bumps like any other pin.

## JavaScript and TypeScript

| Tool | Finds | Command | Notes |
|---|---|---|---|
| `knip@6.42.0` (ISC) | unused files, exports, dependencies | `knip --no-progress --reporter json` | 1 s. An export no other file imports is a candidate, not dead code: a package's public API or a script run by hand (listed in `AGENTS.md`) is a false positive. Confirm with a search for the name |
| `jscpd@5.4.1` (MIT) | duplicated code | `jscpd src --format javascript,jsx,typescript,tsx --min-lines 8 --min-tokens 70 --reporters json` | 0.1 s. Name the code formats: without `--format` it reports JSON and schema files copied from upstream. A 4-line clone needs `--min-lines 3` |
| `dependency-cruiser@18.6.0` (MIT) | cycles, orphans | `depcruise src --config <rules.cjs> --output-type err` | The rules file holds `forbidden: [{ name: 'no-circular', severity: 'error', from: {}, to: { circular: true } }, { name: 'no-orphans', severity: 'warn', from: { orphan: true, pathNot: ['\\.d\\.ts$'] }, to: {} }]` and `options.includeOnly` for the source folders. An entry point the tool cannot see (a script run by hand) shows as an orphan: confirm it before reporting With `--no-config` it checks no rule and prints "no violations" |
| `@stryker-mutator/core@10.0.0` (Apache-2.0) | tests that cannot fail | [test-audit.md](test-audit.md) | minutes per module |

## Python and Rust

Not run in the spike that wrote this skill: install, run time and false-positive rate are unverified, so every finding is a candidate to confirm by search.

| Stack | Dead code | Dependencies | Cycles and layers | Mutation |
|---|---|---|---|---|
| Python | `vulture==2.16` (MIT) | `deptry==0.25.1` (MIT) | `import-linter==2.15` (BSD-2-Clause) | `mutmut==3.8.0` (BSD-3-Clause) or `cosmic-ray==8.7.0` (MIT) |
| Rust | the compiler's `dead_code` and `unused` lints | `cargo-machete@0.9.2` (MIT) or `cargo-udeps@0.1.61` (MIT OR Apache-2.0) | `cargo tree --duplicates` for duplicate crates; cargo rejects cycles between crates, not between modules of one crate | `cargo-mutants@27.1.0` (MIT) |

Other stacks: the language's own unused-code lint, the package manager's dependency audit, and the reference search below.

## Reference search

Before any deletion: search the name across code, tests, docs, scripts, CI and config (`git grep -nw -- <name>`), also its string forms (dynamic imports, registry keys, CLI flags). Record the search and its count with the finding.

## Sources

[knip](https://knip.dev/overview/configuration), [jscpd](https://github.com/kucherenko/jscpd), [dependency-cruiser rules](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md), [StrykerJS](https://stryker-mutator.io/docs/stryker-js/configuration/). Versions and licenses: the package registries ([npm](https://registry.npmjs.org/), [PyPI](https://pypi.org/), [crates.io](https://crates.io/)).
