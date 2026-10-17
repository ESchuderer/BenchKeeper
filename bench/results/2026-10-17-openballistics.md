# Openballistics brief: results on Sonnet 5.5

Brief: an existing Svelte site (openballistics) gets three changes in three separate sessions. Step 1 adds CI, a Pages deploy, a release flow and a README. Step 2 adds a cartridge compare view. Step 3 fixes two bugs reported against that view. 5 Claude Code arms on Sonnet 5.5, effort high, 3 rounds each (k = 3), run 2026-10-17. Descriptive only, no significance tests.

- AD: the BenchKeeper layer v3: the current rules, the `following-dev-workflow` skill mapped to Matt Pocock's skills, Ponytail, no OpenSpec.
- AE: as AD, but OpenSpec owns the spec and the plan.
- V: Matt Pocock's skills alone. AB: OpenSpec alone. A: plain Claude Code.
- Brownfield score: 0 to 100 (section "Method").

## Verdict

- Win rule (set before the run): AD or AE wins when its median is at least 3 above the best median of V, AB and A, and it leads in at least 2 of 3 paired rounds.
- No layer arm wins. The best baseline median is 85.69 (A and AB, tied). AD reaches 85.21 and leads in round 3 only. AE reaches 82.85 and leads in no round.
- The recommended setup stays unchanged.
- AE's stalled round 3 (Key findings) does not decide the verdict. With a score of about 90 in that round, AE's median would be 89.51, but it would still lead in only 1 of 3 rounds.
- Spread within an arm is up to about 7 points (A: 85.2 to 89.9). Medians within 3 points are not separable at k = 3.

## Scores

| Arm | Setup | Median | Round 1 | Round 2 | Round 3 | Minutes (median) | Cost, USD (median) |
|---|---|---|---|---|---|---|---|
| A | plain Claude Code | 85.69 | 89.93 | 85.69 | 85.21 | 12.8 | 2.42 |
| AB | OpenSpec | 85.69 | 82.85 | 89.03 | 85.69 | 11.8 | 2.58 |
| AD | BenchKeeper v3 + Matt Pocock | 85.21 | 84.31 | 85.21 | 92.36 | 7.6 | 1.77 |
| AE | BenchKeeper v3 + Matt Pocock + OpenSpec | 82.85 | 89.51 | 82.85 | 43.61 | 7.3 | 1.77 |
| V | Matt Pocock | 82.85 | 82.85 | 80.90 | 85.69 | 11.1 | 2.21 |

Cost is the API-equivalent figure the agent reports. The trials ran on a subscription.

## Key findings

- AD is the fastest and cheapest arm that finished every step: median 7.6 minutes and 1.77 USD, against 11.1 to 12.8 minutes and 2.21 to 2.58 USD for V, AB and A. It passes all 6 cross-step checks (changelog and version on each change) in 2 of 3 rounds. No other arm does so in more than 1 round.
- AE round 3 stalled in step 2. The agent wrote and validated an OpenSpec change (proposal, spec, design, tasks), left it uncommitted and ended the session with "say 'apply' and I'll implement it". Step 3 found no compare view to fix. The arm's skill has the line "Non-interactive runs (headless, CI): a skill's approval gate or a phase boundary is not a stop" (checked in the built image). The agent followed the OpenSpec propose flow's stop instead. Both reviews rate it 2 overall.
- Step 1 fails most often on the same three checks in every arm: actions pinned to commit SHAs, explicit workflow permissions, and a ref guard on the Pages deploy for `workflow_dispatch`. AD and AE miss the SHA pins in all 3 rounds, V in all 3, AB in 2, A in 1.
- Review (Claude Opus 5.5, 9 criteria from 1 to 5, mean of 6 reviews per arm): CI setup is the lowest criterion for every arm (A 3.8, AB 3.3, AD 3.0, AE 3.0, V 2.8). AD rates highest on requirements (5.0) and cross-step discipline (5.0).
- All 15 trials end every step with the test suite green (suite 10 of 10).

