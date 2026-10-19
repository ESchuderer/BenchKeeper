# Mistreevous brief: results on opusplan

Brief: as in [2026-10-18-mistreevous.md](2026-10-18-mistreevous.md). 2 Claude Code arms with the model setting `opusplan` (Opus 5.5 in plan mode, Sonnet 5.5 otherwise), effort high, 3 rounds each (k = 3), seed 101, run 2026-10-19. Descriptive only, no significance tests.

- A: plain Claude Code. AM: BenchKeeper setup-v5.0 (rules, `following-dev-workflow`, Matt Pocock's skills, Ponytail; layer v7).
- Brownfield score: 0 to 100, same weights as the Sonnet run (hidden 35, review 25, static 15, process 15, suite 10).

## Cost, quality and time

| Run | Arm | Score (median) | Minutes (median) | Cost, USD (median) |
|---|---|---|---|---|
| opusplan, seed 101 | AM | 90.34 | 26.4 | 6.26 |
| opusplan, seed 101 | A | 86.61 | 19.4 | 3.32 |
| Sonnet 5.5, seed 83 | AM | 88.98 | 24.9 | 4.79 |
| Sonnet 5.5, seed 83 | A | 86.97 | 22.7 | 3.76 |

- No trial entered plan mode, so the main loop ran on Sonnet 5.5 in all 6 trials. A used no Opus. AM's general-purpose and Explore subagents ran on Opus in steps 1 and 2: 1.63 to 2.28 USD per trial, 29 to 35% of its cost.
- AM against A in this run: +3.73 points, ahead in 2 of 3 rounds, at 1.89 times the cost and 1.36 times the time. The difference comes from the process checks (AM 9.55 of 15 in every round, A 5.45 to 6.82). The review parts are close (AM 20.31 to 23.05, A 21.88 to 23.05).
- AM on opusplan against AM on Sonnet: +1.36 points at 1.31 times the cost and 1.06 times the time. The spread within one arm reaches about 8 points in the Sonnet run, so this difference is not measurable at k = 3. The seeds differ (101 and 83).
- A on opusplan against A on Sonnet: -0.36 points. A ran on Sonnet in both runs, so this is the seed-to-seed difference.
- In this setup (no plan mode, skip permissions), `opusplan` adds cost through Opus subagents and no measurable score gain over Sonnet 5.5.

## Key findings

- All 6 trials pass all 17 hidden checks and end every step with the suite green.
- Skills called: AM called `benchkeeper:following-dev-workflow` 3 times per trial (once per step), `mattpocock-skills:code-review` twice and `code-review` once in every round, and `mattpocock-skills:tdd` once in round 3. A called no skill.
- Subagents: AM spawned 4 per trial (general-purpose, and Explore in rounds 1 and 3). Round 2 set `model: sonnet` on 2 of them. A spawned none.
- Review overall (Claude Opus 5.5, 1 to 10, 2 reviews per trial): AM 9, 8 / 9, 8 / 8, 8. A 9, 8 / 8, 8 / 8, 9.

## Method

- Protocol `bench/PROTOCOL.md` 1.21, brief `bench/briefs/mistreevous/`, seed 101, Claude Code with `--model opusplan`, effort high, BenchKeeper commit 0ffaba8.
- Scoring, reviews and checks as in the Sonnet run (`bench/scripts/brownfield-score.mjs`, `bench/review/review.sh`).
- Opus share: `modelUsage` in each step's result message.
- Minutes, cost and skills are reported, not scored. Cost is the API-equivalent figure the agent reports; the trials ran on a subscription.

## Per-trial results

| Round | Arm | Total | Hidden (35) | Suite (10) | Static (15) | Process (15) | Review (25) | Review overall (2 reviews) | Minutes | Cost, USD | Opus, USD |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A | 86.61 | 35 | 10 | 13.5 | 5.45 | 22.66 | 9, 8 | 19.4 | 3.32 | 0 |
| 1 | AM | 91.84 | 35 | 10 | 14.25 | 9.55 | 23.05 | 9, 8 | 26.4 | 6.26 | 2.23 |
| 2 | A | 85.83 | 35 | 10 | 13.5 | 5.45 | 21.88 | 8, 8 | 20.9 | 3.75 | 0 |
| 2 | AM | 90.34 | 35 | 10 | 12.75 | 9.55 | 23.05 | 9, 8 | 24.3 | 5.72 | 1.63 |
| 3 | A | 89.12 | 35 | 10 | 14.25 | 6.82 | 23.05 | 8, 9 | 18.7 | 3.10 | 0 |
| 3 | AM | 88.36 | 35 | 10 | 13.5 | 9.55 | 20.31 | 8, 8 | 26.7 | 6.44 | 2.28 |
