# RTK

[Repository](https://github.com/rtk-ai/rtk), Category: context tools, Checked 2026-10-14, Decision: Not in

## Advertised

- 60 to 90% fewer tokens.

## Independent evidence

- [JetBrains](https://blog.jetbrains.com/ai/2026/07/rtk-claude-code-token-savings/) (rtk 0.43.0, Claude Code, Sonnet 5, 86 SkillsBench tasks): median cost +7.6% at low effort (p=0.004), +0.1% at high effort (p=0.99), quality unchanged.
- [Quesma](https://quesma.com/blog/does-rtk-make-ai-coding-cheaper/) (rtk 0.45.0, Terminal-Bench 2.1, 5 runs per task): total bill -5% on Claude Code with Fable 5.0, almost all from one task, +5% on OpenCode with DeepSeek. Pass rate 84% vs 83% and 71% vs 69%.
- Releases 0.46 to 0.51 add filters and hook fixes, no new measurement.

## User reports

Bill measurements are flat or higher. Savings figures come from `rtk gain`, which counts command output, not the bill.
- [rtk#582](https://github.com/rtk-ai/rtk/issues/582): one debugging task, cost +18% and output tokens +50% with the hook. A maintainer's re-run in the thread: output tokens -7.5% (within noise), cost +6.62% in 10-minute sessions.
- [rtk#2012](https://github.com/rtk-ai/rtk/issues/2012) (LogDx-CI, 35 CI failure logs, 3 model families): diagnosis score about 0.25 to 0.47 with RTK variants vs about 0.63 to 0.67 with grep and tail or an LLM summary.
- [rtk#3175](https://github.com/rtk-ai/rtk/issues/3175): usage limits reached faster with the hook on (no metrics, one user reports the opposite).
- Problems: failures stripped from test output ([#2727](https://github.com/rtk-ai/rtk/issues/2727)), truncated git and grep output ([#1313](https://github.com/rtk-ai/rtk/issues/1313)), `rtk grep` not grep-compatible ([#1436](https://github.com/rtk-ai/rtk/issues/1436)), elided lines not recoverable ([#4098](https://github.com/rtk-ai/rtk/issues/4098)), `rtk gain` counts output the agent piped to `tail` ([#1973](https://github.com/rtk-ai/rtk/issues/1973)).

## Decision

Not in: no measured saving, small cost increase in some settings.

[All evaluations](../../EVALUATIONS.md)