## Method

- Protocol `bench/PROTOCOL.md` 1.17. Brief `bench/briefs/openballistics/`. Seed 71, timeout 5400 s per step, Claude Code on Sonnet 5.5, effort high, `PHASES=1`.
- Each step runs in a new session on the repository state the previous step left. A step's checks run after it ends (`bench/briefs/openballistics/checks/`).
- Two runners on two subscription seats took arms from the same round order (round 1: AB, AD, A, V, AE) and skipped arms the other runner held. Images and commit: `manifest.txt`.
- Brownfield score (`bench/scripts/brownfield-score.mjs`, owner decision 2026-10-17):
  - Step checks, 45: 24 checks over the three steps. A step not reached counts its checks as failed.
  - Review, 35: Claude Opus 5.5 rates 9 criteria from 1 to 5, twice per trial. Each rating maps to 0 to 1, and the mean of all ratings is weighted.
  - Suite, 10: steps that end with the project's test suite green, out of 3.
  - Cross-step checks, 10: changelog and version updated in steps 2 and 3, and CI still runs. A check that cannot run is not counted.
  - Minutes and cost are reported, not scored.

## Per-trial results

| Round | Arm | Total | Checks (45) | Review (35) | Suite (10) | Cross (10) | Step checks | Cross checks | Review overall (2 reviews) | Minutes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A | 89.93 | 43.13 | 30.14 | 10 | 6.67 | 23/24 | 4/6 | 8, 8 | 10.3 |
| 1 | AB | 82.85 | 39.38 | 30.14 | 10 | 3.33 | 21/24 | 2/6 | 8, 8 | 11.8 |
| 1 | AD | 84.31 | 35.63 | 28.68 | 10 | 10 | 19/24 | 6/6 | 7, 8 | 8.1 |
| 1 | AE | 89.51 | 39.38 | 30.14 | 10 | 10 | 21/24 | 6/6 | 7, 8 | 7.3 |
| 1 | V | 82.85 | 37.50 | 28.68 | 10 | 6.67 | 20/24 | 4/6 | 8, 8 | 9.7 |
| 2 | A | 85.69 | 39.38 | 29.65 | 10 | 6.67 | 21/24 | 4/6 | 8, 8 | 13.4 |
| 2 | AB | 89.03 | 41.25 | 31.11 | 10 | 6.67 | 22/24 | 4/6 | 8, 8 | 13.6 |
| 2 | AD | 85.21 | 39.38 | 29.17 | 10 | 6.67 | 21/24 | 4/6 | 7, 7 | 6.8 |
| 2 | AE | 82.85 | 35.63 | 27.22 | 10 | 10 | 19/24 | 6/6 | 7, 7 | 8.0 |
| 2 | V | 80.90 | 37.50 | 26.74 | 10 | 6.67 | 20/24 | 4/6 | 8, 6 | 11.1 |
| 3 | A | 85.21 | 41.25 | 30.63 | 10 | 3.33 | 22/24 | 2/6 | 8, 8 | 12.8 |
| 3 | AB | 85.69 | 39.38 | 29.65 | 10 | 6.67 | 21/24 | 4/6 | 7, 8 | 9.6 |
| 3 | AD | 92.36 | 41.25 | 31.11 | 10 | 10 | 22/24 | 6/6 | 8, 8 | 7.6 |
| 3 | AE | 43.61 | 22.50 | 7.78 | 10 | 3.33 | 12/24 | 2/6 | 2, 2 | 3.7 |
| 3 | V | 85.69 | 39.38 | 29.65 | 10 | 6.67 | 21/24 | 4/6 | 7, 8 | 11.3 |

## Data

`bench/results/2026-10-17-openballistics-sonnet/`: `manifest.txt`, `brownfield-score.json`, and per trial `trial.json` (steps, checks, minutes, cost), the transcript, the final repository (`app.tar.gz`), screenshots and both reviews.
