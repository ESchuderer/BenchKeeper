# LSP plugins

Plugins: `pyright-lsp`, `typescript-lsp`, Category: context tools, Checked 2026-10-14, Decision: Not in

## Advertised

- Semantic navigation, diagnostics.

## Independent evidence

- [arXiv 2608.13568](https://arxiv.org/abs/2608.13568) (preliminary, single author; Opus 4.8, Sonnet 4.6, Haiku 4.5): 6 to 118% more tokens for symbol localization. Models chose grep for localization in most runs. Location-only LSP missed call sites in about 3 of 4 multi-file renames.
- Diagnostics after edits not measured.

## User reports

References and diagnostics help in some setups. Agents rarely call LSP unless told to.
- [Scott Spence](https://scottspence.com/posts/revisiting-lsp-in-claude-code): 32 LSP calls in about 650 sessions, none `findReferences`. With a CLAUDE.md rule, refactors 3/3 vs 0/3. Grep 2 to 3 turns and $0.04 to $0.08 per reference question, LSP only 7 to 12 turns and $0.07 to $0.12. First `findReferences` call wrong in 18 of 19 fresh sessions until `useSyntaxServer` was set to `"never"`. Conclusion: keep LSP for diagnostics, use grep for references.
- [CircleCI](https://circleci.com/blog/claude-code-lsp/) (publishes an LSP plugin; vuejs/core, 3 symbols, CLAUDE.md rule to prefer LSP): cost -3% (Opus 4.8) and -14% (Sonnet 4.6). Sonnet with grep missed references (9/11, 249/260), LSP found all.
- Problems: "No LSP server available" ([claude-code#14803](https://github.com/anthropics/claude-code/issues/14803)), hint-level diagnostics injected into the conversation ([claude-code#26634](https://github.com/anthropics/claude-code/issues/26634)).

## Decision

Not in: more tokens, no measured gain.

[All evaluations](../../EVALUATIONS.md)
