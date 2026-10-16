# React winery brief: Claude Code and OpenCode on Haiku 5.5 and Sonnet 5.5

Runs 2026-10-14 to 2026-10-16, protocol `bench/PROTOCOL.md` v1.9. All 58 trials scored with the same hidden tests (`374dfd34d02f0c2f`: 6 feature tests, 12 robustness tests); agent runs unchanged by rescoring. One trial per arm and model; descriptive only. Results page with screenshots: https://claude.ai/artifact/E4fVUmc4WnofiUD8BoirLz (private to the owner).

## Setup

| Item | Value |
|---|---|
| Brief | `bench/briefs/winery-react/brief.md` (React, established frameworks, look and feel, process paragraph) |
| Claude Code arms | 22 (A, B, C to P, V to Y, AB, AC), Claude Code 2.1.299, effort `high`; Haiku: the owner's Max subscription; Sonnet: 11 arms on the Max subscription (B C D E G I J K O X Y AB, until its weekly limit), 11 on the owner's Team seat (A F H L M N P V W AC) |
| OpenCode arms | 7 (Q to U, Z, AA), OpenCode 1.19.0, `claude-haiku-5-5` and `claude-sonnet-5-5`, variant `high`, Anthropic API key |
| Review | blind, `claude-opus-5-5`, effort `high`, `bench/review/`, billed to the API key. Haiku and OpenCode apps: 9 criteria; Sonnet Claude Code apps: 13 criteria (adds visual design, layout, usability, reception; protocol v1.7). The two sets of ratings are not directly comparable. |
| Seed, order | 41; Claude Code arms in three parallel runners plus single-arm reruns; order, image IDs and account switch in the run manifests |

Review column: a review skill, a review agent type, or a subagent whose task description names a review (parser fixed during the run; all `trial.json` files re-parsed).

## How costs were recorded

| Runtime and account | What "USD" is | Billed? |
|---|---|---|
| Claude Code, Max subscription or Team seat | `total_cost_usd` of Claude Code's final `result` event: an API-equivalent estimate that Claude Code computes from the token counts; summed over the session (follow-up turns continue it) | no: the subscription and the seat are flat-rate; the estimate shows API list-price equivalent, not what the account paid or how much of its usage limit a trial took |
| OpenCode, API key | sum of the per-message `cost` in OpenCode's session exports, computed by OpenCode from its model catalog prices (fetched when the image was built) | yes, to the API key; main session only for these runs (see caveat) |
| App reviews, API key | `cost_usd_api_equivalent` in `review.json`, from the reviewing Claude Code's `result` event | yes, to the API key |
| Per-phase USD (Sonnet runs) | Claude Code: the trial total split by each call's token weight; OpenCode: per message as reported | estimate |

Confidence in the cost figures: medium. Not reconciled against the Anthropic Console usage export or an invoice. Uncertain: whether the tools' built-in price tables match the prices charged (for example cache-write tiers), OpenCode subagent sessions missing from these runs (estimated USD 3), and Sonnet K, whose agent ended its own process before the final `result` event (no cost recorded). The account (Max or Team) does not change the API-equivalent estimate.

## Claude Code, Sonnet 5.5 (13 review criteria)

