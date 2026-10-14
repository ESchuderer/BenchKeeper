# Winery brief on Claude Haiku 5.5, 8 arms

Run 2026-10-14, protocol `bench/PROTOCOL.md` v0.5. Practice: one trial per arm, no effect conclusions. This run replaces the earlier Haiku runs of the day (5-arm design, before project setup, follow-up rule and rules fix; they remain in the git history of `feat/19-paired-benchmark`).

## Setup

| Item | Value |
|---|---|
| Model, effort | `claude-haiku-5-5`, `high` |
| Trials | 1 round, 8 arms, order A G H F D B C E (seed 21) |
| BenchKeeper commit | `5ec0739` (clean tree; rules include the non-interactive phase fix from `fix/headless-phases`) |
| Claude Code | 2.1.299 |
| Host | Linux 7.2.9 CachyOS x86_64, 16 CPUs, 31 GB, podman 6.1.3 |
| Account | owner's Max subscription (organization `9653e407-...`); the PiMetry Team token could not be created (`invalid_request_error` "Invalid request format") |
| Image IDs | `2026-10-14-winery-haiku/manifest.txt` |

Arms: A stock; B Ponytail; F agent-skills, G Superpowers, H ECC `minimal`, each alone; C, D, E the same frameworks with the BenchKeeper layer (rules, Ponytail, find-skills, BenchKeeper skills, and a project set up by `/project-setup` with OpenSpec and Playwright MCP).

## Results

From `bench/scripts/summary.mjs`; one trial per arm, so each value is that trial.

| Arm | Features (of 6) | Follow-ups | Lighthouse perf | axe violations | Tests written | Review ran | Source lines | Minutes | USD (API-equivalent) |
|---|---|---|---|---|---|---|---|---|---|
| A | 6 | 0 | 100 | 0 | yes | no | 503 | 3.1 | 0.035 |
| B | 6 | 0 | 100 | 0 | yes | no | 156 | 2.2 | 0.024 |
| F | 6 | 0 | 100 | 0 | yes | no | 736 | 3.4 | 0.041 |
| G | 6 | 0 | 100 | 0 | yes | no | 404 | 3.4 | 0.046 |
| H | 6 | 0 | 100 | 0 | yes | yes | 891 | 5.2 | 0.296 |
| C | 6 | 1 | 100 | 0 | yes | yes | 255 | 8.5 | 0.472 |
| D | 6 | 0 | 100 | 0 | yes | no | 183 | 2.7 | 0.040 |
| E | 6 | 0 | 100 | 0 | yes | no | 304 | 3.0 | 0.045 |

USD is Claude Code's `total_cost_usd` estimate at list prices; nothing was billed beyond the subscription. Cost and tokens come from the last result per session (protocol v0.6); the first version of this report summed C's two turns and showed USD 0.497, counting the first turn twice.

Workflow trace per trial (`round-1/<arm>/trial.json`):

| Arm | Turns | Tool calls | Skill calls | Agent calls | Spec or plan files | Tests before source | Output tokens | Cache-read tokens | Test lines |
|---|---|---|---|---|---|---|---|---|---|
| A | 19 | 18 | none | none | 0 | no | 38,398 | 779,973 | 213 |
| B | 13 | 12 | none | none | 0 | no | 28,046 | 416,916 | 70 |
| F | 24 | 23 | none | none | 0 | no | 44,827 | 872,319 | 307 |
| G | 35 | 32 | `superpowers:brainstorming`, `superpowers:test-driven-development` | none | 0 | yes | 39,649 | 1,625,785 | 373 |
| H | 34 | 36 | none | `code-reviewer` | 0 | yes | 59,573 | 2,798,261 | 541 |
| C | 103 | 112 | `openspec-propose`, `openspec-apply-change` | `agent-skills:code-reviewer` (2 rounds) | 6 (OpenSpec change) | yes | 95,278 | 8,291,193 | 417 |
| D | 39 | 38 | none | none | 0 | no | 30,271 | 1,439,597 | 104 |
| E | 17 | 16 | none | none | 0 | no | 36,574 | 1,188,753 | 139 |

Every trial passed the delivery audit; every agent's own tests passed (exit 0); Lighthouse accessibility 1.00 everywhere; no trial ended with a question.

## Observations (Haiku, one trial each; not evidence for other models)

- All eight arms built a working app with all six hidden features and no axe violations; the differences are in process and cost.
- Arm C (BenchKeeper with agent-skills) is the only arm that ran a full SDLC: an OpenSpec change (proposal, two specs, design, tasks), tests first, five atomic commits on a feature branch, a browser walkthrough through Playwright MCP, two code review rounds with fixes. It cost the most (8.5 minutes, USD 0.47).
- Arm C stopped once after writing the OpenSpec change ("implementation starts only when you run `/openspec-apply-change`") and continued after the fixed follow-up message. The rules fix (continue through every phase in non-interactive runs) did not prevent that stop on Haiku: the OpenSpec skill's stop instruction won. In the replaced run without the rules fix and without the follow-up rule, the same stop left no app (0 of 6 features).
- With the BenchKeeper layer, Superpowers (D) and ECC (E) ran less of their own flow than alone: G ran brainstorming and TDD with tests first, D ran neither; H ran ECC's code reviewer with tests first, E did not. Cost and size were also lower with the layer (D 0.040 vs G 0.046; E 0.045 vs H 0.296).
- ECC alone (H) wrote the most code (891 source lines) and used the most cache-read tokens after C.
- Ponytail only (B) was the smallest and cheapest app (156 lines, USD 0.024).

## Improvement candidates for BenchKeeper (from this run)

- Name the OpenSpec step in the non-interactive rule: after `openspec-propose`, continue with `openspec-apply-change`.
- Check why the BenchKeeper base rules suppress Superpowers' and ECC's own flow (D, E) and whether that is wanted.

## Data

`2026-10-14-winery-haiku/`: `manifest.txt`, and per arm in `round-1/<arm>/`: `trial.json`, `transcript.jsonl.gz`, the built app (`app.tar.gz`, source and git history without `node_modules`) and screenshots of the start, form, confirmation and staff pages.
