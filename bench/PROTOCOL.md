# Benchmark protocol

Version 1.4, 2026-10-15 (1.4: maintainability, judged from the repository, in the app review (criterion 9) and as automated facts in `trial.json`; the review keeps maintainer-facing files (CI config, docs, ADRs, living specs). 1.3: per-phase and per-subagent measurements for runs started with `PHASES=1` (Sonnet onward; the Haiku run has none); baselines AB (OpenSpec alone) and AC (Spec Kit alone); usage gate at 70% (owner decision, three runners in parallel), read from `bench/usage-max`. 1.2: the follow-up rule checks that the app runs (`npm install`, `npm run build --if-present`, `npm start` serves the start page within 20 s), not only that a start script exists; a usage gate waits for the 5-hour window to reset at 80% or more before a Claude Code trial; Matt Pocock arms V to Y, Z, AA. 1.1: OpenCode arms Q to U, see `bench/SCENARIOS.md`; Haiku and Sonnet once each for all arms, Opus by owner decision after the costs are known. 1.0: 16 arms (each skill framework alone, with OpenSpec, with the BenchKeeper layer, with both; Ponytail with OpenSpec or Spec Kit); the React brief asks every arm for its configured process; all earlier results removed by owner decision; Haiku first for all arms, Sonnet after the owner confirms. Earlier versions: see the git history of this file.)

## Pre-screen: React winery brief on Claude Haiku 5.5, then Sonnet 5.5

Purpose: show whether every arm installs, passes the delivery audit and builds a working app headless when asked to use its configured process, and what each stack's process and app look like. Practice: no drop rule, not one of the reported briefs.

### Arms

| Arm | Skill framework | Ponytail | BenchKeeper layer | Spec tool |
|---|---|---|---|---|
| A | none | no | no | none |
| B | none | yes | no | none |
| F | agent-skills 0.6.13 | no | no | none |
| G | Superpowers v7.0.0 | no | no | none |
| H | ECC v2.2.3 `minimal` | no | no | none |
| I | agent-skills | no | no | OpenSpec 1.14.1 |
| J | Superpowers | no | no | OpenSpec |
| K | ECC | no | no | OpenSpec |
| L | agent-skills | yes | yes | none |
| M | Superpowers | yes | yes | none |
| N | ECC | yes | yes | none |
| C | agent-skills | yes | yes | OpenSpec |
| D | Superpowers | yes | yes | OpenSpec |
| E | ECC | yes | yes | OpenSpec |
| O | none | yes | no | OpenSpec |
| P | none | yes | no | Spec Kit v1.2.0 (`specify-cli`, uv 0.13.1) |

OpenCode arms (owner decision 2026-10-14; details, isolation and the comparison matrix in `bench/SCENARIOS.md`): Q `opencode-openspec-targeted-skills`, R `opencode-superpowers`, S `opencode-openspec-superpowers` (oso 1.1.1), T `opencode-addy`, U `opencode-addy-openspec`, on OpenCode 1.19.0 with an Anthropic API key (OpenCode cannot use the subscription), same model, effort, brief, timeout, follow-up rule, scorer and review as the Claude Code arms.

Owner decision 2026-10-14: each skill framework runs alone, with OpenSpec, with the BenchKeeper layer, and with both; C is BenchKeeper as it is today (agent-skills with OpenSpec); O and P are basic checks of a spec tool with Ponytail alone.

