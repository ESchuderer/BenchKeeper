# Cartridges brief: Claude Code and OpenCode on Haiku 5.5 and Sonnet 5.5

Runs 2026-10-15 to 2026-10-16. One trial per arm and model, 58 trials: descriptive only, no significance tests. Full method: `bench/PROTOCOL.md`, section "Cartridges brief".

## Setup

| Item | Value |
|---|---|
| Brief | `bench/briefs/cartridges/brief.md`: a static reference database of 25 C.I.P. cartridges with a list, search and family filter, a detail view, a computed 2D drawing (outside view and section, dimensions, title block) and a one-page print view |
| Hidden tests | C1 to C6 (`bench/briefs/cartridges/hidden/`, hash `5c9d25395e3b332c`): list, search and filter, detail values, drawing, print, data loading. Validated against a reference app, a variant and mutants (`validate.sh`) |
| Claude Code arms | 22 (A to P, V to Y, AB, AC), Claude Code 2.1.299, effort `high`, subscription (Team seats) |
| OpenCode arms | 7 (Q to U, Z, AA), OpenCode 1.19.0, variant `high`, Anthropic API key |
| Review | blind, `claude-opus-5-5`, effort `high`, the brief's prompt `bench/briefs/cartridges/review.md`, 13 criteria, subscription |
| Testing method | agent runs under protocol 1.12, parsed under protocol 1.14, BenchKeeper layer v1. Final score, static scan and the added measures on all 58 apps; drawing review and mutation score on the final-score top 10 and plain Claude Code (section "Final score") |
| Seed | 41 (arm order and image IDs in the run manifests) |

## Results

USD is the API-equivalent cost of the trial transcript (subscription trials are not billed per token). Overall is the review's 1 to 10 rating.

### Claude Code, Sonnet 5.5

| Arm | Setup | Features | Follow-ups | Minutes | USD | Overall | Req. | Correct. | Security | Code | Tests | UX | A11y | Simple | Maint. | Visual | Layout | Usability | Reception |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | plain | 6/6 | 0 | 32 | 5.02 | 7 | 4 | 4 | 5 | 4 | 4 | 4 | 3 | 4 | 3 | 4 | 3 | 4 | 4 |
| B | Ponytail | 6/6 | 0 | 28 | 2.75 | 6 | 4 | 4 | 5 | 4 | 4 | 3 | 4 | 5 | 2 | 3 | 3 | 4 | 3 |
| C | BK + agent-skills + OpenSpec | 6/6 | 0 | 31 | 4.99 | 6 | 4 | 4 | 5 | 3 | 4 | 3 | 4 | 4 | 2 | 3 | 3 | 4 | 3 |
| D | BK + Superpowers + OpenSpec | 6/6 | 0 | 48 | 6.67 | 7 | 4 | 4 | 5 | 4 | 4 | 3 | 4 | 5 | 2 | 3 | 3 | 4 | 4 |
| E | BK + ECC + OpenSpec | 6/6 | 0 | 42 | 5.41 | 7 | 4 | 4 | 5 | 4 | 4 | 3 | 4 | 4 | 3 | 4 | 3 | 4 | 4 |
| F | agent-skills | 6/6 | 1 | 40 | 5.97 | 8 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 4 | 3 | 4 | 3 | 4 | 4 |
| G | Superpowers | 6/6 | 0 | 41 | 7.42 | 8 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 5 | 3 | 4 | 4 | 4 | 4 |
| H | ECC | 6/6 | 0 | 39 | 7.56 | 8 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 4 |
| I | agent-skills + OpenSpec | 6/6 | 1 | 39 | 7.23 | 8 | 4 | 4 | 5 | 4 | 5 | 3 | 4 | 4 | 3 | 3 | 4 | 4 | 4 |
| J | Superpowers + OpenSpec | 5/6 | 0 | 41 | 7.52 | 8 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 4 | 3 | 4 | 3 | 4 | 4 |
| K | ECC + OpenSpec | 2/6 | 0 | 42 | 11.15 | 8 | 4 | 4 | 5 | 4 | 5 | 4 | 5 | 4 | 3 | 4 | 4 | 4 | 4 |
| L | BK + agent-skills | 6/6 | 0 | 33 | 5.49 | 8 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 5 | 3 | 4 | 4 | 4 | 4 |
| M | BK + Superpowers | 6/6 | 0 | 47 | 5.76 | 7 | 4 | 4 | 5 | 3 | 4 | 3 | 4 | 5 | 2 | 3 | 3 | 4 | 4 |
| N | BK + ECC | 6/6 | 0 | 37 | 6.04 | 7 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 5 | 2 | 4 | 4 | 4 | 4 |
| O | Ponytail + OpenSpec | 6/6 | 1 | 33 | 5.58 | 8 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 5 | 3 | 4 | 4 | 4 | 4 |
| P | Ponytail + Spec Kit | 6/6 | 0 | 38 | 7.00 | 7 | 4 | 4 | 5 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 4 | 4 | 4 |
| V | Matt Pocock | 6/6 | 1 | 26 | 4.48 | 6 | 4 | 4 | 5 | 4 | 5 | 3 | 4 | 5 | 3 | 3 | 3 | 4 | 3 |
| W | Matt Pocock + OpenSpec | 6/6 | 1 | 58 | 7.80 | 8 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 5 | 3 | 4 | 4 | 5 | 4 |
| X | BK + Matt Pocock | 6/6 | 0 | 25 | 4.23 | 8 | 4 | 4 | 5 | 4 | 4 | 4 | 4 | 5 | 2 | 4 | 4 | 4 | 4 |
| Y | BK + Matt Pocock + OpenSpec | 6/6 | 0 | 31 | 4.97 | 8 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 5 | 2 | 4 | 4 | 4 | 4 |
| AB | OpenSpec | 6/6 | 0 | 38 | 6.20 | 8 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 4 | 3 | 4 | 4 | 5 | 4 |
| AC | Spec Kit | 6/6 | 0 | 47 | 8.84 | 8 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 |

