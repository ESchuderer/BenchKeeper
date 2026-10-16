# Design

## Tasks

Each task is a step brief with one step (`steps/1.md`), so `bench/run-brief.sh`, `bench/scorer/score.sh` and `bench/scripts/trial.mjs` run and score it as they do `openballistics`: baseline built once per run, a new session, follow-up rule, snapshot `steps/1/repo.tar.gz`, `steps/1/checks.json` and `suite.json`, results in `trial.json` `steps[0]`.

| Task | Phase | What the agent is asked | What the hidden checks measure |
|---|---|---|---|
| `skill-plan-ttl` | plan | Add a time to live to a JSON-file store | The constraints the task does not state, in `docs/ARCHITECTURE.md` and `CONTRIBUTING.md`: injected clock (`S1-ttl`), every read path (`S1-reads`), expiry saved (`S1-persist`), format 1 kept for the CSV export (`S1-format`), old files readable (`S1-old-data`), no dependencies (`S1-no-deps`) |
| `skill-specify-monthly` | specify | Add `monthly(start, count)` | Cases a written specification lists: year end, 30-day months, no drift after a clamped month, leap years 2000, 2028, 2100, machine time zone, invalid input |
| `skill-develop-duration` | develop | Accept `1h30m` everywhere a duration is accepted | The change reaches the parser and the two places that validate before parsing (`config.js`, `cli.js`); invalid input still rejected |
| `skill-test-shipping` | test | Write tests for an untested module, without changing it | The agent's tests pass on the original and fail on each of 6 hidden mutants (one rule changed each); source unchanged |
| `skill-debug-discount` | debug | Bug report that blames the discount arithmetic | Root cause (shared catalog objects): batch totals, two lines of one product (`S1-root`, which the symptom fix fails), arithmetic unchanged, a regression test that fails on the baseline |
| `skill-review-download` | review | Review and fix the last commit (attachment download) | Path traversal including a sibling directory with the root's prefix, crash on a missing file or directory, crash on malformed %-encoding; the commit's own test keeps the feature |
| `skill-ship-release` | ship | Prepare the next release per `RELEASING.md` | Version 2.0.0 (the breaking change is only in a commit footer), versions in sync, changelog section and links, package contents (`files`), annotated tag on a `chore(release)` commit |

Choices:

- Fixtures are committed folders (`repo/`, `commits/<n>/` with `<n>.msg`, `tags`), built into a repository by `skill-common/prepare.sh` in a container without network, fixed author and dates; `baseline.sha` stops a drifting build. No dependencies: `node:test`, so `npm test` and every check run offline.
- `checks/checks.mjs` exports id to check; `skill-common/run.mjs` runs each check in its own process on its own copy of the workspace (one crash or hang fails one check), 120 s each, `/base` holds the baseline. `S1-regressions` is added to every task unless the task sets it to `null`.
- Expected values that depend on the agent's own choices are taken from the workspace (the release version from `package.json`, totals from the agent's `priceCart`), so a mutant fails one check, not every check downstream.
- Validation: `validate.sh` per task with `skill-common/validate-lib.sh`: baseline, reference, mutants (literal replacements, overlays in `mutants/<name>/`, or git commands), each with the exact list of failing checks. A null result counts as failing there, so the reference must make every check checkable.

## Skill toggle

An arm token `<arm>~<skill>` (for example `F~debugging-and-error-recovery`) means arm `<arm>` without that skill. The image is the base arm's; nothing is rebuilt.

