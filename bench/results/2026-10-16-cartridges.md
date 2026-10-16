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
| Testing method | agent runs under protocol 1.12, parsed under protocol 1.14, BenchKeeper layer v1. No mutation score: the run predates the mutation step (#44) |
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

## Ranking by review criteria

The overall rating ties most arms (19 Sonnet arms at 8). The sum of the 13 review criteria (1 to 5 each, at most 65) separates them more finely. Only apps that pass all 6 hidden feature tests are ranked. Ties go to fewer minutes. One trial per arm: a gap of 1 or 2 points is within noise.

### Sonnet 5.5, top 10

| Rank | Arm | Runtime | Setup | Criteria sum (of 65) | Overall | Minutes |
|---|---|---|---|---|---|---|
| 1 | W | Claude Code | Matt Pocock + OpenSpec | 55 | 8 | 58 |
| 2 | L | Claude Code | BK + agent-skills | 54 | 8 | 33 |
| 3 | O | Claude Code | Ponytail + OpenSpec | 54 | 8 | 33 |
| 4 | AB | Claude Code | OpenSpec | 54 | 8 | 38 |
| 5 | G | Claude Code | Superpowers | 54 | 8 | 41 |
| 6 | AC | Claude Code | Spec Kit | 54 | 8 | 47 |
| 7 | Q | OpenCode | OpenSpec + targeted skills | 53 | 8 | 25 |
| 8 | Y | Claude Code | BK + Matt Pocock + OpenSpec | 53 | 8 | 31 |
| 9 | N | Claude Code | BK + ECC | 53 | 7 | 37 |
| 10 | H | Claude Code | ECC | 53 | 8 | 39 |

Not ranked (fewer than 6 features): AA (2 of 6, criteria sum 43), J (5 of 6, criteria sum 52), K (2 of 6, criteria sum 54).

### Haiku 5.5, top 10

| Rank | Arm | Runtime | Setup | Criteria sum (of 65) | Overall | Minutes |
|---|---|---|---|---|---|---|
| 1 | A | Claude Code | plain | 51 | 7 | 21 |
| 2 | AA | OpenCode | Matt Pocock + OpenSpec | 51 | 7 | 68 |
| 3 | V | Claude Code | Matt Pocock | 50 | 7 | 23 |
| 4 | AC | Claude Code | Spec Kit | 49 | 7 | 23 |
| 5 | W | Claude Code | Matt Pocock + OpenSpec | 49 | 7 | 28 |
| 6 | R | OpenCode | Superpowers | 48 | 7 | 40 |
| 7 | H | Claude Code | ECC | 47 | 6 | 21 |
| 8 | AB | Claude Code | OpenSpec | 47 | 6 | 27 |
| 9 | F | Claude Code | agent-skills | 47 | 6 | 27 |
| 10 | C | Claude Code | BK + agent-skills + OpenSpec | 47 | 6 | 28 |

Not ranked (fewer than 6 features): I (5 of 6, criteria sum 46), Q (0 of 6, criteria sum 14), S (0 of 6, criteria sum 13), T (0 of 6, criteria sum 21).

## Findings

- The hidden tests separate the arms more than on the winery brief, but most arms still pass: Claude Code 41 of 44 trials at 6 of 6 (Sonnet J 5 of 6 and K 2 of 6, Haiku I 5 of 6), OpenCode 10 of 14 (Haiku Q, S, T 0 of 6, Sonnet AA 2 of 6).
- Model matters more than setup: review overall median 8 on Sonnet and 6 on Haiku for Claude Code (range 6 to 8 and 5 to 7). Sonnet Claude Code trials took a median of 38.5 minutes against 27.5 on Haiku.
- Plain Claude Code (A) is among the best on both models (overall 7 on each, 6 of 6 features). The BenchKeeper layer with agent-skills (L): Haiku 6, Sonnet 8, 6 of 6 on both. Ponytail alone (B): Haiku 5, Sonnet 6, 6 of 6 on both.
- Hidden tests and review disagree on Sonnet K: 2 of 6 features but overall 8. The review found a strong drawing engine and could not check the detail and print rendering of the current build, which is where the hidden tests failed.
- OpenCode on Haiku failed three trials outright: Q and T delivered no `index.html`, S asked the user to run a slash command instead of building. On Sonnet only AA fell short (2 of 6).
- n = 1 per arm and model: every difference between two arms is anecdotal.

## Data

`bench/results/2026-10-16-cartridges-haiku/` and `2026-10-16-cartridges-sonnet/`: manifest, and per trial `trial.json`, the transcript, the built app, the scorer's screenshots and `review.json`.
