# Benchmark protocol

Version 0.1, 2026-10-14. Covers the winery pre-screen only; the held-out task track is still the draft in [#19](https://github.com/ESchuderer/BenchKeeper/issues/19) and gets its own version here before its first run. Changes after a run starts need a new version; reports link the version they used.

## Pre-screen: winery brief on Claude Opus 5.5

Purpose: show, before the Sonnet run, whether every arm installs, passes the delivery audit and builds a working app headless, and what each stack's workflow does unprompted. Practice only: no drop rule (all 5 arms stay in later runs), no conclusions for other models, not one of the reported briefs.

### Arms

Built by `bench/image/Containerfile` and `bench/image/install-arm.sh` from pinned tags; every image: `node:22.23.3-bookworm-slim` (digest in the Containerfile), Claude Code 2.1.299, auto-update off, a no-op status line.

| Arm | Rules (`~/.claude/rules/00-global.md`) | Components |
|---|---|---|
| A | none | stock Claude Code |
| B | none | Ponytail v5.2.0 plugin, `full` |
| C | `rules/global.md` | Ponytail v5.2.0, agent-skills 0.6.13 plugin, find-skills (vercel-labs/skills v1.7.2), BenchKeeper skills `project-setup`, `global-setup` |
| D | `bench/arms/base.rules.md` | Ponytail v5.2.0, Superpowers v7.0.0 plugin, find-skills, BenchKeeper skills |
| E | `bench/arms/base.rules.md` | Ponytail v5.2.0, ECC v2.2.3 `minimal` profile (`npx ecc-universal@2.2.3 install --profile minimal --target claude`), find-skills, BenchKeeper skills |

Base rules: `rules/global.md` without "Ponytail and agent-skills", "Branches, issues and pull requests", "Task tiers" and "SDLC" (`bench/scripts/arm-rules.mjs`), so D and E run their framework's own workflow. Settings from `/global-setup` part 7 (advisor, attribution, telemetry) are not applied in any arm.

### Task

- Prompt: `bench/briefs/winery/brief.md`, passed unchanged to every arm as the only user message; the workspace starts empty.
- Hidden tests: `bench/briefs/winery/hidden/`, one Playwright test per required feature (F1 to F6), roles and visible text from the brief only.
- Test validation (`bench/briefs/winery/validate.sh`): the reference app `bench/briefs/winery/reference/` passes all six; four mutants (capacity check removed, staff page open, cancel ignored, email unchecked) each fail exactly their feature. Result 2026-10-14: all as expected.

### Run

- Model `claude-opus-5-5`, effort `high` (to be confirmed by the owner before the run), `--dangerously-skip-permissions` inside the container, stream-json with hook events, debug log.
- k=3 rounds; each round runs all 5 arms in an order shuffled with seed 19 (`bench/run-brief.sh`, order logged in `manifest.txt`); one trial at a time; timeout 90 minutes per trial.
- Sandbox: the agent container mounts only its empty workspace and a log directory; `bench/`, the hidden tests and other repositories are never mounted. Network is on (package installs).
- Credentials: the owner's Max subscription through `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`), read from the environment or `~/.config/benchkeeper/oauth-token`, never written to results. Before publishing, every log is searched for the token.
- Command: `bench/run-brief.sh winery claude-opus-5-5 high 3 19`.

### Stage 0 before the paid trials

One trial per arm on `claude-haiku-5-5` (subscription), same scripts: delivery audit passes for all arms, rules file loading is visible in the debug log for C, D and E, the scorer runs on agent output. Its results are wiring checks only.

### Scoring (`bench/scorer/score.sh`, `bench/scripts/trial.mjs`)

Per trial, in a copy of the workspace, in pinned containers:
- `npm install`, `npm run build --if-present`, `npm start` with `PORT` and a random `STAFF_PASSWORD`;
- hidden features passed (of 6); axe violations (WCAG 2.2 AA tags) on start, form, confirmation and staff pages; Lighthouse performance, accessibility and best practices on the start page; `npm audit` counts; the agent's own `npm test` exit code;
- non-blank source and test lines;
- from the transcript: turns, minutes, tokens, API-equivalent USD (`total_cost_usd`; not billed), whether the run ended with a question;
- workflow trace: Skill and Agent calls, plan or spec files written, tests written and whether before the first source file, whether a review step ran, the last tool call.

### Validity

- Delivery audit (`trial.mjs`): the init event lists exactly the arm's plugins and marker skills or agents, none of another arm's markers, and the expected SessionStart hook output; arm A shows none. A failed audit invalidates the trial.
- A trial stopped by a usage limit or API overload is an infrastructure error: rerun once (delete its directory and rerun the command), then listed as excluded.
- Every trial is reported, including stalls, trials without code and invalid ones.

### Report

`bench/results/2026-10-winery-prescreen.md`: setup (versions, image IDs, model, effort, seed, order), the per-arm table from `bench/scripts/summary.mjs` (median and range over 3 trials, no significance tests), per-trial workflow traces, exclusions, deviations from this protocol, subscription usage read before and after.

### Limitations

- One brief, k=3: descriptive only; differences between arms are anecdotal.
- Whole-stack arms: workflow traces show what co-occurs with better scores, not what causes it.
- Effects change by model; Opus results say nothing about Sonnet.
- Exact labels in the brief favor arms that follow the copy literally; all arms get the same brief.
- `tests_first` compares the first test file write with the first source file write; test code inside source files is not detected.
