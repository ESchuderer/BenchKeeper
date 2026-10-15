# React winery brief: Claude Code on Haiku 5.5, OpenCode on Haiku and Sonnet 5.5

Runs 2026-10-14/15, protocol `bench/PROTOCOL.md` v1.5 (scores after the F6 test fix; all trials rescored with hidden tests `0c89d28500b65ba5`). One trial per arm and model; descriptive only. Results page with screenshots: https://claude.ai/artifact/E4fVUmc4WnofiUD8BoirLz (private to the owner).

## Setup

| Item | Value |
|---|---|
| Brief | `bench/briefs/winery-react/brief.md` (React, established frameworks, look and feel, process paragraph) |
| Claude Code arms | 22 (A, B, C to P, V to Y, AB, AC), Claude Code 2.1.299, `claude-haiku-5-5`, effort `high`, the owner's Max subscription |
| OpenCode arms | 7 (Q to U, Z, AA), OpenCode 1.19.0, `claude-haiku-5-5` and `claude-sonnet-5-5`, variant `high`, Anthropic API key |
| Review | blind, `claude-opus-5-5`, effort `high`, `bench/review/` with 9 criteria including maintainability, billed to the API key |
| Seed, order | 41; Claude Code arms in three parallel runners plus single-arm reruns; order and image IDs in the run manifests |
| Not run | the 22 Claude Code arms on Sonnet (paused: subscription weekly limit at 95%) |

Review: a review skill, a review agent type, or a subagent whose task description names a review. The parser first missed the last kind; the column is corrected here, the `review` field in this run's `trial.json` files reads false for these 13 trials (A, B, G, M; OpenCode Haiku R, S, U, Z, AA and Sonnet Q, R, Z, AA).

USD is the API-equivalent estimate for the Claude Code trials (subscription, not billed) and the billed API cost for the OpenCode trials.

## Claude Code, Haiku 5.5

| Arm | Setup | Features | Follow-ups | Minutes | USD | Overall | Req. | Correct. | Security | Code | Tests | UX | A11y | Simple | Maint. | Tests first | Review |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | plain | 6/6 | 0 | 18 | 1.18 | 9 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 5 | 4 | yes | yes |
| B | Ponytail | 6/6 | 0 | 15 | 0.48 | 8 | 4 | 5 | 4 | 5 | 4 | 5 | 4 | 5 | 3 | yes | yes |
| AB | OpenSpec | 6/6 | 0 | 24 | 1.92 | 8 | 5 | 5 | 4 | 5 | 5 | 4 | 4 | 4 | 3 | yes | yes |
| AC | Spec Kit | 6/6 | 0 | 20 | 1.65 | 8 | 5 | 5 | 4 | 5 | 5 | 4 | 4 | 5 | 4 | yes | yes |
| O | Ponytail + OpenSpec | 6/6 | 0 | 16 | 1.04 | 7 | 4 | 5 | 4 | 5 | 4 | 4 | 4 | 5 | 2 | yes | yes |
| P | Ponytail + Spec Kit | 6/6 | 0 | 25 | 0.93 | 8 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 3 | yes | yes |
| F | agent-skills | 6/6 | 0 | 19 | 1.09 | 8 | 4 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 4 | yes | yes |
| G | Superpowers | 6/6 | 0 | 16 | 1.69 | 8 | 5 | 4 | 5 | 4 | 5 | 4 | 4 | 4 | 3 | yes | yes |
| H | ECC | 6/6 | 0 | 14 | 1.43 | 8 | 4 | 5 | 5 | 4 | 4 | 4 | 4 | 4 | 3 | yes | yes |
| V | Matt Pocock | 6/6 | 0 | 18 | 0.95 | 8 | 5 | 5 | 4 | 5 | 5 | 4 | 4 | 5 | 3 | yes | yes |
| I | agent-skills + OpenSpec | 6/6 | 0 | 26 | 2.12 | 8 | 4 | 5 | 5 | 4 | 5 | 4 | 4 | 4 | 3 | no | yes |
| J | Superpowers + OpenSpec | 6/6 | 1 | 25 | 1.40 | 8 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 4 | 3 | no | yes |
| K | ECC + OpenSpec | 6/6 | 0 | 22 | 3.41 | 8 | 4 | 5 | 5 | 4 | 5 | 4 | 4 | 4 | 3 | yes | yes |
| W | Matt Pocock + OpenSpec | 6/6 | 0 | 29 | 2.05 | 8 | 5 | 5 | 4 | 5 | 5 | 4 | 4 | 4 | 3 | yes | yes |
| L | BK + agent-skills | 6/6 | 0 | 10 | 0.43 | 8 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 5 | 3 | yes | yes |
| M | BK + Superpowers | 6/6 | 0 | 12 | 1.51 | 7 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 5 | 2 | yes | yes |
| N | BK + ECC | 6/6 | 0 | 19 | 2.72 | 7 | 4 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 2 | no | yes |
| X | BK + Matt Pocock | 6/6 | 0 | 12 | 0.60 | 8 | 5 | 4 | 4 | 5 | 4 | 4 | 4 | 5 | 2 | yes | yes |
| C | BK + agent-skills + OpenSpec | 6/6 | 0 | 13 | 0.86 | 8 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 5 | 2 | yes | yes |
| D | BK + Superpowers + OpenSpec | 6/6 | 1 | 17 | 1.39 | 8 | 5 | 4 | 5 | 4 | 4 | 4 | 4 | 5 | 3 | yes | yes |
| E | BK + ECC + OpenSpec | 6/6 | 1 | 21 | 2.98 | 8 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 4 | 2 | no | yes |
| Y | BK + Matt Pocock + OpenSpec | 6/6 | 0 | 15 | 1.41 | 8 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 5 | 3 | no | yes |

