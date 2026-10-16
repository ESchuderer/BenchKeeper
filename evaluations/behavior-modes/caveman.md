# caveman

[Repository](https://github.com/JuliusBrussee/caveman), Category: behavior modes, Checked 2026-10-16, Decision: Not in, never part of BenchKeeper

## Advertised

- -65% tokens ("cuts 65% of tokens", repository description).

## Independent evidence

- [JetBrains Part 1, caveman skill](https://blog.jetbrains.com/ai/2026/07/speak-to-ai-agents-like-cavemen-tosave-tokens/) (Harbor 0.17, Claude Code 2.1.200, claude-sonnet-5 low effort, SkillsBench 86 tasks, 82 pairs, k=3): output tokens -8.5%. Score 0.326 vs 0.311 (p=0.82).
- [skill-receipts audit #2](https://github.com/sjh9714/skill-receipts/blob/main/docs/audits/caveman.md) (competitor-run, the author ships underkill; v1.9.1, Opus 4.8, 4 tasks x 5 runs, off arm 8): median cost $0.183 vs $0.163 (with vs without), higher on all 4 tasks. Accuracy 20/20.
- [caveman#727](https://github.com/JuliusBrussee/caveman/issues/727) (competitor-run, LemonCrow; Opus 4.8, 20 prompts x 5 runs x 3 batches): cost +0.06%, output tokens -44.1%.
- [Soarr01/skillbench](https://github.com/Soarr01/skillbench) (system-prompt injection, Opus 4.8): cost +14.9%.
- Every source that measured cost reports it not reduced.

## Decision

Not in, never part of BenchKeeper.

[All evaluations](../../EVALUATIONS.md)
