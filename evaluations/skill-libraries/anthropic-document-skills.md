# Anthropic document skills

[Repository](https://github.com/anthropics/skills), Category: skill libraries, Checked 2026-10-14, Decision: Not global, per project

## Advertised

- Skills docx, xlsx, pptx, pdf. No quantitative claim.

## Independent evidence

- [DocOps, arXiv 2607.19865](https://arxiv.org/abs/2607.19865) (210 tasks): Claude Code with Sonnet 4.6 scored 0.519 with skills vs 0.552 without. Claude Code harness average across models: 664.9K vs 590.0K tokens per task. Codex with GPT-5.5 scored 0.671 vs 0.648.

## Decision

Not global, per project: the BenchKeeper library (setup-v5.0) lists `frontend-design` and `mcp-builder` for both agents, and `docx`, `pdf`, `pptx` and `xlsx` for Codex only, since Claude Code gets them from the claude.ai skills `anthropic-skills`. `doc-coauthoring` is left out: it has no license file.

[All evaluations](../../EVALUATIONS.md)
