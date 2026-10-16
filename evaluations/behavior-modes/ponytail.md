# Ponytail

[Repository](https://github.com/DietrichGebert/ponytail), Category: behavior modes, Checked 2026-10-16, Decision: In, evidence mixed

## Advertised

- -53% lines of code, -26% cost (Ponytail 5, [vendor benchmark](https://github.com/DietrichGebert/ponytail/blob/main/benchmarks/README.md)). Earlier figures: -54% code, -20% cost (v4.8.4).

## Independent evidence

- [JetBrains](https://blog.jetbrains.com/ai/2026/07/ponytail-skill-claude-tested/) (v4.8.4, Claude Code, Sonnet 5 medium, 80 paired SkillsBench tasks): cost -10.3% (p=0.004), code about -15% (p=0.088), time -11%; 65 of 80 tasks identical score; needs the SessionStart hook, the skill did not self-activate. Installed v5.2.0 is not re-measured.
- [ponytail#685](https://github.com/DietrichGebert/ponytail/issues/685) (Claude Code 2.1.220, plugin installed, commit 14a0d79, Sonnet 5, 5 tasks x 8 runs, 3 arms): cost vs no skill +0.7% (CI -6.5 to +9.8); vs a one-sentence prompt +6.9% (p<1e-4); lines -20%, output tokens -12%.
- [Deepusleepy v3](https://github.com/Deepusleepy/ponytail-benchmark) (listed as KuldeepB19 in the Ponytail README, whose link redirects here; plugin installed, execution-graded, Opus 4.8, 24 tasks x 5 runs x 4 arms, 480 runs): full mode output tokens -43.8% (CI 36.2 to 50.8), statements -53.0%, correctness 99.2 vs 99.2, robustness 82.5 vs 96.7 (ultra 80.0), loss concentrated in 5 tasks.
- [Soarr01/skillbench](https://github.com/Soarr01/skillbench) (system-prompt injection, Opus 4.8, 10 tasks x 5 runs): cost +10.7%, oracle checks unchanged.
- [skill-receipts audit #1](https://github.com/sjh9714/skill-receipts/blob/main/docs/audits/ponytail.md) (competitor-run, the author ships underkill; v4.8.4, rules as CLAUDE.md without the hook, Opus 4.8, 12 tasks x 5 runs): source lines -27.9%, accuracy 60/60 both, cost per run +53%, test lines +11.
- [Scott Logic](https://blog.scottlogic.com/2026/06/16/ponytail-yagni-and-the-problem-with-prompt-benchmarks.html) (vendor promptfoo suite, Haiku, 5 tasks, early June version): lines 108 baseline, 8.25 Ponytail, 6.9 with a seven-word YAGNI prompt.
- [ponytail#121](https://github.com/DietrichGebert/ponytail/issues/121) (Cursor SDK, 1 run per model): cost +6% to +55%.

Contradictions: JetBrains reports cost -10.3% (SkillsBench, Sonnet 5, rules injected); the other sources report +0.7% to +55%. Injection method (hook, CLAUDE.md, system prompt), model and task type differ. Line and output-token reductions agree across the sources that measured them. Deepusleepy reports a robustness loss; JetBrains did not measure robustness.

## Benchmark

Arms: B (Ponytail alone), O and P (with OpenSpec or Spec Kit), and every BenchKeeper layer arm (L, M, N, X, C, D, E, Y). Recorded runs on Haiku 5.5 and Sonnet 5.5, one trial per arm and model, descriptive only: [winery-react](../../bench/results/2026-10-15-winery-react.md), [cartridges](../../bench/results/2026-10-16-cartridges.md). Arm definitions: [bench/SCENARIOS.md](../../bench/SCENARIOS.md).

## Skill authoring check

Rank 1 of 8, review 3.9, static checks 97% (5.2.0), conciseness 4, structure 4. A SubagentStart hook injects the core skill into every subagent. `ponytail-review` and `ponytail-audit` are nearly identical. No evaluations. Details: [bench/results/2026-10-16-skill-authoring.md](../../bench/results/2026-10-16-skill-authoring.md) (#58).

## Decision

In, evidence mixed: line reductions are consistent across sources, and the cost direction depends on the setup. BenchKeeper's own runs: Benchmark above (one trial per arm).

[All evaluations](../../EVALUATIONS.md)
