# Proposal

Issue: [#36](https://github.com/ESchuderer/BenchKeeper/issues/36), step 3 (trigger evals). Steps 1 and 2: change `36-skills-benchmark`.

## Why

A skill helps only if its description makes the model load it when it applies and leave it when it does not. The authoring review (`bench/results/2026-10-16-skill-authoring.md`) calls several descriptions broad or overlapping; trigger precision and recall per skill measure that directly.

## What Changes

- Prompt sets `bench/triggers/<collection>.json`: per model-invocable skill one eval set in the format of the vendored `run_eval.py` (`query`, `should_trigger`; optional `near_miss_of`, which `run_eval` ignores), 8 should-trigger and 8 should-not-trigger queries, at least 4 negatives being near-misses that belong to a named sibling skill.
- Harness `bench/scripts/trigger-eval.sh`: one collection, model, effort and runs per query as parameters; one container per skill; the usage gate of `bench/run-brief.sh` before each skill; results and manifest in `bench/runs/triggers-<collection>-<model>-<effort>/`.
- Summary `bench/scripts/trigger-summary.mjs`: per-skill recall, precision and false triggers as a Markdown table.
- Smoke test `bench/scripts/trigger-eval.smoke.sh` with a fake `claude` (no network, no credentials); test of the prompt sets.
- Protocol entry; no protocol version bump (no published result changes).

## Decisions

- Image: `bench/image/triggers.Containerfile` derives from the pinned arm image (`benchkeeper-arm-<x>`) and adds Debian's `python3=3.11.2-1+b1`; `run_eval.py` needs Python 3.10 or later and only the standard library, so the vendored scripts run unchanged against the same Claude Code 2.1.299 and the same installed skills as the trials. A port would diverge from the vendored scripts; a separate Python container cannot reach the arm's `claude`.
- Hiding the target: `run_eval` injects the description as a command named `<name>-skill-<id>`; the installed copy gets `disable-model-invocation: true` in the throwaway container, which removes it from the model's context ([Claude Code skills](https://code.claude.com/docs/en/skills)) while plugin manifests that list skill paths stay valid. One worker per container: with more, other workers' injected copies would compete with the measured one.
- Effort: `run_eval` has no effort option; a wrapper on `PATH` adds `--effort`.
- Query counts: 8 plus 8 per skill, the lower end of the vendored guide's 8 to 10 each (`.agents/skills/skill-creator/SKILL.md`, "Generate trigger eval queries"); this change measures and does not tune descriptions, so no holdout split is needed. ECC `continuous-learning`, whose description says not to invoke it, has 16 negatives.
- Excluded: the 19 skills with `disable-model-invocation: true` (16 Matt Pocock, 3 BenchKeeper); the model never sees them, so injecting them as invocable would measure a case that cannot occur. ECC's `auto-update` and `setup-pm` (listed by Claude Code, no SKILL.md) are left out because `run_eval` needs a SKILL.md. No plugin command shares a tested skill's name in a form Claude Code loads (Ponytail's `commands/` are Gemini `.toml` files; its recorded init event lists each skill once).
- Caveat: Ponytail's `ponytail` and Superpowers' `using-superpowers` are loaded by session hooks in practice; their numbers describe the description only.
- Caveat: `run_eval` scores a first tool call other than the injected command as not triggered, also a call of the hidden skill by its original name; Superpowers' session-start text names `superpowers:brainstorming` and `superpowers:systematic-debugging`, so their recall can read low. The project is a git repository with one commit, as in the trials.
- Placement: each collection runs in its own arm image (OpenSpec and Spec Kit in a copy of the arm's project template); BenchKeeper's `following-dev-workflow` runs in the agent-skills arm with `skills/` copied into `~/.claude/skills`, as `/global-setup` installs it.

## Sizing (unverified estimate)

- Queries: 122 skills times 16 = 1952; with 3 runs per query 5856 `claude -p` calls, plus one gate request per skill.
- Tokens per call: the first assistant turn of the saved winery-react trials (`round-1/<arm>/transcript.jsonl.gz`) read 17k to 22k prompt tokens, about 14k from cache and 3k to 7k written (ECC arm H: 13k read, 29k written). A trigger call ends at the first tool call; assumed 300 output tokens. The command name changes per call, so the written part may not be reused.
- API-equivalent cost per call, with the price per token implied by the trials' `total_cost_usd` (Haiku 5.5 about 0.39 USD per million input-equivalent tokens, Sonnet 5.5 about 1.75, cache reads at 0.1, writes at 1.25 and output at 5 times input): Haiku USD 0.004 (ECC 0.015), without any cache USD 0.010 (ECC 0.021). All collections: Haiku USD 50 to 85, Sonnet 4.5 times that, USD 220 to 380. Each 1000 thinking tokens add about USD 12 (Haiku).
- Subscription share, from the Max-account usage readings in `bench/results/2026-10-15-winery-react-{haiku,sonnet}/manifest.txt`: Sonnet trials of USD 19.8 API-equivalent moved the 5-hour window from 0.00 to 0.34 and the weekly from 0.96 to 0.98; Haiku trials of USD 20.5 moved them from 0.09 to 0.37 and 0.93 to 0.95. So USD 60 to 75 per 5-hour window and USD 7 to 20 per weekly point (two-decimal readings). Haiku run: 0.7 to 1.4 five-hour windows, 3 to 12 weekly points. Sonnet run: 3 to 6.5 windows, 11 to 55 weekly points. Confidence low: few readings, in-flight trials at the window edges, unknown per-call cache use and thinking length.
- Time: assumed 10 to 20 s per call at one worker (Claude Code start, hooks, first turn), 16 to 33 hours for all collections; the Ponytail pilot runs alone on the subscription (its gate readings calibrate this estimate only then), later collections may run in parallel as separate invocations.
- Order (most overlapping descriptions first, Ponytail doubling as a pilot whose gate readings calibrate the estimate): Ponytail (review and audit overlap, generic review triggers), agent-skills (stress-test trio, review, "any code change"), Superpowers (catch-all triggers), Spec Kit (no when-clause), Matt Pocock, BenchKeeper, OpenSpec, ECC last (largest and twice the prompt per call).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `benchmark-briefs`: trigger evals per skill.

## Impact

`bench/triggers/`, `bench/image/triggers.Containerfile`, `bench/scripts/trigger-eval.sh`, `trigger-summary.mjs`, `trigger-eval.smoke.sh`, tests, `bench/PROTOCOL.md`. Runs use the owner's subscription token only.