### OpenCode, Sonnet 5.5

| Arm | Setup | Features | Follow-ups | Minutes | USD | Overall | Req. | Correct. | Security | Code | Tests | UX | A11y | Simple | Maint. | Visual | Layout | Usability | Reception |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q | OpenSpec + targeted skills | 6/6 | 2 | 25 | 4.13 | 8 | 4 | 4 | 5 | 4 | 5 | 4 | 3 | 5 | 3 | 4 | 4 | 4 | 4 |
| R | Superpowers | 6/6 | 1 | 38 | 5.33 | 7 | 4 | 4 | 5 | 4 | 4 | 3 | 4 | 4 | 2 | 4 | 3 | 4 | 4 |
| S | OpenSpec + Superpowers (oso) | 6/6 | 2 | 30 | 5.24 | 8 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 4 |
| T | agent-skills | 6/6 | 1 | 33 | 6.07 | 7 | 4 | 4 | 5 | 4 | 5 | 3 | 4 | 4 | 3 | 4 | 4 | 4 | 4 |
| U | agent-skills + OpenSpec | 6/6 | 2 | 28 | 4.16 | 8 | 4 | 4 | 5 | 4 | 4 | 4 | 4 | 5 | 2 | 4 | 4 | 4 | 4 |
| Z | Matt Pocock | 6/6 | 1 | 41 | 5.82 | 8 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 4 |
| AA | Matt Pocock + OpenSpec | 2/6 | 1 | 32 | 5.65 | 5 | 3 | 3 | 5 | 4 | 4 | 2 | 4 | 4 | 3 | 3 | 3 | 3 | 2 |

### Claude Code, Haiku 5.5