Trials: USD 33.24 API-equivalent.

## OpenCode, Haiku 5.5 and Sonnet 5.5

| Arm | Setup | Features | Follow-ups | Minutes | USD | Overall | Req. | Correct. | Security | Code | Tests | UX | A11y | Simple | Maint. | Tests first | Review |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AA | Matt Pocock + OpenSpec (Haiku) | 6/6 | 0 | 30 | 1.67 | 7 | 4 | 4 | 4 | 5 | 5 | 4 | 4 | 4 | 2 | no | yes |
| AA | Matt Pocock + OpenSpec (Sonnet) | 6/6 | 0 | 25 | 2.10 | 8 | 5 | 5 | 4 | 5 | 5 | 4 | 4 | 5 | 3 | no | yes |
| Q | OpenSpec + targeted skills (Haiku) | 6/6 | 0 | 40 | 1.60 | 8 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 3 | no | no |
| Q | OpenSpec + targeted skills (Sonnet) | 6/6 | 0 | 30 | 3.02 | 9 | 5 | 5 | 5 | 5 | 5 | 4 | 5 | 4 | 3 | yes | yes |
| R | Superpowers (Haiku) | 6/6 | 0 | 20 | 0.76 | 7 | 5 | 5 | 4 | 4 | 4 | 4 | 4 | 4 | 2 | no | yes |
| R | Superpowers (Sonnet) | 6/6 | 0 | 18 | 1.52 | 8 | 5 | 5 | 4 | 4 | 5 | 4 | 4 | 4 | 2 | no | yes |
| S | OpenSpec + Superpowers (oso) (Haiku) | 0/6 | 2 | 19 | 0.96 | 3 | 2 | 4 | 4 | 4 | 4 | 2 | 4 | 4 | 1 | yes | yes |
| S | OpenSpec + Superpowers (oso) (Sonnet) | 6/6 | 1 | 20 | 2.11 | 9 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 3 | no | yes |
| T | agent-skills (Haiku) | 6/6 | 0 | 26 | 1.50 | 8 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 3 | yes | yes |
| T | agent-skills (Sonnet) | 6/6 | 0 | 27 | 3.32 | 9 | 5 | 5 | 5 | 5 | 5 | 4 | 5 | 4 | 4 | yes | yes |
| U | agent-skills + OpenSpec (Haiku) | 6/6 | 0 | 23 | 1.22 | 8 | 4 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 2 | yes | yes |
| U | agent-skills + OpenSpec (Sonnet) | 6/6 | 0 | 21 | 2.49 | 8 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 4 | 3 | yes | yes |
| Z | Matt Pocock (Haiku) | 6/6 | 0 | 45 | 1.84 | 8 | 4 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 2 | yes | yes |
| Z | Matt Pocock (Sonnet) | 6/6 | 0 | 22 | 2.83 | 8 | 5 | 5 | 4 | 5 | 5 | 5 | 4 | 5 | 2 | no | yes |

Trials: USD 26.94 over the main sessions; reviews of all 36 apps: USD 18.87 billed.

Caveat: the OpenCode USD, tokens, tool uses and phases cover only the main session of each trial. The runner exported root sessions only (`opencode session list` does not list subagent sessions; fixed after this run), and 11 of 14 trials started 1 or 2 subagents through the task tool (all except Q and T on Haiku and U on Sonnet), whose cost is missing. The billed amount for these trials is higher than shown: estimated USD 3 more in total (about 0.80 Haiku, 2.20 Sonnet; unverified, from each main session's cost per active minute times the subagent minutes recorded in its task calls). All subagents were read-only reviews or design checks; features, reviews and wall minutes are unaffected. No rerun (owner decision).

## Observations (one trial each)

- All 22 Claude Code apps and 13 of 14 OpenCode apps passed all 6 hidden features; the feature tests do not separate the arms on this brief (robustness tests: #27).
- Maintainability is the weakest criterion (2 or 3 for most apps; no app has CI). Six Claude Code apps have no README: C, E, M, N, X (BenchKeeper arms) and O (Ponytail + OpenSpec). Candidate cause: BenchKeeper's scope rule ("no unrequested ... extra files") and Ponytail's least-code rule.
- Plain Claude Code (A) received the highest Claude Code review (9); the framework and BenchKeeper arms received 7 or 8.
- Ponytail lowered the cost in every baseline pair (B vs A, O vs AB, P vs AC).
- Three Claude Code trials stopped after the specification and needed a follow-up (D, E, J: a framework with OpenSpec).
- OpenCode with oso on Haiku (S) built the app in a git worktree and never merged it into the project folder: 0 of 6, review 3. On Sonnet the same arm merged and reached 9.
- On OpenCode, Sonnet reviewed at least as high as Haiku in every arm.

## Harness changes during the run

Recorded in the protocol history (v1.0 to v1.5): follow-up rule checks that the app runs; usage gate at 70% of the 5-hour window; OpenCode runner fixes (missing subscription token in OpenCode-only runs, empty project template, pre-committed template, git worktree pointer files in the token scan); hidden test F6 waits for the cancel request (rescored all trials).

## Data

`2026-10-15-winery-react-haiku/` (Claude Code and OpenCode on Haiku) and `2026-10-15-winery-react-sonnet-opencode/` (OpenCode on Sonnet): manifest, and per trial `trial.json`, `review.json`, `transcript.jsonl.gz`, `app.tar.gz` and screenshots.
