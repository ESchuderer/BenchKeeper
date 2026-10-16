# Cartridges brief: results on Sonnet 5.5

Brief: a static reference database of 25 C.I.P. cartridges with search, a detail view, a computed 2D drawing and a one-page print view. 29 Sonnet 5.5 apps (22 Claude Code, 7 OpenCode), one trial per arm, runs 2026-10-15 to 2026-10-16: descriptive only, no significance tests. Haiku 5.5 trials are listed at the end as records: Haiku and OpenCode are dropped from future runs (PROTOCOL 1.15).

- Arm: one tested setup (runtime, skills, rules, spec tool), named by letters (`bench/SCENARIOS.md`).
- BK: the BenchKeeper layer, v1 in these runs (the SDLC in the rules file, Ponytail, the project template, no workflow skill).
- Final score: 0 to 100 from six weighted categories (section "Final score").

## Winners

- Best overall: Q (OpenCode, OpenSpec + targeted skills), final score 84.8 of 100.
- Best Claude Code app: V (Matt Pocock), 84.0, rank 3.
- Plain Claude Code (A): 78.3, rank 19 of 29 (median 79.8).
- Best BenchKeeper layer (v1) arm: E (BK + ECC + OpenSpec), 83.2, rank 5.
- The top 10 spans 81.8 to 84.8: with one trial per arm, totals within about 2 points are not separable.

| Category (weight) | Best | Plain Claude Code (A) |
|---|---|---|
| Correctness (35) | 25 apps: 32.5 | 32.5 |
| Code quality (20) | K: 15.0 | 12.6 |
| Tests (15) | Y: 13.5 | 10.1 |
| Security (10) | 15 apps: 10.0 | 8.2 |
| UX and accessibility (10) | AB: 9.2 | 8.8 |
| Documentation (10) | Z: 6.8 | 6.2 |

## Top 10

Final score out of 100 from six weighted categories (method below). Ranked by total, ties to fewer minutes.

| Rank | Arm | Runtime | Setup | Final | Correctness (35) | Code quality (20) | Tests (15) | Security (10) | UX and accessibility (10) | Documentation (10) | Minutes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Q | OpenCode | OpenSpec + targeted skills | 84.8 | 32.5 | 14.3 | 13.1 | 10.0 | 9.0 | 6.0 | 25 |
| 2 | Z | OpenCode | Matt Pocock | 84.8 | 32.5 | 14.6 | 12.7 | 9.2 | 9.0 | 6.8 | 41 |
| 3 | V | Claude Code | Matt Pocock | 84.0 | 32.5 | 13.9 | 12.9 | 10.0 | 8.2 | 6.5 | 26 |
| 4 | G | Claude Code | Superpowers | 83.3 | 32.3 | 12.2 | 13.4 | 10.0 | 9.0 | 6.3 | 41 |
| 5 | E | Claude Code | BK + ECC + OpenSpec | 83.2 | 32.5 | 14.4 | 11.9 | 10.0 | 8.6 | 5.8 | 42 |
| 6 | I | Claude Code | agent-skills + OpenSpec | 83.0 | 32.5 | 14.2 | 12.7 | 8.8 | 8.6 | 6.2 | 39 |
| 7 | F | Claude Code | agent-skills | 82.5 | 32.5 | 13.0 | 13.2 | 9.2 | 8.8 | 5.8 | 40 |
| 8 | AB | Claude Code | OpenSpec | 82.3 | 32.5 | 13.5 | 12.9 | 7.8 | 9.2 | 6.5 | 38 |
| 9 | H | Claude Code | ECC | 82.2 | 32.5 | 14.0 | 12.1 | 8.7 | 9.0 | 5.9 | 39 |
| 10 | W | Claude Code | Matt Pocock + OpenSpec | 81.8 | 32.5 | 13.1 | 12.9 | 7.7 | 9.2 | 6.5 | 58 |
| 19 (baseline) | A | Claude Code | plain | 78.3 | 32.5 | 12.6 | 10.1 | 8.2 | 8.8 | 6.2 | 32 |

## Key findings