| Arm | Setup | Features | Follow-ups | Minutes | USD | Overall | Req. | Correct. | Security | Code | Tests | UX | A11y | Simple | Maint. | Visual | Layout | Usability | Reception |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | plain | 6/6 | 0 | 21 | 1.95 | 7 | 4 | 4 | 5 | 4 | 4 | 3 | 4 | 5 | 3 | 4 | 3 | 4 | 4 |
| B | Ponytail | 6/6 | 0 | 36 | 1.78 | 5 | 3 | 3 | 5 | 4 | 4 | 2 | 4 | 5 | 2 | 2 | 3 | 4 | 3 |
| C | BK + agent-skills + OpenSpec | 6/6 | 0 | 28 | 2.17 | 6 | 4 | 4 | 5 | 4 | 4 | 3 | 3 | 5 | 2 | 3 | 3 | 4 | 3 |
| D | BK + Superpowers + OpenSpec | 6/6 | 1 | 25 | 2.82 | 6 | 3 | 3 | 5 | 4 | 4 | 3 | 4 | 5 | 2 | 3 | 3 | 4 | 3 |
| E | BK + ECC + OpenSpec | 6/6 | 0 | 28 | 3.62 | 5 | 3 | 3 | 4 | 4 | 4 | 3 | 4 | 4 | 2 | 3 | 3 | 4 | 3 |
| F | agent-skills | 6/6 | 0 | 27 | 2.70 | 6 | 3 | 3 | 5 | 4 | 4 | 3 | 4 | 5 | 3 | 3 | 3 | 4 | 3 |
| G | Superpowers | 6/6 | 0 | 20 | 1.55 | 6 | 3 | 3 | 4 | 4 | 4 | 3 | 4 | 5 | 3 | 3 | 3 | 4 | 3 |
| H | ECC | 6/6 | 0 | 21 | 1.74 | 6 | 4 | 3 | 5 | 4 | 4 | 3 | 4 | 5 | 2 | 3 | 3 | 4 | 3 |
| I | agent-skills + OpenSpec | 5/6 | 0 | 17 | 1.28 | 6 | 4 | 3 | 5 | 4 | 3 | 3 | 4 | 5 | 2 | 3 | 3 | 4 | 3 |
| J | Superpowers + OpenSpec | 6/6 | 0 | 29 | 3.46 | 6 | 3 | 3 | 5 | 4 | 4 | 3 | 4 | 4 | 3 | 3 | 3 | 4 | 3 |
| K | ECC + OpenSpec | 6/6 | 0 | 27 | 3.54 | 6 | 3 | 3 | 5 | 4 | 4 | 3 | 4 | 4 | 3 | 3 | 3 | 4 | 3 |
| L | BK + agent-skills | 6/6 | 0 | 28 | 1.42 | 6 | 3 | 4 | 5 | 4 | 3 | 3 | 4 | 5 | 2 | 3 | 3 | 4 | 3 |
| M | BK + Superpowers | 6/6 | 0 | 34 | 3.41 | 6 | 3 | 4 | 4 | 4 | 3 | 3 | 4 | 4 | 2 | 3 | 2 | 4 | 3 |
| N | BK + ECC | 6/6 | 0 | 25 | 3.23 | 6 | 3 | 3 | 5 | 4 | 3 | 3 | 4 | 5 | 2 | 3 | 3 | 4 | 3 |
| O | Ponytail + OpenSpec | 6/6 | 0 | 33 | 3.29 | 6 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 5 | 2 | 3 | 3 | 4 | 3 |
| P | Ponytail + Spec Kit | 6/6 | 0 | 31 | 2.72 | 6 | 3 | 4 | 5 | 4 | 4 | 3 | 4 | 4 | 3 | 3 | 3 | 4 | 3 |
| V | Matt Pocock | 6/6 | 0 | 23 | 2.27 | 7 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 5 | 3 | 3 | 4 | 4 | 4 |
| W | Matt Pocock + OpenSpec | 6/6 | 0 | 28 | 3.12 | 7 | 3 | 3 | 5 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 3 | 4 | 4 |
| X | BK + Matt Pocock | 6/6 | 0 | 28 | 2.22 | 6 | 4 | 3 | 5 | 4 | 4 | 3 | 4 | 5 | 2 | 3 | 3 | 4 | 3 |
| Y | BK + Matt Pocock + OpenSpec | 6/6 | 0 | 29 | 2.81 | 6 | 3 | 4 | 5 | 4 | 4 | 3 | 4 | 5 | 2 | 3 | 3 | 4 | 3 |
| AB | OpenSpec | 6/6 | 0 | 27 | 3.65 | 6 | 4 | 4 | 5 | 4 | 4 | 3 | 4 | 4 | 2 | 3 | 3 | 4 | 3 |
| AC | Spec Kit | 6/6 | 0 | 23 | 1.88 | 7 | 4 | 4 | 4 | 4 | 3 | 3 | 4 | 5 | 3 | 4 | 3 | 4 | 4 |

### OpenCode, Haiku 5.5

| Arm | Setup | Features | Follow-ups | Minutes | USD | Overall | Req. | Correct. | Security | Code | Tests | UX | A11y | Simple | Maint. | Visual | Layout | Usability | Reception |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q | OpenSpec + targeted skills | 0/6 | 2 | 11 | 0.39 | 1 | 1 | 1 | 2 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| R | Superpowers | 6/6 | 2 | 40 | 2.00 | 7 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 2 | 4 | 3 | 4 | 4 |
| S | OpenSpec + Superpowers (oso) | 0/6 | 2 | 7 | 0.15 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| T | agent-skills | 0/6 | 2 | 15 | 0.79 | 1 | 1 | 1 | 3 | 3 | 2 | 1 | 1 | 3 | 2 | 1 | 1 | 1 | 1 |
| U | agent-skills + OpenSpec | 6/6 | 2 | 31 | 3.25 | 6 | 3 | 4 | 5 | 4 | 4 | 3 | 4 | 4 | 2 | 3 | 3 | 4 | 3 |
| Z | Matt Pocock | 6/6 | 2 | 44 | 3.13 | 6 | 3 | 4 | 5 | 4 | 4 | 3 | 4 | 5 | 2 | 3 | 3 | 4 | 3 |
| AA | Matt Pocock + OpenSpec | 6/6 | 2 | 68 | 3.44 | 7 | 4 | 4 | 5 | 4 | 4 | 3 | 4 | 5 | 2 | 4 | 4 | 4 | 4 |

## Final score

One score out of 100 per app, from six categories weighted by importance (`bench/scripts/final-score.mjs`, weights in `bench/scripts/final-score.weights.json`). Each input is normalized to 0 to 100: shares in percent as they are, review criteria (1 to 5) linearly, counts per 1,000 lines against a cap (0 findings is 100, the cap or more is 0). An input without data scores 0. Ranked across both models, ties to fewer minutes. One trial per arm: totals within about 2 points are not separable.

