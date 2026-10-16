# codegraph

[Repository](https://github.com/colbymchenry/codegraph), Category: context tools, Checked 2026-10-14, Decision: Not in

## Advertised

- 62% fewer tokens, 44% cheaper (README: 7 repositories, one question each, median of 4 runs, no quality measure).

## Independent evidence

- [Repowise](https://repowise.dev/blog/comparisons/serena-vs-graphify-vs-codegraph-vs-repowise) (competitor-run; Codex, gpt-5.6-sol, 43 Django questions; codegraph 1.5.0): output tokens -24.4% (p<0.0001). Same run: Serena -14.8%, graphify -8.9%. Accuracy not measured.
- [samchon](https://dev.to/samchon/i-made-ts-compiler-graph-mcp-10x-fewer-tokens-in-claude-code-1aea) (competitor-run, ships @ttsc/graph; Claude Code and Codex, 4 models, 8 repositories): +22 to +27% tokens versus no MCP on zod. Worst cells codegraph +47%, Serena +93%.
- Metrics differ: Repowise counts output tokens, samchon total tokens.
- Research systems with a built-in code graph report gains ([LocAgent](https://arxiv.org/abs/2503.09089): +12% issue resolution at Pass@10, and [RepoGraph](https://arxiv.org/abs/2410.14684)), but they change the agent itself. Neither tests an add-on MCP tool.
- Add-on code tools are rarely called ([arXiv 2608.13568](https://arxiv.org/abs/2608.13568)).

## User reports

Mixed. Savings depend on how much file discovery the task needs.
- [codegraph#975](https://github.com/colbymchenry/codegraph/issues/975): private repo, DeepSeek, 3 questions, more cost with codegraph in 2 of 3. A contributor's re-run in the thread (express, Sonnet, 2 questions x 2 runs): cost -22% (mean).
- [codegraph#1500](https://github.com/colbymchenry/codegraph/issues/1500): Go monorepo, Cursor, one question: about 20K more context tokens with codegraph, same answer. The owner reports the README control arm had called the codegraph CLI in 26 of 28 runs, then re-measured after fixing it.
- Problems: daemon out of memory ([#1553](https://github.com/colbymchenry/codegraph/issues/1553)), missed Python callers ([#899](https://github.com/colbymchenry/codegraph/issues/899)).

## Decision

Not in: competitor-run token results only, accuracy not measured.

[All evaluations](../../EVALUATIONS.md)
