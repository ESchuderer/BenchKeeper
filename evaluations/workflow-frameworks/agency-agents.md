# agency-agents

[Repository](https://github.com/msitarzewski/agency-agents), Category: workflow frameworks, Checked 2026-10-25, Decision: Optional parts, a pick of agent files per project (setup-v6.7)

## Advertised

- A roster of specialist agent files (about 279 by the installer's own count) with "success metrics" per agent. The README's only outcome line is "Ship faster with specialized expertise at every stage" ([README](https://github.com/msitarzewski/agency-agents#readme)): no number, no baseline.
- 163,797 stars, MIT, no release (GitHub API, 2026-10-25).

## Independent evidence

- None found. Only the repository and its README were read for this entry: a search for independent measurements has not been done (unverified).
- Static facts: agents only, no hooks, no plugin. The Claude Code install copies agent files; the Codex files need the project's `convert.sh` first. The full agent bodies are about a million tokens, so installing the roster is not an option (README, section on token cost).

## User reports

Not collected.

## Benchmark

Not run as an arm.

## Skill authoring check

Not applicable: the entry ships agent files, not skills.

## Decision

Optional parts, never the whole roster. Project setup offers six agent files (frontend developer, backend architect, technical writer, security architect, accessibility auditor, reality checker) and fetches each from a pinned commit into `.claude/agents/` of the project (Claude Code only). Each file is a prompt whose description is listed in the session context and whose body loads when the agent runs (unverified, not measured here). No outcome measurement found in either direction (search for independent measurements not done, unverified), so the entry stays optional.

[All evaluations](../../EVALUATIONS.md)