- Final score (Sonnet 5.5): the top 10 spans 81.8 to 84.8 points and both runtimes (OpenCode Q and Z lead). Plain Claude Code (A) is 19th of 29 (78.3, median 79.8). Setups do not group: OpenSpec, ECC, agent-skills, Superpowers and Matt Pocock arms all appear in the top 10.
- Every reviewed Sonnet app draws proper cartridges of the right family with values that match the records: 25 of 25 correct for all reviewed apps except F (20). The drawings do not separate the setups.
- Mutation score of the top 10 and plain A: 46.1% (A) to 70.1% (OpenSpec alone, AB). Matt Pocock alone (V) catches 46.6% of mutants, about as many as plain A. The final score does not include it.
- Documentation on Sonnet scores 0.7 to 6.8 of 10, median 6.2. 10 of 29 apps have no README. The share of documented functions has a median of 14% (2% to 34%).
- Hidden tests and review disagree on Sonnet K: 2 of 6 features but overall 8. The review found a strong drawing engine and could not check the detail and print rendering of the current build, which is where the hidden tests failed.
- The hidden tests separate the arms more than on the winery brief, but most arms still pass: Claude Code 41 of 44 trials at 6 of 6 (Sonnet J 5 of 6 and K 2 of 6, Haiku I 5 of 6), OpenCode 10 of 14 (Haiku Q, S, T 0 of 6, Sonnet AA 2 of 6).
- Plain Claude Code (A) is among the best on both models (overall 7 on each, 6 of 6 features). The BenchKeeper layer with agent-skills (L): Haiku 6, Sonnet 8, 6 of 6 on both. Ponytail alone (B): Haiku 5, Sonnet 6, 6 of 6 on both.
- Model matters more than setup: review overall median 8 on Sonnet and 6 on Haiku for Claude Code (range 6 to 8 and 5 to 7). Sonnet Claude Code trials took a median of 38.5 minutes against 27.5 on Haiku.
- OpenCode on Haiku failed three trials outright: Q and T delivered no `index.html`, S asked the user to run a slash command instead of building. On Sonnet only AA fell short (2 of 6).
- n = 1 per arm and model: every difference between two arms is anecdotal.

## Top 10 in detail

Raw values behind the score, plus two measures that are not part of it because they ran on these apps only: drawings (a second Claude Opus 5.5 review of all 25 cartridge drawings per app) and the mutation score (Stryker 10.0.0, `bench/scorer/mutation.sh`). Per 1,000 lines: type errors, lint, Sonar bugs, security.

| Rank | Arm | Features | Print (of 25) | Review criteria (of 65) | Coverage | Type errors | Erosion | Duplication | Lint | Sonar bugs | Security | Axe | README topics | Drawings correct (of 25) | Mutation score |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Q | 100% | 25 | 53 | 80.6% | 12.8 | 0.232 | 0% | 0.8 | 0 | 0 | 0 | 100% | 25 | 51% |
| 2 | Z | 100% | 25 | 53 | 76.8% | 18 | 0.068 | 0% | 1.5 | 0 | 0.8 | 0 | 100% | 25 | 52.1% |
| 3 | V | 100% | 25 | 50 | 79.2% | 8.2 | 0.303 | 0% | 2.1 | 0 | 0 | 0 | 100% | 25 | 46.6% |
| 4 | G | 100% | 24 | 54 | 84.4% | 33.5 | 0.469 | 0% | 3.2 | 0 | 0 | 0 | 100% | 25 | 52.9% |
| 5 | E | 100% | 25 | 50 | 81.6% | 5 | 0.25 | 0% | 1.2 | 0 | 0 | 0 | 83.3% | 25 | 52.4% |
| 6 | I | 100% | 25 | 51 | 77.1% | 3.2 | 0.306 | 0% | 2.4 | 0 | 1.2 | 0 | 100% | 25 | 65.4% |
| 7 | F | 100% | 25 | 52 | 82% | 55.7 | 0.295 | 0% | 1.7 | 0 | 0.8 | 0 | 66.7% | 20 | 57.7% |
| 8 | AB | 100% | 25 | 54 | 78.8% | 18.5 | 0.249 | 0% | 0.7 | 0 | 2.2 | 0 | 100% | 25 | 70.1% |
| 9 | H | 100% | 25 | 53 | 71.1% | 17.7 | 0.118 | 0% | 2.6 | 0 | 1.3 | 0 | 100% | 25 | 64.6% |
| 10 | W | 100% | 25 | 55 | 78.6% | 9.3 | 0.362 | 0% | 3.1 | 0 | 2.3 | 0 | 100% | 25 | own test fails |
| 19 (baseline) | A | 100% | 25 | 50 | 63.4% | 13.9 | 0.358 | 0% | 1.9 | 0 | 1.9 | 0 | 100% | 25 | 46.1% |

