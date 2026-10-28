# Ponytail

[Repository](https://github.com/DietrichGebert/ponytail), Category: behavior modes, Checked 2026-10-16, Decision: Optional pack, evidence mixed

## Advertised

- -53% lines of code, -26% cost (Ponytail 5, [vendor benchmark](https://github.com/DietrichGebert/ponytail/blob/main/benchmarks/README.md)). Earlier figures: -54% code, -20% cost (v4.8.4).

## Independent evidence

- [JetBrains](https://blog.jetbrains.com/ai/2026/07/ponytail-skill-claude-tested/) (v4.8.4, Claude Code, Sonnet 5 medium, 80 paired SkillsBench tasks): cost -10.3% (p=0.004), code about -15% (p=0.088), time -11%. 65 of 80 tasks identical score. Needs the SessionStart hook, the skill did not self-activate. The app installs v5.3.2 (`PONYTAIL_REF`), not re-measured.
- [ponytail#685](https://github.com/DietrichGebert/ponytail/issues/685) (Claude Code 2.1.220, plugin installed, commit 14a0d79, Sonnet 5, 5 tasks x 8 runs, 3 arms): cost vs no skill +0.7% (CI -6.5 to +9.8), vs a one-sentence prompt +6.9% (p<1e-4). Lines -20%, output tokens -12%.
- [Deepusleepy v3](https://github.com/Deepusleepy/ponytail-benchmark) (listed as KuldeepB19 in the Ponytail README, the github.com/KuldeepB19 repository URL redirects here; plugin installed, execution-graded, Opus 4.8, 24 tasks x 5 runs x 4 arms, 480 runs): full mode output tokens -43.8% (CI 36.2 to 50.8), statements -53.0%, correctness 99.2 vs 99.2, robustness 82.5 vs 96.7 (ultra 80.0), loss concentrated in 5 tasks.
- [Soarr01/skillbench](https://github.com/Soarr01/skillbench) (system-prompt injection, Opus 4.8, 10 tasks x 5 runs): cost +10.7%, oracle checks unchanged.
- [skill-receipts audit #1](https://github.com/sjh9714/skill-receipts/blob/main/docs/audits/ponytail.md) (competitor-run, the author ships underkill; v4.8.4, rules as CLAUDE.md without the hook, Opus 4.8, 12 tasks x 5 runs): source lines -27.9%, accuracy 60/60 both, cost per run +53%, test lines +11.
- [Scott Logic](https://blog.scottlogic.com/2026/06/16/ponytail-yagni-and-the-problem-with-prompt-benchmarks.html) (vendor promptfoo suite, Haiku, 5 tasks, early June version): lines 108 baseline, 8.25 Ponytail, 6.9 with a seven-word YAGNI prompt.
- [ponytail#121](https://github.com/DietrichGebert/ponytail/issues/121) (Cursor SDK, 1 run per model): cost +6% to +55%.

Contradictions: JetBrains reports cost -10.3% (SkillsBench, Sonnet 5, rules injected). The other sources report +0.7% to +55%. Injection method (hook, CLAUDE.md, system prompt), model and task type differ. Line and output-token reductions agree across the sources that measured them. Deepusleepy reports a robustness loss. JetBrains did not measure robustness.

## Benchmark

Arms: B (Ponytail alone), AF (with Matt Pocock's skills), and the BenchKeeper arms AL and AM (with Ponytail) and AN (AL without it). Brownfield run [mistreevous](https://github.com/ESchuderer/BenchKeeper-research/blob/main/bench/results/2026-10-18-mistreevous.md) on Sonnet 5.5, k = 3, descriptive only. Ponytail alone (B) cost 0.58 times plain Claude Code (A, API-equivalent USD) and took 0.59 times the time, at a median score of 87.6 against 87.0. With Matt Pocock's skills (AF): 0.53 times the cost, score 84.6. Without Ponytail the BenchKeeper arm (AN) scored 3.5 higher than with it (AL) at 1.8 times the cost. Arm definitions: [bench/SCENARIOS.md](https://github.com/ESchuderer/BenchKeeper-research/blob/main/bench/SCENARIOS.md).

## Skill authoring check

Rank 1 of 8, review 3.9, static checks 97% (5.2.0), conciseness 4, structure 4. A SubagentStart hook injects the core skill into every subagent. `ponytail-review` and `ponytail-audit` are nearly identical. No evaluations. Details: [bench/results/2026-10-16-skill-authoring.md](../../bench/results/2026-10-16-skill-authoring.md).

## Decision

Optional pack (`ponytail`), evidence mixed: line reductions are consistent across sources, and the cost direction depends on the setup. BenchKeeper's own run: Benchmark above (k = 3).

[All evaluations](../../EVALUATIONS.md)