| Category | Weight | Inputs (weight) |
|---|---|---|
| Correctness | 35 | hidden features (20), print pass (5), review requirements correctness (10) |
| Code quality | 20 | review quality (8), erosion (4), type errors (2), sonar bugs (2), lint (2), duplication (2) |
| Tests | 15 | line coverage (10), review tests (5) |
| Security | 10 | security findings (5), review security (5) |
| UX and accessibility | 10 | review ux (4), axe violations (3), lighthouse accessibility (1), lighthouse performance (1), html errors (1) |
| Documentation | 10 | readme coverage (2.5), readme accuracy (2.5), doc functions (1), doc exports (1), comment density (1), decision records (1), maintenance flags (1) |

Measures added for this score, run on all 58 apps (`bench/scorer/`): type errors (TypeScript 6.0.3, `checkJs`, `strict` off), line coverage of the app's own unit tests (c8 12.0.0), print check (Playwright 1.64.0: each of the 25 cartridges on one A4 page, drawing at 80% of the printable width or more), HTML validity (Nu HTML Checker 26.10.12), documentation (README coverage of six topics and accuracy of its commands and paths, documented functions, comment density, decision records), and the static scan (ESLint 9.39.5 with SonarJS 4.2.2 and security 4.2.0 rules; security without `security/detect-object-injection` and `sonarjs/no-clear-text-protocols`, which flag ordinary lookups and the SVG namespace URL). Axe, Lighthouse and the maintenance flags come from the scorer's existing run.

Inputs with nearly the same value for every app, so they add points but hardly separate apps: hidden features (51 of 58 at 100), sonar bugs (57 of 58 at 100), axe violations (53 of 58 at 100), lighthouse accessibility (53 of 58 at 100), html errors (54 of 58 at 100).

### Top 10

| Rank | Model | Arm | Runtime | Setup | Final | Correctness (35) | Code quality (20) | Tests (15) | Security (10) | UX and accessibility (10) | Documentation (10) | Minutes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Sonnet | Q | OpenCode | OpenSpec + targeted skills | 84.8 | 32.5 | 14.3 | 13.1 | 10.0 | 9.0 | 6.0 | 25 |
| 2 | Sonnet | Z | OpenCode | Matt Pocock | 84.8 | 32.5 | 14.6 | 12.7 | 9.2 | 9.0 | 6.8 | 41 |
| 3 | Haiku | K | Claude Code | ECC + OpenSpec | 84.2 | 30.0 | 14.5 | 13.1 | 10.0 | 8.2 | 8.4 | 27 |
| 4 | Sonnet | V | Claude Code | Matt Pocock | 84.0 | 32.5 | 13.9 | 12.9 | 10.0 | 8.2 | 6.5 | 26 |
| 5 | Haiku | H | Claude Code | ECC | 83.6 | 31.1 | 14.7 | 11.9 | 10.0 | 8.2 | 7.8 | 21 |
| 6 | Sonnet | G | Claude Code | Superpowers | 83.3 | 32.3 | 12.2 | 13.4 | 10.0 | 9.0 | 6.3 | 41 |
| 7 | Sonnet | E | Claude Code | BK + ECC + OpenSpec | 83.2 | 32.5 | 14.4 | 11.9 | 10.0 | 8.6 | 5.8 | 42 |
| 8 | Sonnet | I | Claude Code | agent-skills + OpenSpec | 83.0 | 32.5 | 14.2 | 12.7 | 8.8 | 8.6 | 6.2 | 39 |
| 9 | Sonnet | F | Claude Code | agent-skills | 82.5 | 32.5 | 13.0 | 13.2 | 9.2 | 8.8 | 5.8 | 40 |
| 10 | Haiku | A | Claude Code | plain | 82.4 | 32.5 | 13.8 | 11.6 | 10.0 | 8.6 | 5.9 | 21 |
| 29 (baseline) | Sonnet | A | Claude Code | plain | 78.3 | 32.5 | 12.6 | 10.1 | 8.2 | 8.8 | 6.2 | 32 |

Plain Claude Code (A) is in the top 10 on Haiku and is the baseline row on Sonnet. Median of all 58 apps: 77.9.

### Top 10 in detail

Raw values behind the score, plus two measures that are not part of it because they ran on these apps only: drawings (a second Claude Opus 5.5 review of all 25 cartridge drawings per app) and the mutation score (Stryker 10.0.0, `bench/scorer/mutation.sh`). Per 1,000 lines: type errors, lint, Sonar bugs, security.

