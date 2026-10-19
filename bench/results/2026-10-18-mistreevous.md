# Mistreevous brief: results on Sonnet 5.5

Brief: an existing TypeScript library (nikkorn/mistreevous, behaviour trees) gets one feature in three separate sessions. Step 1 adds `snapshot()` and `restore()` of a tree's execution state (the repository's open issue #120). Step 2 makes restore check that the snapshot fits the tree and restart a pending action. Step 3 fixes two reported bugs. 10 Claude Code arms on Sonnet 5.5, effort high, 3 rounds each (k = 3), run 2026-10-18. Descriptive only, no significance tests.

- A: plain Claude Code. B: Ponytail. F: agent-skills. G: Superpowers. H: ECC. V: Matt Pocock's skills. AF: Matt Pocock's skills with Ponytail. AB: OpenSpec. AC: Spec Kit.
- AL: BenchKeeper setup-v4.0 (rules, `following-dev-workflow`, Matt Pocock's skills, Ponytail; layer v6).
- Brownfield score: 0 to 100 (section "Method").

## Verdict

- No win rule was set before this run.
- H (ECC) has the highest median, 90.12, then F (agent-skills) 89.73 and G (Superpowers) 89.31. Spread within one arm reaches about 8 points (B: 79.6 to 88.0), so medians within about 3 points are not separable at k = 3.
- The three arms with Ponytail have the lowest medians: AL 84.08, AF 84.63 and B 87.58. They are also the fastest and cheapest (median 12.8 to 13.3 minutes, 2.01 to 2.28 USD, against 20.1 to 35.3 minutes and 3.53 to 7.52 USD for the others).
- AL (setup-v4.0) is last. Its rule "no host fallback without a devcontainer" made it stop or skip tests in 3 of 9 steps (Key findings). setup-v5.0 replaces that rule: without a devcontainer the agent creates one, or runs on the host when no container engine exists.

## Scores

| Arm | Setup | Median | Round 1 | Round 2 | Round 3 | Minutes (median) | Cost, USD (median) |
|---|---|---|---|---|---|---|---|
| H | ECC | 90.12 | 90.12 | 87.62 | 91.64 | 35.3 | 7.52 |
| F | agent-skills | 89.73 | 89.73 | 87.97 | 90.48 | 28.7 | 4.87 |
| G | Superpowers | 89.31 | 85.83 | 89.31 | 92.82 | 20.1 | 3.53 |
| AB | OpenSpec | 88.37 | 88.72 | 87.78 | 88.37 | 31.1 | 4.13 |
| AC | Spec Kit | 87.94 | 87.94 | 87.39 | 89.15 | 24.6 | 3.72 |
| B | Ponytail | 87.58 | 79.56 | 87.97 | 87.58 | 13.3 | 2.17 |
| V | Matt Pocock | 87.22 | 87.22 | 84.86 | 91.26 | 22.6 | 3.73 |
| A | plain Claude Code | 86.97 | 91.48 | 86.61 | 86.97 | 22.7 | 3.76 |
| AF | Matt Pocock + Ponytail | 84.63 | 83.82 | 87.74 | 84.63 | 12.8 | 2.01 |
| AL | BenchKeeper setup-v4.0 + Matt Pocock | 84.08 | 87.16 | 79.34 | 84.08 | 13.1 | 2.28 |

Cost is the API-equivalent figure the agent reports. The trials ran on a subscription. Minutes are the agent's time summed over the steps. The Pages site shows wall time, which includes the checks.

## Key findings

- The hidden tests do not separate the arms: 28 of 30 trials pass all 17 hidden checks. B and AF round 1 miss `S2-equivalent` (MDSL and JSON definitions of the same tree) and so `S3-regressions`. Every trial ends with the suite green in every step except AL round 2, step 2.
- The review and the process checks decide the order. Review part, mean of 3 rounds (of 25): AB 23.2, AC 23.1, F 22.9, V 22.9, A 22.8, H 22.7, G 22.1, B 21.1, AL 20.2, AF 19.8.
- Arms with Ponytail rate lower on validation, tests and correctness (Claude Opus 5.5, mean of 6 reviews, 1 to 5): validation AF 3.8, B 4.2, AL 4.3, all others 4.8 to 5.0. Tests AF 4.0, AL 4.0, B 4.5, all others 4.8 to 5.0. Overall (1 to 10) AF 7.5, AL 7.7, B 8.0, all others 8.3 to 8.8.
- AL round 2 ended step 2 with `npm test` failing: its MDSL and JSON equivalence fixtures used `root [main]`, which the validator rejects. Step 3 repaired them inside an unrelated test commit. Both reviews name this as the main issue.
- AL did not run a test, build or lint command after its last source edit in 3 of 9 steps. Every other arm did so in 9 of 9. In two of those steps the last tool call looked for a devcontainer (`which docker podman devcontainer`). The setup-v4.0 rule forbids host installs and tests without one.
- Skills called (steps that called the skill, of 9 per arm): AL `benchkeeper:following-dev-workflow` 9 and `code-review` 1. G `superpowers:test-driven-development` 8, `brainstorming` 3, `systematic-debugging` 3, `writing-plans` 1. V `mattpocock-skills:tdd` 1 and `code-review` 1. A, AB and AC `code-review` (2, 1, 1). B, F, H and AF called none. The OpenSpec and Spec Kit arms never ran their spec tools.
- Plan before the first source edit (steps 1 and 2, of 6): G 4, V 1, AF 1, all others 0. AL's workflow skill plans in the reply, which the process check does not count (Limitations in the protocol).
- Version History row and package version (`history`): the most missed static check in every arm (3 to 6 of 9 steps).

## Follow-up rule and reruns

- AL rounds 2 and 3 first stopped in step 1 with a message asking the user to run `/benchkeeper:setting-up-projects` or allow host tests. The follow-up rule did not fire: the ask was not in the last 5 lines.
- The rule now matches its phrases on any line of the final message and, in step briefs, fires on a turn that leaves the repository unchanged (protocol 1.21). Replayed over every final message of the 30 trials, the change affects only those AL trials. Both were rerun on the same image. The stopped attempts stay in the run directory under `superseded/` and are not published.

## Method

- Protocol `bench/PROTOCOL.md` 1.21. Brief `bench/briefs/mistreevous/`. Seed 83, Claude Code on Sonnet 5.5, effort high.
- Each step runs in a new session on the repository state the previous step left. A step's checks run after it ends.
- Brownfield score (`bench/scripts/brownfield-score.mjs` with the `score` block of `brief.json`):
  - Hidden checks, 35: 17 checks over the three steps (mocha, public API only).
  - Suite, 10: steps that end with `npm test` green, out of 3.
  - Static checks, 15: 20 checks (tests added, tests intact, dependencies unchanged, README, Version History, committed, erosion).
  - Process checks, 15: 11 checks from each step's workflow trace (plan first, tests first, review, verified).
  - Review, 25: Claude Opus 5.5 rates 8 criteria from 1 to 5, twice per trial.
  - Minutes, cost and skills are reported, not scored.

## Per-trial results

| Round | Arm | Total | Hidden (35) | Suite (10) | Static (15) | Process (15) | Review (25) | Hidden checks | Static checks | Process checks | Review overall (2 reviews) | Minutes | Cost, USD |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A | 91.48 | 35 | 10 | 13.5 | 9.55 | 23.44 | 17/17 | 18/20 | 7/11 | 9, 9 | 26.1 | 4.39 |
| 1 | AB | 88.72 | 35 | 10 | 14.25 | 6.82 | 22.66 | 17/17 | 19/20 | 5/11 | 9, 8 | 31.1 | 5.15 |
| 1 | AC | 87.94 | 35 | 10 | 14.25 | 6.82 | 21.88 | 17/17 | 19/20 | 5/11 | 8, 8 | 22.1 | 3.72 |
| 1 | AF | 83.82 | 30.88 | 10 | 14.25 | 9.55 | 19.14 | 15/17 | 19/20 | 7/11 | 7, 7 | 12 | 2.01 |
| 1 | AL | 87.16 | 35 | 10 | 14.25 | 6.82 | 21.09 | 17/17 | 19/20 | 5/11 | 9, 8 | 14.5 | 2.75 |
| 1 | B | 79.56 | 30.88 | 10 | 13.5 | 6.82 | 18.36 | 15/17 | 18/20 | 5/11 | 7, 7 | 13.3 | 2.19 |
| 1 | F | 89.73 | 35 | 10 | 13.5 | 8.18 | 23.05 | 17/17 | 18/20 | 6/11 | 9, 8 | 27.1 | 4.58 |
| 1 | G | 85.83 | 35 | 10 | 13.5 | 5.45 | 21.88 | 17/17 | 18/20 | 4/11 | 9, 8 | 20.1 | 3.47 |
| 1 | H | 90.12 | 35 | 10 | 13.5 | 8.18 | 23.44 | 17/17 | 18/20 | 6/11 | 9, 8 | 29.8 | 6.25 |
| 1 | V | 87.22 | 35 | 10 | 12.75 | 6.82 | 22.66 | 17/17 | 17/20 | 5/11 | 9, 9 | 20.5 | 3.68 |
| 2 | A | 86.61 | 35 | 10 | 13.5 | 5.45 | 22.66 | 17/17 | 18/20 | 4/11 | 9, 9 | 22.7 | 3.76 |
| 2 | AB | 87.78 | 35 | 10 | 13.5 | 5.45 | 23.83 | 17/17 | 18/20 | 4/11 | 9, 9 | 24.3 | 3.71 |
| 2 | AC | 87.39 | 35 | 10 | 13.5 | 5.45 | 23.44 | 17/17 | 18/20 | 4/11 | 9, 9 | 25.2 | 3.92 |
| 2 | AF | 87.74 | 35 | 10 | 14.25 | 8.18 | 20.31 | 17/17 | 19/20 | 6/11 | 8, 8 | 20.3 | 2.35 |
| 2 | AL | 79.34 | 35 | 6.67 | 14.25 | 5.45 | 17.97 | 17/17 | 19/20 | 4/11 | 7, 6 | 12.3 | 2.28 |
| 2 | B | 87.97 | 35 | 10 | 13.5 | 6.82 | 22.66 | 17/17 | 18/20 | 5/11 | 9, 9 | 12.3 | 2.1 |
| 2 | F | 87.97 | 35 | 10 | 13.5 | 6.82 | 22.66 | 17/17 | 18/20 | 5/11 | 9, 8 | 28.7 | 5.08 |
| 2 | G | 89.31 | 35 | 10 | 14.25 | 8.18 | 21.88 | 17/17 | 19/20 | 6/11 | 8, 8 | 19.8 | 3.53 |
| 2 | H | 87.62 | 35 | 10 | 12.75 | 6.82 | 23.05 | 17/17 | 17/20 | 5/11 | 9, 8 | 35.3 | 7.52 |
| 2 | V | 84.86 | 35 | 10 | 13.5 | 4.09 | 22.27 | 17/17 | 18/20 | 3/11 | 8, 9 | 22.6 | 3.73 |
| 3 | A | 86.97 | 35 | 10 | 14.25 | 5.45 | 22.27 | 17/17 | 19/20 | 4/11 | 8, 9 | 22.4 | 3.17 |
| 3 | AB | 88.37 | 35 | 10 | 13.5 | 6.82 | 23.05 | 17/17 | 18/20 | 5/11 | 8, 9 | 33.1 | 4.13 |
| 3 | AC | 89.15 | 35 | 10 | 13.5 | 6.82 | 23.83 | 17/17 | 18/20 | 5/11 | 9, 9 | 24.6 | 3.19 |
| 3 | AF | 84.63 | 35 | 10 | 14.25 | 5.45 | 19.92 | 17/17 | 19/20 | 4/11 | 8, 7 | 12.8 | 1.89 |
| 3 | AL | 84.08 | 35 | 10 | 13.5 | 4.09 | 21.48 | 17/17 | 18/20 | 3/11 | 8, 8 | 13.1 | 2.2 |
| 3 | B | 87.58 | 35 | 10 | 13.5 | 6.82 | 22.27 | 17/17 | 18/20 | 5/11 | 8, 8 | 17 | 2.17 |
| 3 | F | 90.48 | 35 | 10 | 14.25 | 8.18 | 23.05 | 17/17 | 19/20 | 6/11 | 9, 9 | 35.4 | 4.87 |
| 3 | G | 92.82 | 35 | 10 | 14.25 | 10.91 | 22.66 | 17/17 | 19/20 | 8/11 | 9, 8 | 24 | 3.92 |
| 3 | H | 91.64 | 35 | 10 | 14.25 | 10.91 | 21.48 | 17/17 | 19/20 | 8/11 | 8, 9 | 46.8 | 8.64 |
| 3 | V | 91.26 | 35 | 10 | 14.25 | 8.18 | 23.83 | 17/17 | 19/20 | 6/11 | 9, 9 | 32.4 | 5.01 |
