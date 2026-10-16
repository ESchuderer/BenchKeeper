# Changelog

Versions of the BenchKeeper setup (rules, skills, recommended stack). Each version is a git tag `setup-v<major>.<minor>`; benchmark results name the setup version they measured. Major: the layout or the behavior of the rules changes; minor: additions and fixes.

## setup-v2.2 (2026-10-16)

Decisions before Build, discard and restart, review input, documentation, opt-in checks (#46).

- `sdlc` Specify (full tier): records deployment target, data storage, module boundaries, core types and interfaces; a skeleton first only on request or in a repository without structure.
- `sdlc` Build: work that drifts from the plan or spec is discarded and restarted in a fresh context with the cause added to the plan, instead of patched.
- `sdlc` review and pull requests: the pre-push reviewer gets the diff and the plan or spec summary; the pull request lists the key decisions.
- `rules/global.md` Scope: documentation the task needs is in scope (README for a new project or app, updated with setup or behavior changes).
- `sdlc` opt-in for hard tasks, only on the user's explicit request: best-of-N in 2 or 3 worktrees, mutation testing on changed files.
- Benchmark: `bench/arms/bk-v2/` pins these rules and the `sdlc` skill as BenchKeeper layer v2 (`BK=v2` build argument, agent-skills arms); published runs used v1.

## setup-v2.1 (2026-10-16)

CI, permission rules removed (#39).

- Custom permission rules removed (`global-setup` part 11, owner decision): Claude Code's own permission modes and the auto-mode classifier decide; the safety limits stay as prose in `rules/global.md` and `sdlc`.
- `sdlc`: risky changes run `security-review` (Claude Code; reviews the diff between the branch and `origin`'s default branch, https://code.claude.com/docs/en/commands) before push, next to `code-review`.
- CI (`checks.yml`): `actionlint`, forbidden characters (em dash, emoji), SKILL.md front matter, `openspec validate --all --strict`. All actions pinned to commit SHAs; `links.yml` declares read-only permissions; Dependabot for actions and npm.

## setup-v2.0 (2026-10-16)

Claude Code best practices applied (#37, https://code.claude.com/docs/en/best-practices).

- `rules/global.md`: always-on core only (about 670 words, was 2,140); it loads the new `sdlc` skill before any edit in a repository, before issues, pushes and pull requests, and before research with several items. Hard limits (default branch, merges) stay in the core.
- `skills/sdlc`: task tiers, change types, issue, branch and pull request flow, SDLC phases, research flow (moved from the rules).
- `skills/maintain`: the Maintain pass, user-invoked only, with `/doctor prompt-audit` and `/skill-doctor`.
- Permission rules (Claude Code, `global-setup` part 11, native ask rules, no hooks): ask before skipping git hooks (`--no-verify`, `commit -n`), force pushes, remote and local branch deletion, pushes to `main` or `master`, hard resets, `git clean`, rebases, history rewrites, `gh pr merge`, `gh repo delete`, `gh release delete`. Em dashes, emojis and commits on the default branch stay prose rules.
- `global-setup`, `project-setup` and `maintain` never start on their own (`disable-model-invocation` for Claude Code, `agents/openai.yaml` for Codex); the rules tell the agent to ask the user to run them; `global-setup` links the new skills and checks `CLAUDE_CODE_DISABLE_ADVISOR_TOOL`.
- Contradictions resolved: closing line on skipped or unchecked items allowed under Brevity; quick tier keeps Ponytail's self-check.
- Removed: the `/clear` suggestion (shown by Claude Code), the Ponytail `full` default line (set by its config), restated skill triggers, the repeated host and container split.
- Compaction instruction added.

## setup-v1.0

State on `main` at `b113b75` (2026-10-16): one rules file with the full SDLC, task tiers and change types; `global-setup` and `project-setup`; Ponytail `full`, addy agent-skills, OpenSpec, Playwright MCP in the dev container. Measured by the paired benchmark (#29, #31).
