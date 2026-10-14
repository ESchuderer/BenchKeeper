# Design

## Router location

The tiers live in `rules/global.md`, which every session loads, at a few hundred tokens and no extra call. A router skill would add a tool call and its body per request; the agent-skills router measured +3.5k tokens per session with the same routing result ([agent-skills#433](https://github.com/addyosmani/agent-skills/issues/433)). Claude Code already selects skills by their descriptions, so the `using-agent-skills` line is replaced by that.

## Models and effort

OpenSpec cannot switch models; a hint in `tasks.md` is not enforced. The Claude Code Agent tool takes a per-call `model` and `effort` ([subagents](https://code.claude.com/docs/en/sub-agents)). The rules set Sonnet for research workers, after Anthropic's research system (Opus lead, Sonnet subagents, +90.2% on its internal eval, about 15x chat tokens; [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)). Other model choices stay with the user; no independent study shows cheaper-model routing keeps quality. Codex: per-call model unverified, so the rule is marked Claude Code.

## Project default

`AGENTS.md` wins over the global rules, so a `Default tier:` line there needs no new mechanism. `project-setup` step 5 asks for it with the spec tool. Per-project plugin disabling is skipped: agent-skills lists about 2.8k tokens and has no hooks.

## scientific-agent-skills

Domain science (biology, chemistry, medicine), not tool or literature research; many skills install Python packages and need API keys, which `project-setup` step 4 already vets per skill. Not added as a profile.
