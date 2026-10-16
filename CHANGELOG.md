# Changelog

Versions of the BenchKeeper setup (rules, skills, permission rules, recommended stack). Each version is a git tag `setup-v<major>.<minor>`; benchmark results name the setup version they measured. Major: the layout or the behavior of the rules changes; minor: additions and fixes.

## setup-v2.0 (unreleased)

Claude Code best practices applied (#37, https://code.claude.com/docs/en/best-practices).

- `rules/global.md`: always-on core only (651 words, was 2,140); it loads the new `sdlc` skill before any edit in a repository and before research with several items. Hard limits (default branch, merges) stay in the core.
- `skills/sdlc`: task tiers, change types, issue, branch and pull request flow, SDLC phases, research flow (moved from the rules).
- `skills/maintain`: the Maintain pass, user-invoked only, with `/doctor prompt-audit` and `/skill-doctor`.
- Permission rules (Claude Code, `global-setup` part 11, native rules, no hooks): deny skipping git hooks (`--no-verify`, `commit -n`); ask before force pushes, remote and local branch deletion, pushes to `main` or `master`, hard resets, `git clean`, rebases, history rewrites, `gh pr merge`, `gh repo delete`, `gh release delete`. Em dashes, emojis and commits on the default branch stay prose rules.
- `global-setup` and `project-setup`: `disable-model-invocation: true` (they never start on their own; the rules tell the agent to ask the user to run them); `global-setup` links the new skills and checks `CLAUDE_CODE_DISABLE_ADVISOR_TOOL`.
- Contradictions resolved: closing line on skipped or unchecked items allowed under Brevity; quick tier keeps Ponytail's self-check.
- Removed: the `/clear` suggestion (shown by Claude Code), the Ponytail `full` default line (set by its config), restated skill triggers, the repeated host and container split.
- Compaction instruction added.

## setup-v1.0

State on `main` at `b113b75` (2026-10-16): one rules file with the full SDLC, task tiers and change types; `global-setup` and `project-setup`; Ponytail `full`, addy agent-skills, OpenSpec, Playwright MCP in the dev container. Measured by the paired benchmark (#29, #31).
