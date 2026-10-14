# Benchmark protocol

Version 0.5, 2026-10-14 (0.5: follow-up rule; rules with the non-interactive phase fix (`fix/headless-phases`). 0.4: 8 arms, each framework alone (F, G, H) and with the BenchKeeper layer (C, D, E), project setup for all three. 0.2: rules loading checked by a probe instead of the debug log, which does not show it; parser takes tokens from cumulative model usage. 0.3: arm C starts from a project set up by `/project-setup`, BenchKeeper's real-world case). Covers the winery pre-screen only; the held-out task track is still the draft in [#19](https://github.com/ESchuderer/BenchKeeper/issues/19) and gets its own version here before its first run. Changes after a run starts need a new version; reports link the version they used.

## Pre-screen: winery brief on Claude Opus 5.5

Purpose: show, before the Sonnet run, whether every arm installs, passes the delivery audit and builds a working app headless, and what each stack's workflow does unprompted. Practice only: no drop rule (all arms stay in later runs), no conclusions for other models, not one of the reported briefs.

### Arms

Built by `bench/image/Containerfile` and `bench/image/install-arm.sh` from pinned tags; every image: `node:22.23.3-bookworm-slim` (digest in the Containerfile), Claude Code 2.1.299, auto-update off, a no-op status line.

| Arm | Rules (`~/.claude/rules/00-global.md`) | Components |
|---|---|---|
| A | none | stock Claude Code |
| B | none | Ponytail v5.2.0 plugin, `full` |
| F | none | agent-skills 0.6.13 plugin |
| G | none | Superpowers v7.0.0 plugin |
| H | none (ECC's own rules in `~/.claude/rules/ecc/`) | ECC v2.2.3 `minimal` profile (`npx ecc-universal@2.2.3 install --profile minimal --target claude`) |
| C | `rules/global.md` | agent-skills 0.6.13 + BenchKeeper layer |
| D | `bench/arms/base.rules.md` | Superpowers v7.0.0 + BenchKeeper layer |
| E | `bench/arms/base.rules.md` | ECC v2.2.3 `minimal` + BenchKeeper layer |

BenchKeeper layer: Ponytail v5.2.0 `full`, find-skills (vercel-labs/skills v1.7.2), BenchKeeper skills `project-setup` and `global-setup`, OpenSpec CLI 1.14.1, Playwright MCP 0.0.83 with Chromium, and the project workspace below.

The workspace of arms C, D and E starts as `/project-setup` leaves a new Node.js 22 web app, committed as the first commit (`bench/arms/project-setup/`): `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`), devcontainer config, OpenSpec (`openspec init --tools claude`), the `playwright-best-practices` skill (currents-dev), and Playwright MCP 0.0.83 with Chromium inside the container, approved for the project. Arms A, B, F, G and H have no project setup step and start from an empty workspace.

Base rules: `rules/global.md` without "Ponytail and agent-skills", "Branches, issues and pull requests", "Task tiers" and "SDLC" (`bench/scripts/arm-rules.mjs`), so D and E run their framework's own workflow. Settings from `/global-setup` part 7 (advisor, attribution, telemetry) are not applied in any arm.

### Task

- Prompt: `bench/briefs/winery/brief.md`, passed unchanged to every arm as the only user message; the workspace starts empty.
- Hidden tests: `bench/briefs/winery/hidden/`, one Playwright test per required feature (F1 to F6), roles and visible text from the brief only. Each feature makes its own bookings and compares seat counts with what it read, so one failing feature does not fail or skip another; a feature passes only when its test ran and passed.
- Test validation (`bench/briefs/winery/validate.sh`): the reference app `bench/briefs/winery/reference/` and a correct variant with other markup (table, guests dropdown, cancelled bookings kept, bound to `localhost`) pass all six; four mutants (capacity check removed, staff page open, cancel ignored, email unchecked) each fail exactly their feature while the other five pass. Result 2026-10-14: all as expected.

### Run

- Model `claude-opus-5-5`, effort `high` (to be confirmed by the owner before the run), all 8 arms, `--dangerously-skip-permissions` inside the container, stream-json with hook events, debug log.
- k=3 rounds (24 trials); each round runs all 8 arms in an order shuffled with seed 19 (`bench/run-brief.sh`, order logged in `manifest.txt`); one trial at a time; timeout 90 minutes per trial (podman `--timeout 5400`). A resumed run never repeats a finished agent run and refuses to continue when an arm image changed.
- Sandbox: the agent container mounts only its empty workspace and a log directory; `bench/`, the hidden tests and other repositories are never mounted. Network is on (package installs).
- Credentials: the owner's Max subscription through `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`), read from the environment or `~/.config/benchkeeper/oauth-token`, never written to results. After each trial the runner searches the trial directory for the token and stops if it finds it.
- Follow-up rule: when the agent ends a turn and the workspace has no `package.json` with a `start` script, the runner continues the same session with the fixed message "Continue until the brief is fully implemented and npm start runs the app. Do not wait for approval.", at most twice, within the trial's 90 minutes. The number of follow-ups is recorded per trial; finishing without one is reported separately.
- Command: `bench/run-brief.sh winery claude-opus-5-5 high 3 19`.

### Stage 0 before the paid trials

One trial per arm on `claude-haiku-5-5` (subscription), same scripts: delivery audit passes for all arms, a probe per image (list the headings of the loaded `~/.claude/rules/` files, no tools) shows the expected rules for each arm, the scorer runs on agent output. Its results are wiring checks only.

### Autonomous variant (practice)

`bench/briefs/winery-autonomous/`: the same brief plus "Work autonomously until the app is complete and running; do not stop to ask for approval."; same hidden tests. Practice only.

### Prompted variant (practice)

`bench/briefs/winery-workflow/`: the same brief plus one closing paragraph asking every arm to use its configured development process, skills, agents and plugins in each phase; same hidden tests. Shows what each stack does when asked for its workflow, next to the unprompted brief. Practice only, Haiku 5.5 first.

### Scoring (`bench/scorer/score.sh`, `bench/scripts/trial.mjs`)

Per trial, in a copy of the workspace, in pinned containers:
- `npm install`, `npm run build --if-present`, `npm start` with `PORT` and a random `STAFF_PASSWORD`;
- hidden features passed (of 6); axe violations (WCAG 2.2 AA tags) on start, form, confirmation and staff pages; Lighthouse performance, accessibility and best practices on the start page; `npm audit` counts; the agent's own `npm test` exit code (in the node base image without browsers);
- non-blank source and test lines;
- wall-clock minutes; from the transcript: turns, tokens, API-equivalent USD (`total_cost_usd`; not billed), whether the run ended with a question;
- captured for manual comparison: the built app as delivered (`app.tar.gz`: source and git history, without `node_modules`) and full-page screenshots of the start, form, confirmation and staff pages;
- workflow trace: Skill and Agent calls, plan or spec files written, tests written and whether before the first source file, whether a review step ran, the last tool call.

### Validity

- Delivery audit (`trial.mjs`): the init event lists exactly the arm's plugins, marker skills or agents and connected MCP servers (C, D, E: `playwright`; others: none), none of another arm's markers, and the expected SessionStart hook output; arm A shows none. A failed audit invalidates the trial.
- A trial stopped by a usage limit, API overload or an authentication failure is an infrastructure error: rerun once (delete its directory and rerun the command), then listed as excluded.
- Every trial is reported, including stalls, trials without code and invalid ones.

### Report

`bench/results/2026-10-winery-prescreen.md`: setup (versions, image IDs, model, effort, seed, order), the data copied by `bench/publish.sh` (manifest, per trial `trial.json`, transcript, `app.tar.gz`, screenshots), the per-arm table from `bench/scripts/summary.mjs` (median and range over 3 trials, no significance tests), per-trial workflow traces, exclusions, deviations from this protocol, subscription usage read before and after.

### Limitations

- One brief, k=3: descriptive only; differences between arms are anecdotal.
- Whole-stack arms: workflow traces show what co-occurs with better scores, not what causes it.
- Effects change by model; Opus results say nothing about Sonnet.
- Exact labels in the brief favor arms that follow the copy literally; all arms get the same brief.
- `tests_first` compares the first test file write with the first source file write; test code inside source files and files created through shell commands (heredocs, scaffolders) are not detected.
- The agent's own browser tests fail in the scorer's node image; their exit code is informational.