| Arm | Setup | Features | Robustness | Follow-ups | Minutes | USD | Overall | Req. | Correct. | Security | Code | Tests | UX | A11y | Simple | Maint. | Visual | Layout | Usability | Reception | Tests first | Review |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | plain | 6/6 | 12/12 | 0 | 7 | 0.92 | 8 | 5 | 5 | 5 | 4 | 5 | 4 | 4 | 5 | 3 | 5 | 4 | 4 | 4 | yes | yes |
| B | Ponytail | 6/6 | 12/12 | 0 | 3 | 0.39 | 7 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 5 | 2 | 4 | 4 | 4 | 4 | yes | no |
| AB | OpenSpec | 6/6 | 12/12 | 1 | 27 | 3.19 | 9 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 5 | 5 | 4 | 5 | yes | yes |
| AC | Spec Kit | 6/6 | 12/12 | 0 | 15 | 2.73 | 8 | 5 | 5 | 5 | 5 | 5 | 4 | 5 | 4 | 3 | 4 | 4 | 4 | 4 | no | yes |
| O | Ponytail + OpenSpec | 6/6 | 12/12 | 0 | 8 | 1.11 | 8 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 5 | 3 | 4 | 4 | 4 | 4 | no | yes |
| P | Ponytail + Spec Kit | 6/6 | 12/12 | 0 | 5 | 0.89 | 8 | 5 | 5 | 4 | 4 | 5 | 4 | 4 | 5 | 3 | 4 | 5 | 4 | 4 | yes | yes |
| F | agent-skills | 6/6 | 12/12 | 1 | 26 | 3.5 | 8 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 3 | 4 | 5 | 4 | 4 | yes | yes |
| G | Superpowers | 6/6 | 12/12 | 0 | 11 | 1.9 | 8 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 3 | 4 | 5 | 4 | 4 | yes | yes |
| H | ECC | 6/6 | 12/12 | 0 | 23 | 5.58 | 8 | 5 | 5 | 5 | 5 | 5 | 4 | 5 | 4 | 4 | 4 | 5 | 4 | 4 | yes | yes |
| V | Matt Pocock | 6/6 | 12/12 | 1 | 13 | 1.86 | 8 | 5 | 5 | 4 | 4 | 5 | 4 | 4 | 4 | 3 | 4 | 5 | 4 | 4 | yes | yes |
| I | agent-skills + OpenSpec | 6/6 | 12/12 | 0 | 16 | 2.77 | 8 | 5 | 5 | 5 | 4 | 5 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | yes | yes |
| J | Superpowers + OpenSpec | 6/6 | 12/12 | 0 | 30 | 3.03 | 8 | 5 | 5 | 4 | 5 | 5 | 5 | 4 | 4 | 3 | 5 | 5 | 4 | 5 | yes | yes |
| K | ECC + OpenSpec | 6/6 | 12/12 | 0 | 12 | n/a | 8 | 5 | 4 | 5 | 4 | 5 | 4 | 5 | 5 | 3 | 4 | 5 | 4 | 4 | yes | yes |
| W | Matt Pocock + OpenSpec | 6/6 | 12/12 | 1 | 14 | 2.6 | 8 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 5 | 4 | 4 | 4 | 4 | 4 | yes | yes |
| L | BK + agent-skills | 6/6 | 12/12 | 0 | 5 | 0.98 | 7 | 4 | 4 | 5 | 4 | 3 | 4 | 4 | 5 | 2 | 4 | 4 | 4 | 4 | yes | yes |
| M | BK + Superpowers | 6/6 | 12/12 | 0 | 8 | 1.68 | 8 | 4 | 5 | 5 | 4 | 4 | 4 | 4 | 5 | 2 | 4 | 4 | 4 | 4 | yes | yes |
| N | BK + ECC | 6/6 | 12/12 | 0 | 9 | 2.19 | 8 | 5 | 4 | 5 | 4 | 5 | 4 | 4 | 5 | 2 | 4 | 4 | 4 | 4 | no | yes |
| X | BK + Matt Pocock | 6/6 | 12/12 | 0 | 6 | 1.32 | 8 | 5 | 5 | 5 | 4 | 4 | 4 | 3 | 5 | 3 | 4 | 4 | 4 | 4 | yes | yes |
| C | BK + agent-skills + OpenSpec | 6/6 | 12/12 | 0 | 30 | 1.63 | 8 | 5 | 4 | 5 | 5 | 5 | 4 | 4 | 5 | 3 | 4 | 4 | 4 | 4 | yes | yes |
| D | BK + Superpowers + OpenSpec | 6/6 | 12/12 | 0 | 26 | 1.73 | 8 | 5 | 4 | 5 | 5 | 5 | 4 | 4 | 5 | 3 | 4 | 4 | 4 | 4 | no | yes |
| E | BK + ECC + OpenSpec | 6/6 | 12/12 | 0 | 10 | 2.7 | 8 | 5 | 5 | 5 | 5 | 5 | 4 | 5 | 5 | 3 | 4 | 5 | 4 | 4 | yes | yes |
| Y | BK + Matt Pocock + OpenSpec | 6/6 | 12/12 | 0 | 7 | 1.1 | 8 | 5 | 5 | 4 | 5 | 5 | 4 | 4 | 5 | 3 | 4 | 4 | 4 | 4 | no | yes |