| Rank | Model | Arm | Features | Print (of 25) | Review criteria (of 65) | Coverage | Type errors | Erosion | Duplication | Lint | Sonar bugs | Security | Axe | README topics | Drawings correct (of 25) | Mutation score |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Sonnet | Q | 100% | 25 | 53 | 80.6% | 12.8 | 0.232 | 0% | 0.8 | 0 | 0 | 0 | 100% | 25 | mutation run failed |
| 2 | Sonnet | Z | 100% | 25 | 53 | 76.8% | 18 | 0.068 | 0% | 1.5 | 0 | 0.8 | 0 | 100% | 25 | mutation run failed |
| 3 | Haiku | K | 100% | 25 | 46 | 93% | 13.9 | 0.08 | 0% | 1.3 | 0 | 0 | 0 | 100% | 4 | not measured |
| 4 | Sonnet | V | 100% | 25 | 50 | 79.2% | 8.2 | 0.303 | 0% | 2.1 | 0 | 0 | 0 | 100% | 25 | not measured |
| 5 | Haiku | H | 100% | 24 | 47 | 81.4% | 3.1 | 0.211 | 0% | 2.9 | 0 | 0 | 0 | 100% | 8 | not measured |
| 6 | Sonnet | G | 100% | 24 | 54 | 84.4% | 33.5 | 0.469 | 0% | 3.2 | 0 | 0 | 0 | 100% | 25 | 0% |
| 7 | Sonnet | E | 100% | 25 | 50 | 81.6% | 5 | 0.25 | 0% | 1.2 | 0 | 0 | 0 | 83.3% | 25 | not measured |
| 8 | Sonnet | I | 100% | 25 | 51 | 77.1% | 3.2 | 0.306 | 0% | 2.4 | 0 | 1.2 | 0 | 100% | 25 | not measured |
| 9 | Sonnet | F | 100% | 25 | 52 | 82% | 55.7 | 0.295 | 0% | 1.7 | 0 | 0.8 | 0 | 66.7% | 20 | not measured |
| 10 | Haiku | A | 100% | 25 | 51 | 78.1% | 12.3 | 0.258 | 1.6% | 0.8 | 0 | 0 | 0 | 100% | 22 | not measured |
| 29 (baseline) | Sonnet | A | 100% | 25 | 50 | 63.4% | 13.9 | 0.358 | 0% | 1.9 | 0 | 1.9 | 0 | 100% | 25 | not measured |

