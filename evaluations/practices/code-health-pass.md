# Code health pass in `maintaining-repos`

Category: practices, Checked 2026-10-26, Decision: In, measured on one project

## Advertised

Nothing advertised: the pass is BenchKeeper's own (issue [#274](https://github.com/ESchuderer/BenchKeeper/issues/274)). It adds cleanup tools, architecture checks and a test audit by mutation testing to the user-started `maintaining-repos` skill, as three files read only when their part runs. Tool claims below come from the package registries ([npm](https://registry.npmjs.org/), [PyPI](https://pypi.org/), [crates.io](https://crates.io/)) and the tools' own documentation, linked per row.

## Measured

Project: BenchKeeper `app/` at commit d836cc5 (62 modules, 6,116 lines in `src/`, 384 tests, suite 6.9 s), in the dev container, tools in a scratch prefix, newest release at least 7 days old on 2026-10-26. One run per tool, so the times are single measurements, not a spread.

| Tool | Version, license | Run | Findings | After reading |
|---|---|---|---|---|
| [knip](https://knip.dev/overview/configuration) | 6.42.0, ISC | 0.6 s | 45 (1 file, 44 exports) | 1 dead function, 43 exports no other file imports, 1 false positive (a script run by hand) |
| [jscpd](https://github.com/kucherenko/jscpd) | 5.4.1, MIT | 0.09 s | 7 clones, all in copied JSON | with `--format javascript,jsx`: 0 clones |
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) | 18.6.0, MIT | 1.4 s | 2 cycles, with a `no-circular` rule | both real; without a rule it checks nothing |
| madge | 8.0.0, MIT | 1.3 s | same 2 cycles | 0 files processed without `--extensions mjs`, a silent false negative; not used |
| [StrykerJS](https://stryker-mutator.io/docs/stryker-js/configuration/) command runner | 10.0.0, Apache-2.0 | 177 s and 340 s | `diff.mjs` 237 mutants, score 81.43 %; `merge.mjs` 544 mutants, score 66.36 % | survivors read for the most populated lines: equivalent, one unreachable branch, real gaps |

Bounds that came from the runs: the first mutation run was killed by the system's memory guard (a mutant looped and used swap; the container had no memory limit); with a memory cap, `--max-old-space-size=256`, a 6 s mutant timeout and concurrency 4 both runs finished. Cost is 0.6 to 0.75 s per mutant, about 20,000 mutants for all of `src/` by the ratio of the two modules (estimate): hours, so a pass runs one module at a time. `node --test` has no Stryker plugin; a kill is not attributed to a single test, so a test is removed only when the module's score is unchanged without it.

Planted-problem fixture (6 modules, scratch): knip found the dead export; jscpd found the duplicate only with `--min-lines 3`; every mutant of two assertion-free tests survived; the forwarding layer and a stale README claim were found by no tool. Tests passed before and after, nothing was changed.

Skill shape: `disable-model-invocation: true` keeps the description out of context in Claude Code ([skills](https://code.claude.com/docs/en/skills)); for Codex `allow_implicit_invocation: false` stops prompt matching ([build skills](https://learn.chatgpt.com/docs/build-skills)), and whether the description then stays in the startup list is unverified. One skill with disclosed files therefore costs nothing at startup in Claude Code, and the owner's options B and C were not drafted.

## Not measured

- Python and Rust tools (vulture 2.16, deptry 0.25.1, import-linter 2.15, mutmut 3.8.0, cosmic-ray 8.7.0, cargo-machete 0.9.2, cargo-udeps 0.1.61, cargo-mutants 27.1.0): versions and licenses only, install, run time and false-positive rate unverified.
- `ponytail:ponytail-audit`, `ponytail:ponytail-debt`, `/doctor prompt-audit`, `/skill-doctor`: not run (interactive sessions on the subscription).
- Findings kept against rejected across projects, a second project, and agent time and tokens of a whole pass: not run.
- The new eval set `skill-maintaining-repos` (should-not-load cases only, because the skill never loads by itself): written, not run (`benchkeeper evals run` starts headless agent sessions).
- The local verdict store of the issue's knowledge-base design: a scratch spike only (44 of 44 findings skipped on an unchanged tree, exactly the 7 findings of a changed file re-checked, a tampered file ignored); not built, and the saving in agent tokens is unmeasured.

## Decision

In, as parts of the user-started `maintaining-repos`. The entry changes to "out" for a part whose tool findings are rejected in most reviews on later projects.

[All evaluations](../../EVALUATIONS.md)