Trials: USD 43.79 API-equivalent (21 trials; K without cost). Reviews: USD 9.54 billed. W was rerun under protocol v1.8 (the first trial, 0/6 after it stopped to wait for confirmation, is kept in `limited/W-v1.7`).

## Claude Code, Haiku 5.5 (9 review criteria)

| Arm | Setup | Features | Robustness | Follow-ups | Minutes | USD | Overall | Req. | Correct. | Security | Code | Tests | UX | A11y | Simple | Maint. | Tests first | Review |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | plain | 6/6 | 12/12 | 0 | 18 | 1.18 | 9 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 5 | 4 | yes | yes |
| B | Ponytail | 6/6 | 12/12 | 0 | 15 | 0.48 | 8 | 4 | 5 | 4 | 5 | 4 | 5 | 4 | 5 | 3 | yes | yes |
| AB | OpenSpec | 6/6 | 12/12 | 0 | 24 | 1.92 | 8 | 5 | 5 | 4 | 5 | 5 | 4 | 4 | 4 | 3 | yes | yes |
| AC | Spec Kit | 6/6 | 12/12 | 0 | 20 | 1.65 | 8 | 5 | 5 | 4 | 5 | 5 | 4 | 4 | 5 | 4 | yes | yes |
| O | Ponytail + OpenSpec | 6/6 | 12/12 | 0 | 16 | 1.04 | 7 | 4 | 5 | 4 | 5 | 4 | 4 | 4 | 5 | 2 | yes | yes |
| P | Ponytail + Spec Kit | 6/6 | 12/12 | 0 | 25 | 0.93 | 8 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 3 | yes | yes |
| F | agent-skills | 6/6 | 12/12 | 0 | 19 | 1.09 | 8 | 4 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 4 | yes | yes |
| G | Superpowers | 6/6 | 10/12 | 0 | 16 | 1.69 | 8 | 5 | 4 | 5 | 4 | 5 | 4 | 4 | 4 | 3 | yes | yes |
| H | ECC | 6/6 | 12/12 | 0 | 14 | 1.43 | 8 | 4 | 5 | 5 | 4 | 4 | 4 | 4 | 4 | 3 | yes | yes |
| V | Matt Pocock | 6/6 | 12/12 | 0 | 18 | 0.95 | 8 | 5 | 5 | 4 | 5 | 5 | 4 | 4 | 5 | 3 | yes | yes |
| I | agent-skills + OpenSpec | 6/6 | 12/12 | 0 | 26 | 2.12 | 8 | 4 | 5 | 5 | 4 | 5 | 4 | 4 | 4 | 3 | no | yes |
| J | Superpowers + OpenSpec | 6/6 | 12/12 | 1 | 25 | 1.4 | 8 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 4 | 3 | no | yes |
| K | ECC + OpenSpec | 6/6 | 12/12 | 0 | 22 | 3.41 | 8 | 4 | 5 | 5 | 4 | 5 | 4 | 4 | 4 | 3 | yes | yes |
| W | Matt Pocock + OpenSpec | 6/6 | 12/12 | 0 | 29 | 2.05 | 8 | 5 | 5 | 4 | 5 | 5 | 4 | 4 | 4 | 3 | yes | yes |
| L | BK + agent-skills | 6/6 | 12/12 | 0 | 10 | 0.43 | 8 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 5 | 3 | yes | yes |
| M | BK + Superpowers | 6/6 | 12/12 | 0 | 12 | 1.51 | 7 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 5 | 2 | yes | yes |
| N | BK + ECC | 6/6 | 12/12 | 0 | 19 | 2.72 | 7 | 4 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 2 | no | yes |
| X | BK + Matt Pocock | 6/6 | 12/12 | 0 | 12 | 0.6 | 8 | 5 | 4 | 4 | 5 | 4 | 4 | 4 | 5 | 2 | yes | yes |
| C | BK + agent-skills + OpenSpec | 6/6 | 12/12 | 0 | 13 | 0.86 | 8 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 5 | 2 | yes | yes |
| D | BK + Superpowers + OpenSpec | 6/6 | 12/12 | 1 | 17 | 1.39 | 8 | 5 | 4 | 5 | 4 | 4 | 4 | 4 | 5 | 3 | yes | yes |
| E | BK + ECC + OpenSpec | 6/6 | 12/12 | 1 | 21 | 2.98 | 8 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 4 | 2 | no | yes |
| Y | BK + Matt Pocock + OpenSpec | 6/6 | 12/12 | 0 | 15 | 1.41 | 8 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 5 | 3 | no | yes |