Mutation score: Stryker reruns the app's own unit tests per mutant (`npx vitest run` for vitest suites, else the `test:unit` script, else `npm test`). Sources loaded through `vm` get `process` in their context, since Stryker reads the active mutant from `process.env`, and `// @ts-nocheck` goes into TypeScript files only. These three rules were added during this run, and every score above was measured with them except AB and H (neither has a `test:unit` script, `vm` loading or a byte-compared file, so the rules do not change them). Three apps needed a rule: Z (its `npm test` also starts browser tests, which the scoring container cannot run), G (0% before: its tests load the sources in a `vm` context) and Q (a test compares the generated `js/data.js` byte for byte, so that file is not mutated). W: one of its own tests fails before mutation starts.

Drawings: every reviewed app draws the right cartridge family with values that match the records. Per app (the reviewer's summary):

- Q: Arm Q renders proper, to-scale cartridges for all 25 records: right rim family, groove, belt, shoulder radii, bullet shape and seating per the rules, a hatched section with primer pocket and the heeled 22 LR bullet, and spot-checked values (3 or more per drawing) all match the records. The recurring flaw, judged minor, is that the shoulder angle on all 17 bottleneck cases is a leader callout rather than an angular dimension with arc and extension lines.
- Z: All 25 drawings are true-to-scale cartridges of the right family with outside view, hatched section, correct bullets and record-matching values. Recurring minor faults: diameter extension lines run through the bullet, and alpha is a leader note, not an angular dimension.
- V: All 25 drawings render proper cartridges of the right family (rimless with groove, rimmed, belted, half-round rimfire rims, heeled 22 LR) with outside view, hatched section, seated bullets per the seating rules and dimension values that match the records. Recurring minor faults: extension and leader lines run through tolerance labels, alpha is shown with a leader arrow instead of an angular dimension, and the outline is small relative to the label spread.
- G: All 25 drawings render proper, true-to-scale cartridges of the right family (rimless, rimmed, belted, rimfire half-round rim, heeled 22 LR) with outside view, hatched section with primer pocket and seated bullet, rounded shoulder corners, and the required dimensions with values that match the records. No recurring material error; the only legibility note is crowded neck diameter arrows on short necks (223 Rem., 17 HMR).
- E: All 25 drawings are proper cartridges: right rim family, outline, hatched section with pocket, seated bullet of the requested shape, and every required dimension matching the record. The only recurring deviation is cosmetic: alpha is marked by a small angle glyph beside the shoulder rather than between extended shoulder lines.
- I: All 25 drawings render proper cartridges of the right family, computed from the record values, with outside view, hatched section, seated bullet and matching dimension values. Recurring minor flaw: labels set off their dimension lines (R on all, L3 or L6 on short cases), without overlap.
- F: All 25 drawings are true-to-scale cartridges of the right family with outside view, hatched section, seated bullet and dimension values that match the records. The recurring error is the shoulder angle alpha, shown as a detached glyph beside the title block instead of a dimension on the shoulder, on all 17 bottleneck cases.
- AB: All 25 drawings are proper scaled cartridge drawings: correct rim families (rimless groove, belted with belt, rimmed, half-round rimfire rim, heeled 22 Long Rifle bullet), outside view over a hatched section with primer pocket and seated bullet, per-brief bullet shapes and seating, and every required dimension with values matching the records. Only minor drafting clutter recurs: the alpha arc and leaders crowd or coincide with neck and G1 dimension lines (17 HMR H1/H2 share one line).
- H: Yes: all 25 are proper true-scale drawings with the right family, outline, seated bullet, hatched section and dimension values matching the records. No material recurring error; alpha is shown as a detached to-scale wedge tied to the shoulder by a dashed line.
- W: All 25 drawings are true-to-scale technical drawings with the right family outline (extractor grooves, belts, rims, half-round rimfire rims, heeled 22 LR bullet), outside view over a hatched section with primer pocket and seated bullet, title block, and dimension values matching the records. The only recurring deviation is that the shoulder angle alpha is given as a leader label instead of an angular dimension.
- A: All 25 drawings render the right family true to scale (groove, belt, rimmed flange, rimfire half-round, heeled 22 LR) with outside view over a hatched section, fillets, primer pocket and seated bullet; every spot-checked value matches the record. The recurring minor deviation is the shoulder angle alpha given as a leader label, not an angular dimension.

How the drawing count is made: each reviewer judged every drawing correct, partly or wrong against the brief's drawing rules and the record's values. The reviewers differed on one point: the shoulder angle α drawn as a label instead of an angle dimension (the brief lists α among the dimension lines). The count counts a drawing whose only fault is that label as correct (confirmations such as "values match record" listed among the issues are not faults), so all apps are judged by one rule. Reviews per app: `drawing-review.json` next to each trial.

## All 29 Sonnet apps

| Rank | Arm | Runtime | Setup | Final | Correctness | Code quality | Tests | Security | UX and accessibility | Documentation |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Q | OpenCode | OpenSpec + targeted skills | 84.8 | 32.5 | 14.3 | 13.1 | 10.0 | 9.0 | 6.0 |
| 2 | Z | OpenCode | Matt Pocock | 84.8 | 32.5 | 14.6 | 12.7 | 9.2 | 9.0 | 6.8 |
| 3 | V | Claude Code | Matt Pocock | 84.0 | 32.5 | 13.9 | 12.9 | 10.0 | 8.2 | 6.5 |
| 4 | G | Claude Code | Superpowers | 83.3 | 32.3 | 12.2 | 13.4 | 10.0 | 9.0 | 6.3 |
| 5 | E | Claude Code | BK + ECC + OpenSpec | 83.2 | 32.5 | 14.4 | 11.9 | 10.0 | 8.6 | 5.8 |
| 6 | I | Claude Code | agent-skills + OpenSpec | 83.0 | 32.5 | 14.2 | 12.7 | 8.8 | 8.6 | 6.2 |
| 7 | F | Claude Code | agent-skills | 82.5 | 32.5 | 13.0 | 13.2 | 9.2 | 8.8 | 5.8 |
| 8 | AB | Claude Code | OpenSpec | 82.3 | 32.5 | 13.5 | 12.9 | 7.8 | 9.2 | 6.5 |
| 9 | H | Claude Code | ECC | 82.2 | 32.5 | 14.0 | 12.1 | 8.7 | 9.0 | 5.9 |
| 10 | W | Claude Code | Matt Pocock + OpenSpec | 81.8 | 32.5 | 13.1 | 12.9 | 7.7 | 9.2 | 6.5 |
| 11 | P | Claude Code | Ponytail + Spec Kit | 80.6 | 32.5 | 11.4 | 11.7 | 10.0 | 8.8 | 6.2 |
| 12 | J | Claude Code | Superpowers + OpenSpec | 80.4 | 29.2 | 12.7 | 13.2 | 10.0 | 8.8 | 6.5 |
| 13 | L | Claude Code | BK + agent-skills | 80.3 | 32.5 | 14.7 | 13.4 | 10.0 | 9.0 | 0.7 |
| 14 | AC | Claude Code | Spec Kit | 79.8 | 32.5 | 13.6 | 13.2 | 5.3 | 9.0 | 6.2 |
| 15 | T | OpenCode | agent-skills | 79.8 | 32.5 | 12.5 | 13.0 | 6.9 | 8.8 | 6.2 |
| 16 | O | Claude Code | Ponytail + OpenSpec | 79.7 | 32.5 | 13.4 | 12.9 | 5.6 | 9.0 | 6.3 |
| 17 | S | OpenCode | OpenSpec + Superpowers (oso) | 78.5 | 32.5 | 12.8 | 9.0 | 8.8 | 9.0 | 6.3 |
| 18 | Y | Claude Code | BK + Matt Pocock + OpenSpec | 78.4 | 32.5 | 12.4 | 13.5 | 10.0 | 9.0 | 1.1 |
| 19 | A | Claude Code | plain | 78.3 | 32.5 | 12.6 | 10.1 | 8.2 | 8.8 | 6.2 |
| 20 | X | Claude Code | BK + Matt Pocock | 77.9 | 32.5 | 13.5 | 11.7 | 10.0 | 9.0 | 1.1 |
| 21 | U | OpenCode | agent-skills + OpenSpec | 77.7 | 32.5 | 13.3 | 11.5 | 10.0 | 9.0 | 1.4 |
| 22 | D | Claude Code | BK + Superpowers + OpenSpec | 76.7 | 32.5 | 12.8 | 11.9 | 10.0 | 8.4 | 1.1 |
| 23 | B | Claude Code | Ponytail | 75.5 | 32.5 | 12.1 | 12.0 | 10.0 | 8.2 | 0.8 |
| 24 | R | OpenCode | Superpowers | 75.5 | 32.5 | 11.2 | 11.8 | 10.0 | 8.6 | 1.3 |
| 25 | M | Claude Code | BK + Superpowers | 74.0 | 32.5 | 12.0 | 11.6 | 8.4 | 8.4 | 1.1 |
| 26 | N | Claude Code | BK + ECC | 73.5 | 32.5 | 11.5 | 13.1 | 6.8 | 9.0 | 0.7 |
| 27 | K | Claude Code | ECC + OpenSpec | 69.6 | 19.2 | 15.0 | 12.9 | 10.0 | 6.0 | 6.6 |
| 28 | C | Claude Code | BK + agent-skills + OpenSpec | 64.8 | 32.5 | 9.4 | 3.8 | 10.0 | 8.2 | 0.9 |
| 29 | AA | OpenCode | Matt Pocock + OpenSpec | 60.5 | 16.7 | 13.3 | 11.5 | 8.1 | 4.6 | 6.4 |

## Method

Full protocol: `bench/PROTOCOL.md`, section "Cartridges brief".

| Item | Value |
|---|---|
| Brief | `bench/briefs/cartridges/brief.md`: a static reference database of 25 C.I.P. cartridges with a list, search and family filter, a detail view, a computed 2D drawing (outside view and section, dimensions, title block) and a one-page print view |
| Hidden tests | C1 to C6 (`bench/briefs/cartridges/hidden/`, hash `5c9d25395e3b332c`): list, search and filter, detail values, drawing, print, data loading. Validated against a reference app, a variant and mutants (`validate.sh`) |
| Claude Code arms | 22 (A to P, V to Y, AB, AC), Claude Code 2.1.299, effort `high`, subscription (Team seats) |
| OpenCode arms | 7 (Q to U, Z, AA), OpenCode 1.19.0, variant `high`, Anthropic API key |
| Review | blind, `claude-opus-5-5`, effort `high`, the brief's prompt `bench/briefs/cartridges/review.md`, 13 criteria, subscription |
| Testing method | agent runs under protocol 1.12, parsed under protocol 1.14, BenchKeeper layer v1. Final score, static scan and the added measures on all 58 apps; drawing review and mutation score on the final-score top 10 and plain Claude Code (section "Final score") |
| Seed | 41 (arm order and image IDs in the run manifests) |

### Final score

One score out of 100 per app (`bench/scripts/final-score.mjs`, weights in `bench/scripts/final-score.weights.json`). Each input is normalized to 0 to 100: shares in percent as they are, review criteria (1 to 5) linearly, counts per 1,000 lines against a cap (0 findings is 100, the cap or more is 0). An input without data scores 0. Haiku final scores: `2026-10-16-cartridges-haiku/final-score.json`.

| Category | Weight | Inputs (weight) |
|---|---|---|
| Correctness | 35 | hidden features (20), print pass (5), review requirements correctness (10) |
| Code quality | 20 | review quality (8), erosion (4), type errors (2), sonar bugs (2), lint (2), duplication (2) |
| Tests | 15 | line coverage (10), review tests (5) |
| Security | 10 | security findings (5), review security (5) |
| UX and accessibility | 10 | review ux (4), axe violations (3), lighthouse accessibility (1), lighthouse performance (1), html errors (1) |
| Documentation | 10 | readme coverage (2.5), readme accuracy (2.5), doc functions (1), doc exports (1), comment density (1), decision records (1), maintenance flags (1) |

Measures added for this score, run on all 58 apps of both models (`bench/scorer/`): type errors (TypeScript 6.0.3, `checkJs`, `strict` off), line coverage of the app's own unit tests (c8 12.0.0), print check (Playwright 1.64.0: each of the 25 cartridges on one A4 page, drawing at 80% of the printable width or more), HTML validity (Nu HTML Checker 26.10.12), documentation (README coverage of six topics and accuracy of its commands and paths, documented functions, comment density, decision records), and the static scan (ESLint 9.39.5 with SonarJS 4.2.2 and security 4.2.0 rules, security findings without `security/detect-object-injection` and `sonarjs/no-clear-text-protocols`, which flag ordinary lookups and the SVG namespace URL). Axe, Lighthouse and the maintenance flags come from the scorer's existing run.

Inputs with nearly the same value for every app, so they add points but hardly separate apps: hidden features (26 of 29 at 100), print pass (28 of 29 at 100), review requirements correctness (28 of 29 at 75), sonar bugs (29 of 29 at 100), duplication (29 of 29 at 100), review security (28 of 29 at 100), axe violations (27 of 29 at 100), lighthouse accessibility (29 of 29 at 100), html errors (29 of 29 at 100), decision records (26 of 29 at 33.3).

## Per-trial results

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

### Claude Code, Haiku 5.5 (Haiku is dropped from the benchmarks)

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

### OpenCode, Haiku 5.5 (Haiku is dropped from the benchmarks)

| Arm | Setup | Features | Follow-ups | Minutes | USD | Overall | Req. | Correct. | Security | Code | Tests | UX | A11y | Simple | Maint. | Visual | Layout | Usability | Reception |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q | OpenSpec + targeted skills | 0/6 | 2 | 11 | 0.39 | 1 | 1 | 1 | 2 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| R | Superpowers | 6/6 | 2 | 40 | 2.00 | 7 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 2 | 4 | 3 | 4 | 4 |
| S | OpenSpec + Superpowers (oso) | 0/6 | 2 | 7 | 0.15 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| T | agent-skills | 0/6 | 2 | 15 | 0.79 | 1 | 1 | 1 | 3 | 3 | 2 | 1 | 1 | 3 | 2 | 1 | 1 | 1 | 1 |
| U | agent-skills + OpenSpec | 6/6 | 2 | 31 | 3.25 | 6 | 3 | 4 | 5 | 4 | 4 | 3 | 4 | 4 | 2 | 3 | 3 | 4 | 3 |
| Z | Matt Pocock | 6/6 | 2 | 44 | 3.13 | 6 | 3 | 4 | 5 | 4 | 4 | 3 | 4 | 5 | 2 | 3 | 3 | 4 | 3 |
| AA | Matt Pocock + OpenSpec | 6/6 | 2 | 68 | 3.44 | 7 | 4 | 4 | 5 | 4 | 4 | 3 | 4 | 5 | 2 | 4 | 4 | 4 | 4 |

## Data

`bench/results/2026-10-16-cartridges-haiku/` and `2026-10-16-cartridges-sonnet/`: manifest, `final-score.json` (per app the categories and every input, raw and normalized), and per trial `trial.json`, the transcript, the built app, the scorer's screenshots, `review.json`, `static-scan.json`, the measures `types.json`, `coverage.json`, `print.json`, `html.json`, `docs.json`, and for the reviewed apps `drawing-review.json`.