1. Runner (`bench/run-brief.sh`): `base=${arm%%~*}`, `off=${arm#*~}` (empty without `~`); image, runtime and `EXPECT` come from `base`; the trial directory is `round-<r>/<arm>`; the container name replaces `~` and `:` with `-` (podman container names allow `[a-zA-Z0-9][a-zA-Z0-9_.-]*`, unverified against the podman documentation; the runner's current names use only those characters). The runner writes `<trial>/without` with the skill name.
2. Removal of user-level skills, in the trial container after `podman run -d ... sleep infinity` and before the first turn: the one folder under `~/.claude/plugins/cache/*/*/*/skills/` (plugins: agent-skills, Superpowers, Matt Pocock, Ponytail) or `~/.claude/skills/` (ECC, BenchKeeper layer) whose `SKILL.md` `name:` is `off`. Exactly one match, else the trial stops before any turn. The container is `--rm`, so the image keeps the skill.
3. Removal of project skills (`.claude/skills/openspec-*`, `speckit-*`, `playwright-best-practices`, OpenCode `.opencode/skills/*`): in the project setup container, after `cp -an ~/project-template/.` and before the `chore: project setup` commit, so the agent's history has no trace of the skill.
4. Not removable by deleting a folder: Superpowers `using-superpowers` and Ponytail's mode are injected by SessionStart hooks, which the audit expects. They are left out of the toggle; their effect is the arm comparison that exists (A against B for Ponytail, A against G for Superpowers). Matt Pocock's `plugin.json` lists skill paths: the entry is removed too (unverified whether Claude Code 2.1.299 starts with a listed path missing).
5. Audit (`bench/scripts/trial.mjs`): with a `without` file, the skill is removed from the expected markers, and the init event listing it is a problem (`still listed <skill>`). That is the proof that the toggle worked; a trial that fails it is excluded like any failed audit. Unverified: that deleting the folder removes the skill from the init event's `skills` list; the first toggled trial checks it before any paired run.

## Paired schedule

- One call per task, framework, model: `bench/run-brief.sh skill-debug-discount claude-sonnet-5-5 high 5 <seed> "F F~debugging-and-error-recovery F~test-driven-development"`. Each round runs the base arm once and each toggled arm once, in the round's shuffled order, so the pairs of a round run close in time on the same baseline commit. The usage gate, arm claims and resume work per token as for any arm.
- The base arm's trial of round r is the "with" trial for every skill toggled in that call; the differences of different skills in one round share it (correlated, reported).
- Cost per task and framework: k x (1 + toggled skills) trials; at k = 5 and 2 skills, 15 trials of 5 to 15 minutes.
- Which skills run on which task: `brief.json` `"skills"` per framework, confirmed by the owner (`phaseOfSkill` puts debugging and shipping skills under "other"). Candidates from `bench/results/2026-10-16-skills-inventory.md`:

| Task | agent-skills | Superpowers | Matt Pocock | ECC | OpenSpec, Spec Kit |
|---|---|---|---|---|---|
| plan | planning-and-task-breakdown, context-engineering | writing-plans | to-tickets, research | plan-canvas, codebase-onboarding | openspec-propose, speckit-plan |
| specify | spec-driven-development, interview-me | brainstorming | grill-me, to-spec, domain-modeling | intent-driven-development | openspec-explore, speckit-specify, speckit-clarify |
| develop | incremental-implementation, source-driven-development | executing-plans, subagent-driven-development | implement | inherit-legacy-style | openspec-apply-change, speckit-implement |
| test | test-driven-development | test-driven-development | tdd | tdd-workflow, ai-regression-testing | |
| debug | debugging-and-error-recovery | systematic-debugging | diagnosing-bugs | error-handling | |
| review | code-review-and-quality, security-and-hardening | requesting-code-review | code-review | production-audit | ponytail-review, ponytail-audit (Ponytail) |
| ship | shipping-and-launch, git-workflow-and-versioning | finishing-a-development-branch, verification-before-completion | pr | delivery-gate, git-workflow | |

## Rating (#36)

Per skill and task, from the k pairs (round r: with = base arm, without = toggled arm):

- Effect: checks passed with minus without (`steps[0].passed`), paired median and range; `suite_ok` and audit as gates (a pair with a failed audit is dropped and counted).
- Fired: in how many "with" trials the skill was called (`workflow.skills`). A skill that never fired is "not triggered", not "no effect"; it goes to the trigger evals (step 3), not to the effect rating.
- Cost and minutes added: paired median of with minus without (`cost_usd_api_equivalent`, `minutes`), and the 5-hour share when one runner ran alone.
- Gates: `waited`, `followups`, `ask_user_calls` with against without.
- Recommendation, for #37: keep when the median effect is above 0 and the skill fired in most "with" trials; change when it did not fire (description or trigger); drop when the effect is 0 or below and it adds cost. Confidence low at k = 5 with 4 to 8 checks per task; no significance tests.

## Open questions for the owner

- Frameworks and models for the paired runs (all seven frameworks, or the finalist candidates only; Sonnet 5.5 only).
- The skill list per task (table above).
- The ceiling: the pilot (arm A, k = 1) may show that plain Sonnet passes every check of a task; such a task is made harder or dropped before the paired runs.