Trials: USD 33.24 API-equivalent.

## OpenCode, Haiku 5.5 and Sonnet 5.5 (9 review criteria)

| Arm | Setup | Features | Robustness | Follow-ups | Minutes | USD | Overall | Req. | Correct. | Security | Code | Tests | UX | A11y | Simple | Maint. | Tests first | Review |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q | OpenSpec + targeted skills (Haiku) | 6/6 | 12/12 | 0 | 40 | 1.6 | 8 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 3 | no | no |
| R | Superpowers (Haiku) | 6/6 | 12/12 | 0 | 20 | 0.76 | 7 | 5 | 5 | 4 | 4 | 4 | 4 | 4 | 4 | 2 | no | yes |
| S | OpenSpec + Superpowers (oso) (Haiku) | 0/6 | n/a | 2 | 19 | 0.96 | 3 | 2 | 4 | 4 | 4 | 4 | 2 | 4 | 4 | 1 | yes | yes |
| T | agent-skills (Haiku) | 6/6 | 12/12 | 0 | 26 | 1.5 | 8 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 3 | yes | yes |
| U | agent-skills + OpenSpec (Haiku) | 6/6 | 12/12 | 0 | 23 | 1.22 | 8 | 4 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 2 | yes | yes |
| Z | Matt Pocock (Haiku) | 6/6 | 12/12 | 0 | 45 | 1.84 | 8 | 4 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 2 | yes | yes |
| AA | Matt Pocock + OpenSpec (Haiku) | 6/6 | 12/12 | 0 | 30 | 1.67 | 7 | 4 | 4 | 4 | 5 | 5 | 4 | 4 | 4 | 2 | no | yes |
| Q | OpenSpec + targeted skills (Sonnet) | 6/6 | 12/12 | 0 | 30 | 3.02 | 9 | 5 | 5 | 5 | 5 | 5 | 4 | 5 | 4 | 3 | yes | yes |
| R | Superpowers (Sonnet) | 6/6 | 12/12 | 0 | 18 | 1.52 | 8 | 5 | 5 | 4 | 4 | 5 | 4 | 4 | 4 | 2 | no | yes |
| S | OpenSpec + Superpowers (oso) (Sonnet) | 6/6 | 12/12 | 1 | 20 | 2.11 | 9 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 3 | no | yes |
| T | agent-skills (Sonnet) | 6/6 | 12/12 | 0 | 27 | 3.32 | 9 | 5 | 5 | 5 | 5 | 5 | 4 | 5 | 4 | 4 | yes | yes |
| U | agent-skills + OpenSpec (Sonnet) | 6/6 | 12/12 | 0 | 21 | 2.49 | 8 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 4 | 3 | yes | yes |
| Z | Matt Pocock (Sonnet) | 6/6 | 12/12 | 0 | 22 | 2.83 | 8 | 5 | 5 | 4 | 5 | 5 | 5 | 4 | 5 | 2 | no | yes |
| AA | Matt Pocock + OpenSpec (Sonnet) | 6/6 | 12/12 | 0 | 25 | 2.1 | 8 | 5 | 5 | 4 | 5 | 5 | 4 | 4 | 5 | 3 | no | yes |

Trials: USD 26.94 over the main sessions; reviews of the 36 Haiku and OpenCode apps: USD 18.87 billed.

