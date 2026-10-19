# Openballistics brief: results on Sonnet 5.5

Brief: an existing Svelte site (openballistics) gets three changes in three separate sessions. Step 1 adds CI, a Pages deploy, a release flow and a README. Step 2 adds a cartridge compare view. Step 3 fixes two bugs reported against that view. 8 Claude Code arms on Sonnet 5.5, effort high, 3 rounds each (k = 3). The first 5 arms ran on 2026-10-17, AH on 2026-10-18, AN and AM on 2026-10-19, with the same seed, baseline repository and checks. Descriptive only, no significance tests.

- AD: the BenchKeeper layer v3: the rules, the `following-dev-workflow` skill mapped to Matt Pocock's skills, Ponytail, no OpenSpec.
- AE: as AD, but OpenSpec owns the spec and the plan.
- AH: BenchKeeper setup-v3.3 with Matt Pocock's skills and Ponytail.
- AM: BenchKeeper setup-v5.0 with Matt Pocock's skills and Ponytail.
- AN: BenchKeeper setup-v4.0 with Matt Pocock's skills, without Ponytail.
- V: Matt Pocock's skills alone. AB: OpenSpec alone. A: plain Claude Code.
- Brownfield score: 0 to 100 (section "Method").

## Cost, quality and time

Medians of 3 rounds, compared with plain Claude Code (A). Cost is the API-equivalent figure the agent reports; the trials ran on a subscription, where it counts against the usage window.

| Arm | Setup | Score | Score vs A | Minutes | Time vs A | Cost, USD | Cost vs A |
|---|---|---|---|---|---|---|---|
| AM | BenchKeeper setup-v5.0 + Matt Pocock | 86.18 | +0.49 | 17.7 | 1.38x | 3.70 | 1.53x |
| AH | BenchKeeper setup-v3.3 + Matt Pocock | 85.76 | +0.07 | 8.1 | 0.63x | 1.66 | 0.69x |
| A | plain Claude Code | 85.69 | 0 | 12.8 | 1x | 2.42 | 1x |
| AB | OpenSpec | 85.69 | 0 | 11.8 | 0.92x | 2.58 | 1.07x |
| AD | BenchKeeper v3 + Matt Pocock | 85.21 | -0.48 | 7.6 | 0.59x | 1.77 | 0.73x |
| AE | BenchKeeper v3 + Matt Pocock + OpenSpec | 82.85 | -2.84 | 7.3 | 0.57x | 1.77 | 0.73x |
| V | Matt Pocock | 82.85 | -2.84 | 11.1 | 0.87x | 2.21 | 0.91x |
| AN | BenchKeeper setup-v4.0 + Matt Pocock, no Ponytail | 82.85 | -2.84 | 13.9 | 1.09x | 2.39 | 0.99x |

- How to read score differences: one arm's score varies by up to 7 points between rounds (AN: 60.21 to 91.39, A: 85.21 to 89.93). With 3 rounds, a median difference below about 3 points is not measurable, so the arms from 85.21 to 86.18 count as equal in quality.
- Weighing cost against score: at equal quality, the cheaper and faster setup is the better choice. A setup that costs 2 or 4 times as much and scores 1 point higher has not shown a quality gain, only a cost increase. Paying more needs a score gain beyond the spread: the win rule set before the run asks for a median at least 3 points higher and a lead in at least 2 of 3 rounds. No arm meets it.
- By that rule, AH and AD give the quality of plain Claude Code for about 30% less cost and 40% less time. AH is the most consistent arm (85.69 to 86.67).
- setup-v5.0 (AM) against setup-v3.3 (AH): +0.42 median, inside the spread, for 2.2 times the cost and 2.2 times the time. AM writes about twice the output tokens per trial (78,000 to 95,000 against 43,000 to 48,000) and called the `code-review` skill in 2 of 3 rounds (cause of the extra tokens not checked further). On this brief, the setup-v5.0 changes add cost and time without a measurable gain.
- Without Ponytail (AN), the setup took 1.7 times AH's time and 1.4 times its cost, with a lower median and one failed round. No arm with setup-v4.0 and Ponytail ran on this brief, so this is not a controlled Ponytail comparison.
- On a subscription the cost is not billed per trial, so minutes per change and the share of the usage window are the costs that remain.

## Verdict

- Win rule (set before the run): AD or AE wins when its median is at least 3 above the best median of V, AB and A, and it leads in at least 2 of 3 paired rounds.
- No layer arm wins. The best baseline median is 85.69 (A and AB, tied). AD reaches 85.21 and leads in round 3 only. AE reaches 82.85 and leads in no round.
- Added arms (same rule, applied after their runs): AM 86.18, AH 85.76 and AN 82.85 each lead the best baseline in 1 of 3 rounds, and none is 3 above it. None wins.
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
| AH | BenchKeeper setup-v3.3 + Matt Pocock | 85.76 | 85.76 | 85.69 | 86.67 | 8.1 | 1.66 |
| AM | BenchKeeper setup-v5.0 + Matt Pocock | 86.18 | 87.57 | 85.69 | 86.18 | 17.7 | 3.70 |
| AN | BenchKeeper setup-v4.0 + Matt Pocock, no Ponytail | 82.85 | 60.21 | 91.39 | 82.85 | 13.9 | 2.39 |

