# Serena MCP

[Repository](https://github.com/oraios/serena), Category: context tools, Checked 2026-10-14, Decision: Not in

## Advertised

- "faster, more efficiently and more reliably"

## Independent evidence

- Run by the author of a competing tool (Claude Code, Opus 4.7, runs not stated): quality 83.4% vs 84.2% without, tokens 14,800 vs 12,716, time 191 vs 185 s ([dev.to](https://dev.to/luuuc/how-do-you-benchmark-an-mcp-server-you-built-2e8j)).
- [Repowise](https://repowise.dev/blog/comparisons/serena-vs-graphify-vs-codegraph-vs-repowise) (competitor-run; Codex, gpt-5.6-sol, 43 Django questions; Serena 1.6.2.dev0): output tokens -14.8% (p<0.0001). Same run: codegraph -24.4%, graphify -8.9%. Accuracy not measured.
- [samchon](https://dev.to/samchon/i-made-ts-compiler-graph-mcp-10x-fewer-tokens-in-claude-code-1aea) (competitor-run, ships @ttsc/graph; Claude Code and Codex, 4 models, 8 repositories): +22 to +27% tokens versus no MCP on zod. Worst cells codegraph +47%, Serena +93%. Serena median 0 to 1 MCP calls.
- Metrics differ: Repowise counts output tokens, samchon total tokens.

## Decision

Not in: no measured gain.

[All evaluations](../../EVALUATIONS.md)