Caveat: the OpenCode USD, tokens, tool uses and phases cover only the main session of each trial. The runner exported root sessions only (`opencode session list` does not list subagent sessions; fixed after this run), and 11 of 14 trials started 1 or 2 subagents through the task tool (all except Q and T on Haiku and U on Sonnet), whose cost is missing. Estimated USD 3 more in total (about 0.80 Haiku, 2.20 Sonnet; unverified, from each main session's cost per active minute times the subagent minutes recorded in its task calls). All subagents were read-only reviews or design checks; features, reviews and wall minutes are unaffected. No rerun (owner decision).

## Robustness tests (#27)

12 tests from the brief's sentences (`bench/PROTOCOL.md`): simultaneous bookings for the last seats (R1), invalid guests 0, 9, 2.5 (R2 to R4), empty name and email (R5, R6), booking data without sign-in including API responses (R7), HTML in names (R8), invalid guests sent without the form, with a valid replay as control (R9), a name of only spaces (R10), accents and other scripts (R11), cancelling without a session (R12).

- Every app that started passes all 12, except Haiku G (10 of 12): G limits bookings to 10 per 15 minutes per client (`src/server/app.ts`, `express-rate-limit`), and the hidden tests send more than 10 bookings from one client, so the bookings of R12 and R9 (the last two tests) were refused. This is a limit of the test suite, not a defect in what R12 and R9 test.
- Haiku S (OpenCode, oso) did not start: no robustness score.
- Like the feature tests, the robustness tests do not separate the arms on this brief.

## Observations (one trial each)

- Hidden tests: all 22 Sonnet and 22 Haiku Claude Code apps and 13 of 14 OpenCode apps pass all 6 features; robustness see above.
- Maintainability is the weakest review criterion in every group (mostly 2 or 3; no app has CI). On both models the BenchKeeper-layer arms without OpenSpec score lowest (Haiku L M N X: 3, 2, 2, 2; Sonnet: 2, 2, 2, 3). Candidate cause: BenchKeeper's scope rule ("no unrequested ... extra files") and Ponytail's least-code rule.
- Sonnet overall ratings: OpenSpec alone (AB) 9; B (Ponytail) and L (BK + agent-skills) 7; all others 8. Haiku: A (plain) 9; O, M, N 7; others 8.
- Sonnet took 14 minutes per Claude Code trial on average, Haiku 18; Sonnet cost more in 15 of 21 pairs with a cost.
- Ponytail lowered the cost in every baseline pair on Haiku (B vs A, O vs AB, P vs AC) and on Sonnet (B vs A, O vs AB, P vs AC).
- Stops before the app was finished: Haiku D, E, J stopped after the specification (follow-up because the app did not run); Sonnet W stopped after its first task group to wait for confirmation while its skeleton app already ran, so v1.7 gave no follow-up (0 of 6); under v1.8 the rerun got one follow-up and reached 6 of 6.
- Sonnet K's agent ended its own Claude Code process with a shell loop over `/proc` (exit 143); its app passes 6 of 6 and 12 of 12, but cost and turns were not recorded.
- OpenCode with oso on Haiku (S) built the app in a git worktree and never merged it into the project folder: 0 of 6, review 3; a second run by another session (kept in `limited/S-rerun-1429` of the run, not published) also reached 0 of 6. On Sonnet the same arm merged and reached 9.
- On OpenCode, Sonnet reviewed at least as high as Haiku in every arm.

## Harness changes during the run

Recorded in the protocol history (v1.0 to v1.9): follow-up rule checks that the app runs (v1.2) and, from v1.8, also fires when the final message waits for confirmation; the app check runs on a copy of the workspace from v1.8 (before, its `npm install` and `npm run build` left `package-lock.json` and `dist/` in the workspace, so `maintenance.lockfile` of earlier trials does not show whether the agent committed a lockfile); usage gate at 70% of the 5-hour window and 98% of the weekly window; OpenCode runner fixes (missing subscription token, empty and pre-committed project template, worktree pointer files in the token scan, subagent session export); hidden test F6 waits for the cancel request; robustness tests R1 to R12 (v1.9); review criteria 10 to 13 (v1.7).

## Data

`2026-10-15-winery-react-haiku/` (Claude Code and OpenCode on Haiku) and `2026-10-15-winery-react-sonnet/` (Claude Code and OpenCode on Sonnet): manifest, and per trial `trial.json`, `review.json`, `transcript.jsonl.gz`, `app.tar.gz` and screenshots. Published with `bench/publish.sh`, which refuses when any stored credential appears in a file or in an app's git history.
