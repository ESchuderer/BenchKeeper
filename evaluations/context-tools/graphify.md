# graphify

[Repository](https://github.com/Graphify-Labs/graphify), Category: context tools, Checked 2026-10-14, Decision: Not in

## Advertised

- 71.5x fewer tokens per query (52-file corpus of mostly papers and images).

## Independent evidence

- No independent evaluation found.

## User reports

No report measures a lower bill.
- [graphify#4341](https://github.com/Graphify-Labs/graphify/issues/4341) (177 SWE-bench Lite issues): right file first in 25% of queries vs 32% for BM25; in the top 5 in 38% vs 64%.
- [graphify#985](https://github.com/Graphify-Labs/graphify/issues/985): 1,484-file corpus, Claude Code alone gave similar answers with the same or fewer tokens; each query about 2K tokens.
- [graphify#580](https://github.com/Graphify-Labs/graphify/issues/580): more tokens with graphify because the agent reads the graph report first.

## Decision

Not in: no independent evidence; user reports show lower retrieval accuracy than BM25.

[All evaluations](../../EVALUATIONS.md)
