# andrej-karpathy-skills

[Repository](https://github.com/multica-ai/andrej-karpathy-skills), Category: skill libraries, Checked 2026-10-16, Decision: Not in

## Advertised

One `CLAUDE.md` (also a skill and a plugin) with four principles derived from [Andrej Karpathy's post](https://x.com/karpathy/status/2015883857489522876) (2026-01-26) on LLM coding pitfalls: think before coding (state assumptions, ask, surface tradeoffs), simplicity, surgical changes, goal-driven execution. 220,232 stars, last commit 2026-04-20 (`2c60614`), no releases. No LICENSE file, MIT is declared only in `skills/karpathy-guidelines/SKILL.md` and `.claude-plugin/plugin.json` (GitHub API, 2026-10-16).

- "reducing costly mistakes on non-trivial work". The repository publishes no benchmark.
- Blogs claim mistakes falling from 41% to 3% and accuracy rising from 65 to 70% to 91 to 94% (for example [AI Builder Club](https://www.aibuilderclub.com/blog/karpathy-claude-md-rules)). No method published, unverified.

## Independent evidence

- [skill-receipts audit](https://github.com/sjh9714/skill-receipts/blob/main/docs/audits/karpathy.md) (commit 2c60614, Claude Code, claude-opus-4-8, effort not stated, 12 small tasks with hidden tests, 5 runs per arm, rules-only injection): accuracy 60/60 in every arm, median source lines -4.8% (within noise), median cost +11.5%, no p-values. The author sells a competing ruleset (conflict of interest).
- [Soarr01/skillbench](https://github.com/Soarr01/skillbench) (system-prompt injection, `claude -p`, Opus 4.8, 10 tasks x 5 runs): cost +6.6% (95% CI +5.1 to +12.4%), oracle checks unchanged. Sonnet 4.6 +3.0% and Haiku 4.5 +4.9% (within noise).
- Context files in general, [arXiv 2602.11988](https://arxiv.org/abs/2602.11988) (ETH; Claude Code with Sonnet 4.5, Codex with GPT-5.2 and 5.1-mini, Qwen3-30B, SWE-bench Lite 300 and CTXBench 138 tasks, 1 sample): LLM-written files -0.5% and -2% resolution (p=0.87, 0.37), developer-written files +2.4% (p=0.21), cost +20 to 23%. Useful for non-standard practices. See [AGENTS.md overviews](../practices/agents-md-overviews.md).

## User reports

Thread "Top Agent Skills Repositories" (r/claudeskills, about 2 months old, text supplied by the owner, URL not recorded). Opinions, no measurements.
- One user runs agent-skills fully plus the Karpathy guidelines.

Thread "Karpathy-Inspired Claude Code Guidelines" (r/BestGitHubRepos, about 2026-10-11, screenshots supplied by the owner, Reddit cannot be fetched). Its claims, checked:

| Claim | Verdict | Evidence |
|---|---|---|
| Boris Cherny said to delete CLAUDE.md and "let Claude run free" | Partly true (high) | YC Startup School 2026 ([video](https://www.youtube.com/watch?v=qyPCVqFUyDo), 2026-07-27): "every six months, delete your CLAUDE.md, delete your skills, delete your hooks. See what the model does". Then "Only when you see it repeatedly stumble on the same thing, that's when you add it back." Periodic delete and re-add, not abolition. "run free" does not appear. |
| Keep workflow-specific instructions, drop generic ones | Matches Anthropic guidance (medium, anecdote) | [Claude Code best practices](https://code.claude.com/docs/en/best-practices): include what Claude cannot guess, exclude standard conventions and self-evident practices. "If Claude already does something correctly without the instruction, delete it." |
| These rules are baked into the system prompt. .md files cannot lift a smaller model to a larger one | Partly true (medium) | Claude Code's system prompt is not published (the [system prompts page](https://platform.claude.com/docs/en/release-notes/system-prompts) covers the Claude apps only). An extracted copy (third party, [Piebald-AI](https://github.com/Piebald-AI/claude-code-system-prompts), v2.1.300, unverified) has simplicity and scope rules ("Don't add features, refactor, or introduce abstractions beyond what the task requires") but tells the model to check in only when readings lead to materially different work, the opposite of "ask when uncertain". The model-tier claim has no direct test. |
| Frontier Claude models already do all of this | Unverified, leaning false for scope (low) | No independent measurement on Opus 5 or 5.5, Sonnet 5.5 or Fable. Anthropic's guides say Opus 5 "can also expand the scope of a task" ([Opus 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)) and Sonnet 5.5 "tends to add tests, documentation, and small supporting files" ([Sonnet 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5)) (vendor, no numbers). |

## Decision

Not in: four principles that overlap Ponytail, the Claude Code system prompt and `rules/global.md`. Measured cost +6.6% to +11.5% with accuracy unchanged.

Effect on BenchKeeper: `rules/global.md` was trimmed in setup-v2.3 (`CHANGELOG.md`): lines that repeat Claude Code defaults or other BenchKeeper files were removed. The ask rule (owner decision) asks only where an open point would change the result (setup-v2.4), close to the extracted system prompt's "check in only when different readings would lead to materially different work"; since setup-v6.0 it asks all open questions in one round. The restatement before work was removed in setup-v6.0, without a measurement either way.

[All evaluations](../../EVALUATIONS.md)