BenchKeeper layer: rules (agent-skills: `rules/global.md`; Superpowers and ECC: `bench/arms/superpowers.rules.md` and `ecc.rules.md`, the same rules with the SDLC and the lines naming agent-skills mapped to the framework's own skills and agents, from `bench/arms/superpowers.md` and `ecc.md`), the candidate rules `bench/arms/candidate.rules.md`, Ponytail v5.2.0 `full`, find-skills (vercel-labs/skills v1.7.2), BenchKeeper skills `project-setup` and `global-setup`, Playwright MCP 0.0.83 with Chromium inside the container, and a project set up by `/project-setup` (`bench/arms/project-setup/`: `AGENTS.md`, `CLAUDE.md` with `@AGENTS.md`, devcontainer config, the `playwright-best-practices` skill at commit `283d5cb`, the MCP server approved for the project; with OpenSpec, `openspec init --tools claude` and the convention line in `AGENTS.md`).

Spec tool without the BenchKeeper layer (I, J, K, O, P): the project is only initialised with the tool (`openspec init --tools claude`, or `specify init --here --integration claude --script sh`). Arms with a project start from it as the first commit; the others start from an empty folder.

Candidate rules (benchmark-only, owner decision 2026-10-14, not part of `rules/global.md`): keep headless runs going through the phases a tier requires, including the OpenSpec propose-then-apply step, without granting approvals required elsewhere; sign-in basics (session expiry, sign-out, attempt limit, cookie flags). Look and feel belongs in the brief.

Built by `bench/image/Containerfile` and `bench/image/install-arm.sh` (one arm table shared with `bench/scripts/trial.mjs`); every image: `node:22.23.3-bookworm-slim` (digest in the Containerfile), Claude Code 2.1.299, auto-update off, a no-op status line; settings from `/global-setup` part 7 (advisor, attribution, telemetry) are not applied in any arm.

### Task

- Prompt: `bench/briefs/winery-react/brief.md`, passed unchanged to every arm as the only user message. It states the product, look and feel, React with established frameworks and libraries, the run contract, and a closing process paragraph asking every arm to use its installed skills, agents, plugins and spec tool in each phase and to follow its rules. The earlier `winery`, `winery-workflow` and `winery-autonomous` briefs are kept for the record; their results were removed by owner decision.
- Hidden tests: `bench/briefs/winery/hidden/`, one Playwright test per required feature (F1 to F6), roles and visible text from the brief only. Each feature makes its own bookings and compares seat counts with what it read, so one failing feature does not fail or skip another; a feature passes only when its test ran and passed.
- Test validation (`bench/briefs/winery/validate.sh`): the reference app `bench/briefs/winery/reference/` and a correct variant with other markup (table, guests dropdown, cancelled bookings kept, bound to `localhost`) pass all six; four mutants (capacity check removed, staff page open, cancel ignored, email unchecked) each fail exactly their feature while the other five pass. Result 2026-10-14: all as expected. React brief: `bench/briefs/winery-react/validate.sh` with the React single-page reference `bench/briefs/winery-react/reference/` (Express, React, Vite) and the same four mutants. The tests wait for network requests to settle after each submit, so asynchronous single-page apps cannot slip a booking past a check.

### Run

- Models `claude-haiku-5-5` and `claude-sonnet-5-5`, one round each for all Claude Code arms (both runs in parallel), then the OpenCode arms on both models; Opus 5.5 only if the owner decides after seeing the costs; effort `high`; one trial at a time per run; Claude Code with `--dangerously-skip-permissions`, stream-json with hook events and a debug log; OpenCode with `--auto` and `--format json`.
- One round of all 16 arms in an order shuffled with the seed (`bench/run-brief.sh`, order logged in `manifest.txt`); one trial at a time; timeout 90 minutes per trial, shared by all turns (each turn gets the remaining time). A resumed run never repeats a finished agent run and refuses to continue when an arm image changed.
- Sandbox: the agent container mounts only its empty workspace and a log directory; `bench/`, the hidden tests and other repositories are never mounted. Network is on (package installs).
- Credentials: Claude Code arms use the owner's Max subscription through `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`, environment or `~/.config/benchkeeper/oauth-token`); OpenCode arms use an Anthropic API key (`ANTHROPIC_API_KEY` or `~/.config/benchkeeper/anthropic-api-key`); each container gets only its runtime's credential; never written to results. After each trial the runner searches the trial directory for the token and stops if it finds it.
- Follow-up rule: when the agent ends a turn and the app does not run (a `start` script, and `npm install`, `npm run build --if-present` and `npm start` serve the start page within 20 s, checked in the agent's container), the runner continues the same session with the fixed message "Continue until the brief is fully implemented and npm start runs the app. Do not wait for approval.", at most twice, within the trial's 90 minutes. The number of follow-ups is recorded per trial; finishing without one is reported separately.
- Commands: `bench/run-brief.sh winery-react claude-haiku-5-5 high 1 41` and `bench/run-brief.sh winery-react claude-sonnet-5-5 high 1 41` (arms A to P); the OpenCode arms with the same commands and arms `"Q R S T U"`.

### Checks before a run

Before each run: every image builds, and an unauthenticated start shows the arm's plugins, markers and MCP servers (the delivery audit on the recorded fixtures, `bench/scripts/fixtures/`); for arms with BenchKeeper rules, a probe per image (list the headings of the loaded `~/.claude/rules/` files, no tools) shows the expected rules.

### Scoring (`bench/scorer/score.sh`, `bench/scripts/trial.mjs`)

Per trial, in a copy of the workspace, in pinned containers:
- `npm install`, `npm run build --if-present`, `npm start` with `PORT` and a random `STAFF_PASSWORD`;
- hidden features passed (of 6); axe violations (WCAG 2.2 AA tags) on start, form, confirmation and staff pages; Lighthouse performance, accessibility and best practices on the start page; `npm audit` counts; the agent's own `npm test` exit code (in the node base image without browsers);
- non-blank source and test lines;
- maintenance facts from the workspace (`maintenance` in `trial.json`): README, README with install and start steps, lockfile, test script, lint or type-check script, CI workflow, pinned Node version, changelog, docs or specs;
- wall-clock minutes; from the transcript (last result per session, since follow-up turns continue the session and its totals are cumulative): turns, tokens, API-equivalent USD (`total_cost_usd`; not billed), whether the run ended with a question;
- captured for manual comparison: the built app as delivered (`app.tar.gz`: source and git history, without `node_modules`) and full-page screenshots of the start, form, confirmation and staff pages;
- workflow trace: Skill and Agent calls, plan or spec files written, tests written and whether before the first source file, whether a review step ran, the last tool call.

### Per-phase measurements (`bench/scripts/phases.mjs`, runs with `PHASES=1`)

Each model call is assigned a phase from what it does, independent of skill names: spec (writes to spec, plan, design, proposal, tasks or ADR files; skills like brainstorm, grill, propose, plan), test (writes to test files; TDD skills), build (other writes; install and build commands; apply and implement skills), verify (test, lint and type-check commands, Playwright MCP; verification skills), review (review and security agents and skills); calls that only read keep the previous phase. Per phase and per subagent type: calls, minutes and cost. Claude Code: cost is the trial total split by each call's token weight (input 1, cache write 1.25, cache read 0.1, output 5, output estimated from content length), time from the event timestamps; OpenCode: cost and time per message as reported. Observational and approximate: it shows where time and cost go, not what causes quality.

### App review (`bench/review/`)

Each built app is reviewed blind by Claude Opus 5.5 (effort `high`) with the fixed prompt `bench/review/app-review.md` and schema `bench/review/schema.json`: headless in the stock arm-A image, read-only, tools limited to Read, Glob and Grep; inputs are the brief, the app source filtered inside a container (kept: code, tests, build and CI configuration, README, docs, ADRs and living specs in `openspec/specs` or `specs/`, which a later maintainer reads; removed: dependencies, agent tooling and process files such as `.claude`, `.opencode`, `.specify`, `.mcp.json`, the project-setup devcontainer, `AGENTS.md`, `CLAUDE.md`, skills locks, `openspec/changes`, `.scratch`, `docs/superpowers`, `docs/agents`, `.git`) and the four screenshots; no hidden-test scores. The reviewer image ID is recorded in `review.json`. Known leaks: code-level traces such as Ponytail's `shortcut:` comments or a framework's coding style, and kept specs or ADRs, can hint at the arm; specs and ADRs stay because they are maintenance documentation. Nine criteria rated 1 to 5 with evidence (requirements, correctness, security, code quality, tests, UX and design, accessibility, simplicity, maintainability: could a developer pick the app up again later from the repository alone: setup instructions, regression tests, build and CI, release approach, documentation, pinned versions), an overall rating from 1 to 10, strengths, issues and a verdict (`review.json` per trial). A model judge is a signal with known biases (for example toward longer or more polished output), reported next to the automated scores, never instead of them.

### Validity

- Delivery audit (`trial.mjs`): every init event (first turn, follow-ups, resumes after a background agent) lists exactly the arm's plugins, marker skills or agents and connected MCP servers (BenchKeeper layer: `playwright`; others: none), none of another arm's markers, and the session's first turn (`SessionStart:startup`) shows the expected hook output (a follow-up resumes the session, and Superpowers' hook does not fire on resume); arms without hooks show none. A failed audit invalidates the trial.
- A trial stopped by a usage limit, API overload or an authentication failure is an infrastructure error: rerun once (delete its directory and rerun the command), then listed as excluded.
- Every trial is reported, including stalls, trials without code and invalid ones.

### Report

`bench/results/<date>-<brief>-<model>.md`: setup (versions, image IDs, model, effort, seed, order), the data copied by `bench/publish.sh` (manifest, per trial `trial.json`, transcript, `app.tar.gz`, screenshots), the per-arm table from `bench/scripts/summary.mjs` (median and range over 3 trials, no significance tests), per-trial workflow traces, exclusions, deviations from this protocol, subscription usage read before and after.

### Limitations

- One brief, one trial per arm and model: descriptive only; differences between arms are anecdotal.
- Whole-stack arms: workflow traces show what co-occurs with better scores, not what causes it.
- Effects change by model; Haiku results say little about Sonnet.
- The process paragraph in the brief asks every arm for its process; results describe prompted behavior, not what an unprompted request gets.
- Exact labels in the brief favor arms that follow the copy literally; all arms get the same brief.
- `tests_first` compares the first test file write with the first source file write; test code inside source files and files created through shell commands (heredocs, scaffolders) are not detected.
- The agent's own browser tests fail in the scorer's node image; their exit code is informational.