Drawing review per app (the reviewer's summary):

- Sonnet Q: Arm Q renders proper, to-scale cartridges for all 25 records: right rim family, groove, belt, shoulder radii, bullet shape and seating per the rules, a hatched section with primer pocket and the heeled 22 LR bullet, and spot-checked values (3 or more per drawing) all match the records. The recurring flaw, judged minor, is that the shoulder angle on all 17 bottleneck cases is a leader callout rather than an angular dimension with arc and extension lines.
- Sonnet Z: All 25 drawings are true-to-scale cartridges of the right family with outside view, hatched section, correct bullets and record-matching values. Recurring minor faults: diameter extension lines run through the bullet, and alpha is a leader note, not an angular dimension.
- Haiku K: All 25 drawings render recognisable cartridges of the right family to scale with outside view, hatched section, seated bullet, title block and values matching the record, except invented -0.2 tolerances on 9,3 x 74 R. The recurring error is the shoulder angle shown as a loose text label without an angle dimension, often placed far from the shoulder, plus diameter labels stacked below without leaders and misplaced L3 labels on four straight cases.
- Sonnet V: All 25 drawings render proper cartridges of the right family (rimless with groove, rimmed, belted, half-round rimfire rims, heeled 22 LR) with outside view, hatched section, seated bullets per the seating rules and dimension values that match the records. Recurring minor faults: extension and leader lines run through tolerance labels, alpha is shown with a leader arrow instead of an angular dimension, and the outline is small relative to the label spread.
- Haiku H: All 25 drawings are true-to-scale technical drawings of the right family with outside view, hatched section, title block and dimension values that match the records. The recurring error is the shoulder angle: on every bottleneck case alpha is only a label on the centre line with a detached arc, and the stacked diameter labels at the right are crowded.
- Sonnet G: All 25 drawings render proper, true-to-scale cartridges of the right family (rimless, rimmed, belted, rimfire half-round rim, heeled 22 LR) with outside view, hatched section with primer pocket and seated bullet, rounded shoulder corners, and the required dimensions with values that match the records. No recurring material error; the only legibility note is crowded neck diameter arrows on short necks (223 Rem., 17 HMR).
- Sonnet E: All 25 drawings render proper cartridges true to the brief: correct rim family (rimless, rimmed, belted, rimfire half-round), bottleneck or straight outline, outside view over a hatched section with primer pocket, seated bullet of the requested shape, and every required dimension with values that match the records. The only recurring shortfall is cosmetic: alpha is marked with a small free-standing angle glyph beside the shoulder instead of between extended shoulder lines, and r1/r2 rounding and wall hatching are too small to see at this scale.
- Sonnet I: All 25 drawings render proper cartridges of the right family, computed from the record values, with outside view, hatched section, seated bullet and matching dimension values. Recurring minor flaw: labels set off their dimension lines (R on all, L3 or L6 on short cases), without overlap.
- Sonnet F: All 25 drawings are true-to-scale cartridges of the right family with outside view, hatched section, seated bullet and dimension values that match the records. The recurring error is the shoulder angle alpha, shown as a detached glyph beside the title block instead of a dimension on the shoulder, on all 17 bottleneck cases.
- Haiku A: All 25 drawings are true-to-scale cartridges of the right family (rimless, rimmed, belted, rimfire, bottleneck or straight) with outside view, hatched section with primer pocket, brief-conform bullets and values that match the records. Recurring weaknesses are the shoulder angle shown only as a leader label and all diameter dimensions stacked right of the bullet with long extension lines; on three revolver cases the missing-groove note is struck through by the title block frame.
- Sonnet A: All 25 drawings render the right family true to scale (groove, belt, rimmed flange, rimfire half-round, heeled 22 LR) with outside view over a hatched section, fillets, primer pocket and seated bullet; every spot-checked value matches the record. The recurring minor deviation is the shoulder angle alpha given as a leader label, not an angular dimension.

How the drawing count is made: each reviewer judged every drawing correct, partly or wrong against the brief's drawing rules and the record's values. The reviewers differed on one point: the shoulder angle α drawn as a label instead of an angle dimension (the brief lists α among the dimension lines). Some counted it as correct, others as partly. The count above counts a drawing whose only fault is that label as correct (confirmations such as "values match record" listed among the issues are not faults), so all apps are judged by one rule. Reviews per app: `drawing-review.json` next to each trial.

### All 58 apps

| Rank | Model | Arm | Runtime | Setup | Final | Correctness | Code quality | Tests | Security | UX and accessibility | Documentation |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Sonnet | Q | OpenCode | OpenSpec + targeted skills | 84.8 | 32.5 | 14.3 | 13.1 | 10.0 | 9.0 | 6.0 |
| 2 | Sonnet | Z | OpenCode | Matt Pocock | 84.8 | 32.5 | 14.6 | 12.7 | 9.2 | 9.0 | 6.8 |
| 3 | Haiku | K | Claude Code | ECC + OpenSpec | 84.2 | 30.0 | 14.5 | 13.1 | 10.0 | 8.2 | 8.4 |
| 4 | Sonnet | V | Claude Code | Matt Pocock | 84.0 | 32.5 | 13.9 | 12.9 | 10.0 | 8.2 | 6.5 |
| 5 | Haiku | H | Claude Code | ECC | 83.6 | 31.1 | 14.7 | 11.9 | 10.0 | 8.2 | 7.8 |
| 6 | Sonnet | G | Claude Code | Superpowers | 83.3 | 32.3 | 12.2 | 13.4 | 10.0 | 9.0 | 6.3 |
| 7 | Sonnet | E | Claude Code | BK + ECC + OpenSpec | 83.2 | 32.5 | 14.4 | 11.9 | 10.0 | 8.6 | 5.8 |
| 8 | Sonnet | I | Claude Code | agent-skills + OpenSpec | 83.0 | 32.5 | 14.2 | 12.7 | 8.8 | 8.6 | 6.2 |
| 9 | Sonnet | F | Claude Code | agent-skills | 82.5 | 32.5 | 13.0 | 13.2 | 9.2 | 8.8 | 5.8 |
| 10 | Haiku | A | Claude Code | plain | 82.4 | 32.5 | 13.8 | 11.6 | 10.0 | 8.6 | 5.9 |
| 11 | Sonnet | AB | Claude Code | OpenSpec | 82.3 | 32.5 | 13.5 | 12.9 | 7.8 | 9.2 | 6.5 |
| 12 | Sonnet | H | Claude Code | ECC | 82.2 | 32.5 | 14.0 | 12.1 | 8.7 | 9.0 | 5.9 |
| 13 | Haiku | W | Claude Code | Matt Pocock + OpenSpec | 81.9 | 30.0 | 15.0 | 12.0 | 10.0 | 8.8 | 6.2 |
| 14 | Sonnet | W | Claude Code | Matt Pocock + OpenSpec | 81.8 | 32.5 | 13.1 | 12.9 | 7.7 | 9.2 | 6.5 |
| 15 | Haiku | V | Claude Code | Matt Pocock | 81.6 | 32.5 | 13.9 | 11.7 | 8.8 | 8.6 | 6.2 |
| 16 | Haiku | F | Claude Code | agent-skills | 81.3 | 30.0 | 13.7 | 13.3 | 10.0 | 8.2 | 6.1 |
| 17 | Haiku | AC | Claude Code | Spec Kit | 81.2 | 32.5 | 14.8 | 10.4 | 8.8 | 8.6 | 6.3 |
| 18 | Haiku | J | Claude Code | Superpowers + OpenSpec | 80.7 | 30.0 | 13.1 | 13.7 | 10.0 | 8.2 | 5.8 |
| 19 | Sonnet | P | Claude Code | Ponytail + Spec Kit | 80.6 | 32.5 | 11.4 | 11.7 | 10.0 | 8.8 | 6.2 |
| 20 | Sonnet | J | Claude Code | Superpowers + OpenSpec | 80.4 | 29.2 | 12.7 | 13.2 | 10.0 | 8.8 | 6.5 |
| 21 | Sonnet | L | Claude Code | BK + agent-skills | 80.3 | 32.5 | 14.7 | 13.4 | 10.0 | 9.0 | 0.7 |
| 22 | Sonnet | AC | Claude Code | Spec Kit | 79.8 | 32.5 | 13.6 | 13.2 | 5.3 | 9.0 | 6.2 |
| 23 | Sonnet | T | OpenCode | agent-skills | 79.8 | 32.5 | 12.5 | 13.0 | 6.9 | 8.8 | 6.2 |
| 24 | Sonnet | O | Claude Code | Ponytail + OpenSpec | 79.7 | 32.5 | 13.4 | 12.9 | 5.6 | 9.0 | 6.3 |
| 25 | Haiku | G | Claude Code | Superpowers | 78.9 | 30.0 | 13.8 | 11.7 | 8.8 | 8.2 | 6.5 |
| 26 | Haiku | AA | OpenCode | Matt Pocock + OpenSpec | 78.9 | 32.5 | 13.2 | 13.2 | 10.0 | 8.8 | 1.2 |
| 27 | Sonnet | S | OpenCode | OpenSpec + Superpowers (oso) | 78.5 | 32.5 | 12.8 | 9.0 | 8.8 | 9.0 | 6.3 |
| 28 | Sonnet | Y | Claude Code | BK + Matt Pocock + OpenSpec | 78.4 | 32.5 | 12.4 | 13.5 | 10.0 | 9.0 | 1.1 |
| 29 | Sonnet | A | Claude Code | plain | 78.3 | 32.5 | 12.6 | 10.1 | 8.2 | 8.8 | 6.2 |
| 30 | Sonnet | X | Claude Code | BK + Matt Pocock | 77.9 | 32.5 | 13.5 | 11.7 | 10.0 | 9.0 | 1.1 |
| 31 | Sonnet | U | OpenCode | agent-skills + OpenSpec | 77.7 | 32.5 | 13.3 | 11.5 | 10.0 | 9.0 | 1.4 |
| 32 | Haiku | Y | Claude Code | BK + Matt Pocock + OpenSpec | 77.4 | 31.2 | 15.1 | 11.6 | 10.0 | 8.2 | 1.3 |
| 33 | Haiku | P | Claude Code | Ponytail + Spec Kit | 77.0 | 31.2 | 14.3 | 11.9 | 10.0 | 8.2 | 1.3 |
| 34 | Sonnet | D | Claude Code | BK + Superpowers + OpenSpec | 76.7 | 32.5 | 12.8 | 11.9 | 10.0 | 8.4 | 1.1 |
| 35 | Haiku | X | Claude Code | BK + Matt Pocock | 76.3 | 31.2 | 13.4 | 12.1 | 10.0 | 8.2 | 1.4 |
| 36 | Haiku | D | Claude Code | BK + Superpowers + OpenSpec | 75.8 | 30.0 | 14.1 | 12.2 | 10.0 | 8.2 | 1.3 |
| 37 | Sonnet | B | Claude Code | Ponytail | 75.5 | 32.5 | 12.1 | 12.0 | 10.0 | 8.2 | 0.8 |
| 38 | Sonnet | R | OpenCode | Superpowers | 75.5 | 32.5 | 11.2 | 11.8 | 10.0 | 8.6 | 1.3 |
| 39 | Haiku | Z | OpenCode | Matt Pocock | 75.0 | 31.2 | 12.7 | 11.6 | 10.0 | 8.2 | 1.2 |
| 40 | Haiku | C | Claude Code | BK + agent-skills + OpenSpec | 74.9 | 32.5 | 11.1 | 11.8 | 10.0 | 8.2 | 1.3 |
| 41 | Sonnet | M | Claude Code | BK + Superpowers | 74.0 | 32.5 | 12.0 | 11.6 | 8.4 | 8.4 | 1.1 |
| 42 | Haiku | R | OpenCode | Superpowers | 73.9 | 32.5 | 11.0 | 11.8 | 8.8 | 8.6 | 1.2 |
| 43 | Haiku | AB | Claude Code | OpenSpec | 73.7 | 27.5 | 13.9 | 12.2 | 10.0 | 8.2 | 1.9 |
| 44 | Sonnet | N | Claude Code | BK + ECC | 73.5 | 32.5 | 11.5 | 13.1 | 6.8 | 9.0 | 0.7 |
| 45 | Haiku | O | Claude Code | Ponytail + OpenSpec | 73.0 | 30.7 | 11.8 | 12.1 | 8.8 | 8.2 | 1.4 |
| 46 | Haiku | E | Claude Code | BK + ECC + OpenSpec | 73.0 | 30.0 | 13.4 | 11.7 | 8.8 | 8.2 | 0.9 |
| 47 | Haiku | N | Claude Code | BK + ECC | 72.7 | 30.0 | 13.2 | 10.6 | 10.0 | 8.2 | 0.7 |
| 48 | Haiku | U | OpenCode | agent-skills + OpenSpec | 70.6 | 26.6 | 12.6 | 11.9 | 10.0 | 8.2 | 1.3 |
| 49 | Haiku | M | Claude Code | BK + Superpowers | 70.2 | 31.2 | 10.1 | 11.1 | 8.8 | 8.0 | 1.1 |
| 50 | Sonnet | K | Claude Code | ECC + OpenSpec | 69.6 | 19.2 | 15.0 | 12.9 | 10.0 | 6.0 | 6.6 |
| 51 | Haiku | B | Claude Code | Ponytail | 68.4 | 25.0 | 12.8 | 12.0 | 10.0 | 7.8 | 0.8 |
| 52 | Sonnet | C | Claude Code | BK + agent-skills + OpenSpec | 64.8 | 32.5 | 9.4 | 3.8 | 10.0 | 8.2 | 0.9 |
| 53 | Haiku | L | Claude Code | BK + agent-skills | 60.8 | 26.2 | 13.3 | 2.5 | 10.0 | 8.2 | 0.6 |
| 54 | Sonnet | AA | OpenCode | Matt Pocock + OpenSpec | 60.5 | 16.7 | 13.3 | 11.5 | 8.1 | 4.6 | 6.4 |
| 55 | Haiku | I | Claude Code | agent-skills + OpenSpec | 58.8 | 22.9 | 13.9 | 2.5 | 10.0 | 8.2 | 1.2 |
| 56 | Haiku | T | OpenCode | agent-skills | 22.1 | 0.0 | 10.5 | 3.0 | 7.5 | 0.0 | 1.1 |
| 57 | Haiku | Q | OpenCode | OpenSpec + targeted skills | 17.7 | 0.0 | 10.0 | 0.0 | 6.2 | 0.0 | 1.5 |
| 58 | Haiku | S | OpenCode | OpenSpec + Superpowers (oso) | 12.5 | 0.0 | 12.0 | 0.0 | 0.0 | 0.0 | 0.5 |

## Findings

- The hidden tests separate the arms more than on the winery brief, but most arms still pass: Claude Code 41 of 44 trials at 6 of 6 (Sonnet J 5 of 6 and K 2 of 6, Haiku I 5 of 6), OpenCode 10 of 14 (Haiku Q, S, T 0 of 6, Sonnet AA 2 of 6).
- Model matters more than setup: review overall median 8 on Sonnet and 6 on Haiku for Claude Code (range 6 to 8 and 5 to 7). Sonnet Claude Code trials took a median of 38.5 minutes against 27.5 on Haiku.
- Plain Claude Code (A) is among the best on both models (overall 7 on each, 6 of 6 features). The BenchKeeper layer with agent-skills (L): Haiku 6, Sonnet 8, 6 of 6 on both. Ponytail alone (B): Haiku 5, Sonnet 6, 6 of 6 on both.
- Hidden tests and review disagree on Sonnet K: 2 of 6 features but overall 8. The review found a strong drawing engine and could not check the detail and print rendering of the current build, which is where the hidden tests failed.
- OpenCode on Haiku failed three trials outright: Q and T delivered no `index.html`, S asked the user to run a slash command instead of building. On Sonnet only AA fell short (2 of 6).
- Final score: the top 10 spans 82.4 to 84.8 points, both runtimes and both models (7 Sonnet, 3 Haiku). Plain Claude Code is 10th on Haiku (82.4) and 29th of 58 on Sonnet (78.3, median 77.9). Setups do not group: OpenSpec, ECC, agent-skills, Superpowers and Matt Pocock arms all appear in the top 10.
- Every reviewed app draws proper cartridges of the right family with values that match the records. The drawings differ in dimensioning and legibility: Haiku K (4 of 25 correct) and Haiku H (8) stack or detach labels, all Sonnet apps in the top 10 reach 20 to 25.
- Documentation spreads widest of the six categories: 0.5 to 8.4 of 10, median 1.9. 30 of 58 apps have no README; the share of documented functions has a median of 16% (2% to 85%).
- n = 1 per arm and model: every difference between two arms is anecdotal.

## Data

`bench/results/2026-10-16-cartridges-haiku/` and `2026-10-16-cartridges-sonnet/`: manifest, `final-score.json` (per app the categories and every input, raw and normalized), and per trial `trial.json`, the transcript, the built app, the scorer's screenshots, `review.json`, `static-scan.json`, the measures `types.json`, `coverage.json`, `print.json`, `html.json`, `docs.json`, and for the reviewed apps `drawing-review.json`.
