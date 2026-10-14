# Stage 0: winery brief on Claude Haiku 5.5

Run 2026-10-14, protocol `bench/PROTOCOL.md` v0.1 (stage 0). Wiring check on practice data: one trial per arm, no effect conclusions.

## Setup

| Item | Value |
|---|---|
| Model, effort | `claude-haiku-5-5`, `high` |
| Trials | 1 round, 5 arms, order D C B E A (seed 19) |
| BenchKeeper commit | `f6558a5` (clean tree) |
| Claude Code | 2.1.299 |
| Host | Linux 7.2.9 CachyOS x86_64, 16 CPUs, 31 GB, podman 6.1.3 |
| Account | owner's Max subscription (organization `9653e407-...`) |
| Image IDs | `manifest.txt` |

Deviation: the protocol names no account; the owner's PiMetry Team seat was intended, but `claude setup-token` for that organization failed with `invalid_request_error` "Invalid request format" (request `req_011Cg2NkNPMrtjPcotFDBU78`), so this run used the Max subscription.

## Results

Median (min to max) over valid trials, from `bench/scripts/summary.mjs`; one trial per arm, so each value is that trial.

| Arm | Trials | Invalid | Features (of 6) | Lighthouse perf | axe violations | Tests written | Review ran | Source lines | Minutes | USD (API-equivalent) |
|---|---|---|---|---|---|---|---|---|---|---|
| A | 1 | 0 | 6 | 100 | 0 | 1 | 0 | 740 | 3.6 | 0.047 |
| B | 1 | 0 | 6 | 100 | 0 | 1 | 0 | 183 | 2.2 | 0.026 |
| C | 1 | 0 | 6 | 100 | 0 | 1 | 1 | 227 | 4.1 | 0.047 |
| D | 1 | 0 | 6 | 100 | 0 | 1 | 0 | 220 | 2.1 | 0.029 |
| E | 1 | 0 | 6 | 100 | 0 | 1 | 0 | 299 | 2.6 | 0.040 |

USD is Claude Code's `total_cost_usd` estimate at list prices; nothing was billed beyond the subscription.

Per trial (`<arm>/trial.json`):

| Arm | Turns | Tool calls | Output tokens | Test lines | Skill calls | Agent calls | Tests before source | Lighthouse a11y, best practices | Own tests |
|---|---|---|---|---|---|---|---|---|---|
| A | 22 | 21 | 52,372 | 218 | none | none | no | 1.00, 0.96 | pass |
| B | 11 | 10 | 29,462 | 83 | none | none | no | 1.00, 0.96 | pass |
| C | 16 | 17 | 53,276 | 222 | none | `agent-skills:code-reviewer` | no | 0.96, 1.00 | pass |
| D | 18 | 17 | 28,453 | 94 | none | none | no | 0.96, 0.96 | pass |
| E | 12 | 11 | 35,974 | 161 | none | none | no | 1.00, 0.96 | pass |

## Wiring checks

- Delivery audit: passed for all 5 trials (plugins, marker skills and agents, SessionStart output per arm).
- Rules loading (probe after the run: each image asked, without tools, to list the level-2 headings of its `~/.claude/rules/` files): A and B none; C the full `rules/global.md` (14 sections); D the base rules (10 sections); E the base rules plus ECC's `rules/ecc/` files. As specified.
- Superpowers' SessionStart hook ran in headless mode (arm D).
- Hidden tests, scorer, axe and Lighthouse ran on every trial; no trial stalled, timed out or ended with a question.
- Token search in all trial output: not found.

## Observations (Haiku, one trial each; not evidence for other models)

- Every arm built a working app that passed all six hidden features with no axe violations.
- No arm invoked a skill. Superpowers (D) did not start brainstorming; ECC (E) did not delegate to its planner or TDD agents despite its rules; BenchKeeper (C) ran the agent-skills code reviewer after building, then fixed what it found (input errors, concurrent bookings) in a second segment.
- Arm A wrote 740 source lines; arms B to E wrote 183 to 299.
- No arm wrote tests before source files.

## Fixes found by this run

- The parser read tokens from the last `result` event only; arm C produced two (the main thread resumed after a background review agent). Tokens now come from the cumulative per-model usage, turns are summed over result events.
- The summary rounded API-equivalent USD to one decimal (all 0); now three decimals.

## Data

`2026-10-14-winery-haiku-stage0/`: `manifest.txt`, and per arm `trial.json` and `transcript.jsonl.gz`. Workspaces, scorer logs and debug logs stay in `bench/runs/` (not committed).
