# Pi

[Website](https://pi.dev), Category: agent harnesses, Checked 2026-10-14, Decision: Not in

## Advertised

- Minimal, extensible agent harness.
- Reads `AGENTS.md`, Agent Skills (`~/.agents/skills/`) and MCP ([configuration](https://pi.dev/docs/latest/configuration), [skills](https://pi.dev/docs/latest/skills)). Ponytail and agent-skills ship as Claude Code and Codex plugins.

## Independent evidence

- No independent benchmark against Claude Code or Codex found.
- Subscription terms: Pi offers `/login` with a Claude Pro/Max subscription, Sign in with ChatGPT, and GitHub Copilot ([pi-ai README](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)). Anthropic's terms limit Free, Pro and Max OAuth to Claude Code and Anthropic's own apps, do not permit third-party developers to route requests through those credentials, and reserve enforcement without notice ([Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)). Reports describe tools blocked since January 2026 ([GIGAZINE](https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block)). Pi is a separate harness that sends its own requests to Anthropic's API. The terms permit a subscription only in the unmodified Claude Code binary. [pi-claude-code-auth](https://github.com/cgaravitoq/pi-claude-code-auth) warns of account suspensions with the same mechanism in OpenCode. Within the terms, Claude models in Pi need an API key.

## User reports

Strong user enthusiasm, measured comparisons are vendor-run.
- [Composio](https://composio.dev/content/pi-agent-vs-claude-code) (vendor, supplied the MCP router used; DeepSeek V4 Flash, 30 tasks): Pi 20/30 at $0.56, Claude Code 16/30 at $3.12. Reasoning settings differed.
- [HN thread](https://news.ycombinator.com/item?id=46844822): users switching from Claude Code and Codex. No sandbox by default ([comment](https://news.ycombinator.com/item?id=46845370)).
- Pi users report the subscription failing or billing as extra usage:
  - [pi#1311](https://github.com/earendil-works/pi/issues/1311) (2026-02-06): `This credential is only authorized for use with Claude Code`.
  - [pi#2943](https://github.com/earendil-works/pi/issues/2943) (2026-04-08, Max plan): `You're out of extra usage`. Other users confirm in the thread.
  - [pi#3012](https://github.com/earendil-works/pi/issues/3012) (2026-04-10): `Third-party apps now draw from your extra usage, not your plan limits`.
  - [pi#3401](https://github.com/earendil-works/pi/issues/3401): Pi shows a startup warning that subscription use draws from extra usage.
  - [pi#6888](https://github.com/earendil-works/pi/issues/6888) (2026-07-20) and [pi#9838](https://github.com/earendil-works/pi/issues/9838) (2026-09-21): requests with Pi's default system prompt are classified as third-party. A replaced prompt bills against the plan, a workaround outside the terms. OpenAI's terms for ChatGPT sign-in in Pi: unverified.

## Decision

Not in: no independent benchmark. Claude subscription use is outside Anthropic's terms.

[All evaluations](../../EVALUATIONS.md)
