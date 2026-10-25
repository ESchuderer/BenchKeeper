# ECC skills (verification-loop, error-handling, architecture-decision-records; tdd-workflow removed)

[Repository](https://github.com/affaan-m/ECC), Category: skill libraries, Checked 2026-10-25, Decision: Pack `ecc` (owner names ECC) with three skills; `tdd-workflow` removed (issue 151, setup-v6.10)

Three single skills of ECC's `workflow-quality` module (a fourth, `tdd-workflow`, was added in #247 and removed for failing the quality bar), installed without the plugin (`plugins/benchkeeper/library/library.json`, pack `ecc`, added in #247 after the first quality bar check of 50 skills). The ECC bundle itself is evaluated under "ECC" in [EVALUATIONS.md](../../EVALUATIONS.md): no outcome measurement, hook and listing overhead reported.

## Advertised

- No claim per skill. The repository advertises the whole bundle for agent performance optimization, without outcome numbers.

## Independent evidence

- `tdd-workflow`, signals only (6 and 14 tasks, runs per arm not stated), not measurements:
  - One third party, a port to another agent platform: 6 paired tasks, quality +0.20 (scale not given), +21 s and +74k tokens per task. Platform version, model and effort not stated ([discussion #2504](https://github.com/affaan-m/ECC/discussions/2504#discussioncomment-17852942)).
  - [SWE-Skills-Bench, arXiv 2603.15401](https://arxiv.org/abs/2603.15401), as recorded in [studies and sources](../studies.md#cross-tool-findings): a `tdd-workflow` skill whose source is unverified (it may not be this one), Claude Code with Haiku 4.5, 14 tasks, pass rate 21.4% to 28.6%, tokens +78.6%. Version and effort not stated.
- `verification-loop`, `error-handling`, `architecture-decision-records`: none found. Searched on 2026-10-25: the sources to follow in [studies and sources](../studies.md#sources-to-follow) (the skill leaderboard does not list ECC), arXiv (the API, by repository and skill names: no result), then GitHub issues and discussions of the repository (`gh search issues`).

## User reports

- Open issues about `tdd-workflow`: [#3530](https://github.com/affaan-m/ECC/issues/3530) (Step 0 runs `scripts/setup-package-manager.js` relative to the user's project, so it fails when the skill is installed outside the ECC plugin root; the same line is still in `main`), [#3545](https://github.com/affaan-m/ECC/issues/3545) (the detector is missing in a standalone profile), [#3721](https://github.com/affaan-m/ECC/issues/3721) (feedback on timing thresholds).
- Open feedback about `verification-loop`: [#3679](https://github.com/affaan-m/ECC/issues/3679) (distinguish local checks from target-environment acceptance).
- None found for `error-handling` and `architecture-decision-records`.
- The repository is active: not archived, default branch `main`, MIT, pushed 2026-10-25.

## Quality bar check (issue 151, 2026-10-25)

Source [affaan-m/ECC](https://github.com/affaan-m/ECC) at `c05b2d6614f62f6db0047669aa4eefb223d478f9` (2026-10-01). Grading is the one of [library quality bar](library-quality-bar.md): pass, borderline (soft problems, or a reading of the bar the owner decides) or fail (a hard limit broken). Overall is the worst point. Each folder holds only `SKILL.md`; the file is read at the pin.

| Skill | 1 Runs as installed | 2 License | 3 Authoring | 4 Earns its place | 5 Maintained | Overall |
|---|---|---|---|---|---|---|
| `tdd-workflow` | fail | pass | fail | borderline | pass | fail |
| `verification-loop` | borderline | pass | pass | borderline | pass | borderline |
| `error-handling` | pass | pass | pass | pass | pass | pass |
| `architecture-decision-records` | borderline | pass | pass | borderline | pass | borderline |

Measured at the pin:

| Skill | Description characters | `SKILL.md` lines | License | Last folder commit | Effect evidence |
|---|---|---|---|---|---|
| `tdd-workflow` | 294 | 583 | root `LICENSE` MIT, none in folder or frontmatter | 0765f7a (2026-09-27) | signals only: third party n = 6, SWE-Skills-Bench n = 14 (source unverified) |
| `verification-loop` | 306 | 129 | `license: MIT` in frontmatter (`SKILL.md:4`) | 0765f7a (2026-09-27) | none found |
| `error-handling` | 288 | 377 | root `LICENSE` MIT, none in folder or frontmatter | d29cf65 (2026-08-12) | none found |
| `architecture-decision-records` | 318 | 180 | root `LICENSE` MIT, none in folder or frontmatter | 0765f7a (2026-09-27) | none found |

The pin is 24 days old on an active branch, so point 5 passes for all four.

### Fails

- `tdd-workflow`, point 1: Step 0 tells the agent to run `node scripts/setup-package-manager.js --detect` (`SKILL.md:95`), a script of the ECC plugin that the skills CLI does not copy; it also resolves `CLAUDE_PACKAGE_MANAGER` and `.claude/package-manager.json` (`:98`). Step 2 (`:97-102`) falls back to reading `package.json` and the test files, so the skill degrades instead of stopping. Reported upstream as open [#3530](https://github.com/affaan-m/ECC/issues/3530) and [#3545](https://github.com/affaan-m/ECC/issues/3545); `main` has the same line. Owner call: fail on the strict reading (the same rule as `fp-check`), borderline if degradation counts.
- `tdd-workflow`, point 3: 583 lines (`SKILL.md:1-583`) with no reference files, over the limit of 500 lines. Also dated text: `codecov/codecov-action@v3` (`:556`).

### Borderline

- `tdd-workflow`, point 4: the test-first trigger overlaps `tdd` of the Matt Pocock pack, which the own `workflow` skill names for new logic and bug fixes (`plugins/benchkeeper/skills/workflow/software.md:24, 45`). Its only effect evidence is one third-party run with a cost of +21 s and +74k tokens per task.
- `verification-loop`, point 1: the continuous mode ends with `Run: /verify` (`SKILL.md:123`), an ECC command that is not installed; the six phases work without it. It mentions PostToolUse hooks (`:126-129`) but adds none.
- `verification-loop`, point 4: the build, types, lint, tests and diff review pass overlaps the own `workflow` skill's checks step, which runs the project's own build, types, lint and tests (`plugins/benchkeeper/skills/workflow/software.md:57`). Open upstream feedback [#3679](https://github.com/affaan-m/ECC/issues/3679). No effect evidence found.
- `architecture-decision-records`, point 1: the last section names a "Planner agent" and a "Code reviewer agent" (`SKILL.md:177-180`), ECC agents that are not installed. Read-only pointers, the capture and read workflows (`:75-98`) work without them.
- `architecture-decision-records`, point 4: the decision record trigger overlaps `domain-modeling` of the Matt Pocock pack, which the own `workflow` skill names for "new terms or decisions worth a glossary entry or ADR" (`plugins/benchkeeper/skills/workflow/software.md:28`); both write `docs/adr/`. No effect evidence found.

### Pass

- `error-handling`: the file needs nothing outside the folder (no script, command, agent or link), 377 lines, "Use when" in the description, no dated text found. Distinct trigger, no overlap with an own or library skill. Effect evidence: none found, recorded as such.

### Not checked

- No code was run. A root-only license (three of the four skills) is graded pass as for the other sources: the install copies the folder only, so no license text ships with the skill.
- The Matt Pocock `tdd` and `domain-modeling` skills were compared by their descriptions and the own `workflow` skill's references, not read at a pinned commit (the pack installs the plugin, which has no pin in `library.json`).

## Decision

Removed from the library (setup-v6.10, owner decision on [issue 151](https://github.com/ESchuderer/BenchKeeper/issues/151)): `tdd-workflow` fails points 1 and 3 (script outside the folder, 583 lines, open upstream bugs) and is in [library exclusions](library-exclusions.md). Kept: `error-handling` (pass), `verification-loop` and `architecture-decision-records` (borderline, overlap with a skill the user has already chosen).

[All evaluations](../../EVALUATIONS.md)
