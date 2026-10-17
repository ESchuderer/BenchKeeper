# Context7 MCP

[Repository](https://github.com/upstash/context7), Category: context tools, Checked 2026-10-14, Decision: Not in

## Advertised

- Current library docs, fewer outdated APIs.

## Independent evidence

- [Marginlab](https://marginlab.ai/blog/do-mcps-improve-coding-agents-part-1/) (Codex, GPT-5.4 xhigh, Terminal-Bench 2.0, 89 tasks, one run per arm): 64/89 passed with Context7, 63/89 without. Called in 6 tasks, none of which changed outcome.

## User reports

Positive anecdotes without measurements ([HN](https://news.ycombinator.com/item?id=46490087): "can't be sure it is due to Context 7").
- Security: "ContextCrush", instructions planted in Context7 Custom Rules reached agents unfiltered. Demo read and exfiltrated `.env` files. Upstash deployed a fix on 2026-02-23 ([Infosecurity Magazine](https://infosecurity-magazine.com/news/contextcrush-ai-development-tools)).

## Decision

Not in: no measured benefit.

[All evaluations](../../EVALUATIONS.md)