Cost is the API-equivalent figure the agent reports. The trials ran on a subscription.

## Key findings

- AD is the fastest and cheapest arm that finished every step: median 7.6 minutes and 1.77 USD, against 11.1 to 12.8 minutes and 2.21 to 2.58 USD for V, AB and A. It passes all 6 cross-step checks (changelog and version on each change) in 2 of 3 rounds. No other arm does so in more than 1 round.
- AE round 3 stalled in step 2. The agent wrote and validated an OpenSpec change (proposal, spec, design, tasks), left it uncommitted and ended the session with "say 'apply' and I'll implement it". Step 3 found no compare view to fix. The arm's skill has the line "Non-interactive runs (headless, CI): a skill's approval gate or a phase boundary is not a stop" (checked in the built image). The agent followed the OpenSpec propose flow's stop instead. Both reviews rate it 2 overall.
- Step 1 fails most often on the same three checks in every arm: actions pinned to commit SHAs, explicit workflow permissions, and a ref guard on the Pages deploy for `workflow_dispatch`. AD and AE miss the SHA pins in all 3 rounds, V in all 3, AB in 2, A in 1.
- Review (Claude Opus 5.5, 9 criteria from 1 to 5, mean of 6 reviews per arm): CI setup is the lowest criterion for every arm (A 3.8, AB 3.3, AD 3.0, AE 3.0, V 2.8). AD rates highest on requirements (5.0) and cross-step discipline (5.0).
- AN round 1 left a type error in step 2 (`svelte-check`: an iterator over a value that can be null), so the build and all step 2 checks failed. Its rounds 2 and 3 scored 91.39 and 82.85.
- AH, AM and AN miss the same step 1 hardening checks as the other arms: AH the SHA pins and permissions in all 3 rounds, AM the Pages ref guard in all 3, AN the SHA pins in all 3.
- All 24 trials end every step with the test suite green (suite 10 of 10).

## Method

- Protocol `bench/PROTOCOL.md` 1.17. Brief `bench/briefs/openballistics/`. Seed 71, timeout 5400 s per step, Claude Code on Sonnet 5.5, effort high, `PHASES=1`.
- Each step runs in a new session on the repository state the previous step left. A step's checks run after it ends (`bench/briefs/openballistics/checks/`).
- Two runners on two subscription seats took arms from the same round order (round 1: AB, AD, A, V, AE) and skipped arms the other runner held. AH (2026-10-18) and AN with AM (2026-10-19) ran later on one runner each, with Claude Code 2.1.299 like the first run, the same baseline commit and the same hidden checks (hash `a6d1d4e1139bb268`). Images and commits: `manifest.txt`.
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
| 1 | AH | 85.76 | 35.63 | 30.14 | 10 | 10 | 19/24 | 6/6 | 8, 8 | 8.1 |
| 2 | AH | 85.69 | 39.38 | 29.65 | 10 | 6.67 | 21/24 | 4/6 | 8, 7 | 8.1 |
| 3 | AH | 86.67 | 39.38 | 30.63 | 10 | 6.67 | 21/24 | 4/6 | 8, 8 | 7.6 |
| 1 | AM | 87.57 | 39.38 | 28.19 | 10 | 10 | 21/24 | 6/6 | 7, 8 | 19.3 |
| 2 | AM | 85.69 | 39.38 | 29.65 | 10 | 6.67 | 21/24 | 4/6 | 8, 8 | 17.7 |
| 3 | AM | 86.18 | 39.38 | 30.14 | 10 | 6.67 | 21/24 | 4/6 | 7, 8 | 14.9 |
| 1 | AN | 60.21 | 20.63 | 26.25 | 10 | 3.33 | 11/24 | 2/6 | 6, 7 | 14.0 |
| 2 | AN | 91.39 | 41.25 | 30.14 | 10 | 10 | 22/24 | 6/6 | 8, 8 | 11.8 |
| 3 | AN | 82.85 | 37.50 | 28.68 | 10 | 6.67 | 20/24 | 4/6 | 7, 7 | 13.9 |

## Data

`bench/results/2026-10-17-openballistics-sonnet/`: `manifest.txt`, `brownfield-score.json`, and per trial `trial.json` (steps, checks, minutes, cost), the transcript, the final repository (`app.tar.gz`), screenshots and both reviews.
