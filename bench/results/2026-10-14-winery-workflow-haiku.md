# Prompted variant: winery brief with a process request, Claude Haiku 5.5

Run 2026-10-14, protocol `bench/PROTOCOL.md` v0.2 plus the prompted variant (`bench/briefs/winery-workflow/`): the winery brief plus one paragraph asking every arm to use its configured development process, skills, agents and plugins in each phase. Practice, one trial per arm, 5-arm design (before arms F to H and the project setup of C, D, E were added). No effect conclusions.

## Setup

| Item | Value |
|---|---|
| Model, effort | `claude-haiku-5-5`, `high` |
| Trials | 1 round, arms A to E, order D C B E A (seed 19) |
| BenchKeeper commit | `eec2d0f` (clean tree) |
| Account | owner's Max subscription (organization `9653e407-...`) |
| Image IDs | `2026-10-14-winery-workflow-haiku/manifest.txt` |

## Results

| Arm | Features (of 6) | axe violations | Lighthouse perf | Source lines | Test lines | Minutes | USD (API-equivalent) |
|---|---|---|---|---|---|---|---|
| A | 6 | 0 | 100 | 408 | 505 | 5.0 | 0.075 |
| B | 6 | 0 | 100 | 288 | 243 | 3.5 | 0.047 |
| C | 6 | 0 | 100 | 281 | 354 | 7.9 | 0.197 |
| D | 6 | 0 | 100 | 331 | 222 | 5.8 | 0.074 |
| E | 6 | 0 | 100 | 352 | 278 | 8.1 | 0.697 |

Workflow trace per trial:

| Arm | Turns | Tool calls | Skill calls | Agent calls | Plan or spec file | Tests before source | Output tokens | Cache-read tokens |
|---|---|---|---|---|---|---|---|---|
| A | 53 | 54 | `run` (built-in) | general-purpose | no | yes | 63,017 | 2,685,193 |
| B | 27 | 25 | `run` (built-in) | none | no | yes | 46,163 | 1,277,360 |
| C | 49 | 62 | none | `agent-skills:code-reviewer`, `agent-skills:security-auditor` | no | yes | 117,014 | 3,698,712 |
| D | 47 | 48 | `superpowers:brainstorming`, `superpowers:writing-plans`, `superpowers:requesting-code-review` | general-purpose | `docs/superpowers/plans/2026-10-14-tasting-booking-app.md` | yes | 75,489 | 1,477,145 |
| E | 58 | 60 | none | `code-reviewer`, `security-reviewer` | no | yes | 85,997 | 4,854,706 |

All 5 trials passed the delivery audit; every agent's own tests passed; no trial stalled or ended with a question.

## Observations (Haiku, one trial each)

- Compared with the unprompted stage 0 run, the process request changed behavior in every arm: all five wrote tests before source files (none did unprompted).
- Superpowers (D) ran its own flow end to end (brainstorming, a written plan, code review) and did not stall headless.
- BenchKeeper (C) and ECC (E) ran review and security agents but invoked no skill and wrote no plan or spec. C had no project setup in this run (no OpenSpec in the workspace).
- ECC (E) cost the most: 4.85M cache-read tokens over 58 turns, about 15 times arm B's cost. Likely cause (unverified): its always-loaded rule files are part of the context on every turn.
- The request also raised cost in every arm (1.6 to 17 times the unprompted run).

## Data

`2026-10-14-winery-workflow-haiku/`: `manifest.txt`, and per arm `trial.json` and `transcript.jsonl.gz`.
