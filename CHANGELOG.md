# Changelog

Versions of the BenchKeeper setup (rules, skills, recommended stack). Each version is a git tag `setup-v<major>.<minor>`; benchmark results name the setup version they measured. Major: the layout or the behavior of the rules changes. Minor: additions and fixes.

## setup-v2.9 (2026-10-17)

Workflow fixes from the benchmark diagnosis of the BenchKeeper layer (cartridges and winery, Sonnet 5.5): layer apps lacked a README, checked the UI by screenshots instead of tests, and left browser output in the repository.

- `following-dev-workflow` Verify: the browser check comes in addition to tests the project's test command runs for the UI logic, never instead of them.
- Before done: a new project or app has a README (setup, run, test, configuration), and a change to setup or behavior updates it. Browser and build output (`.playwright-mcp/`, `test-results/`, screenshots) is git-ignored or deleted.
- Non-interactive runs: a skill's approval gate or a phase boundary is not a stop.
- Prose semicolons rewritten in `rules/global.md` and the skills (no rule change). `setting-up-machine` names no host path.
- `rules/global.md` Brevity: "Short answers." `setting-up-machine` part 7 no longer points to an issue.

## setup-v2.8 (2026-10-16)

Punctuation rule (owner request: models swap the banned em dash for semicolons and middle dots).

- `rules/global.md` "Forbidden characters" becomes "Punctuation". The em dash, emojis and emoticons stay banned.
- No other joining mark takes the em dash's place: two sentences, or a comma, colon or parentheses.
- Semicolons only in code syntax or in lists whose items contain commas. Middle dot and bullet only as list bullets or UI label separators.

## setup-v2.7 (2026-10-16)

Context limits (owner request).

- `following-dev-workflow` Task tiers: soft context limit by tier (quick: `/clear` after the pull request; standard and full: `/compact` after the plan, `/clear` after the pull request), suggested by the agent.
- `rules/global.md` Context: one line, suggest `/clear` before an unrelated request. The client compacts by itself at its window (hard limit).
- `setting-up-machine` part 7: `autoCompactWindow` (default 400000 tokens, the user's value kept). Its effect on usage is not measured yet (planned: 400000 against the default, paired, k of at least 3).

## setup-v2.6 (2026-10-16)

Fixes from the skill authoring review (#58, `bench/results/2026-10-16-skill-authoring.md`).

- Skill headings match the new names (`# Setting up the machine` and the others).
- `setting-up-machine` version bumps: `git grep` outside `bench/` and the changelog, so the Dockerfile and workflow pins are found and the benchmark's pinned images and copies stay. Done on a branch as the rules require.
- `setting-up-machine` part 7 checks `showClearContextOnPlanAccept`, which its install sets.

## setup-v2.5 (2026-10-16)

Skills checked against Anthropic's skill authoring guide (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices, `evaluations/practices/skill-authoring.md`).

- Skills renamed to gerunds (one naming pattern, owner decision): `global-setup` to `setting-up-machine`, `project-setup` to `setting-up-projects`, `sdlc` to `following-dev-workflow`, `maintain` to `maintaining-repos`. Commands `/setting-up-machine`, `/setting-up-projects`, `/maintaining-repos` (Codex: `$...`). Relink once: `setting-up-machine` part 6 links the new names; the old links are listed as extras.
- Skill descriptions in third person. `maintaining-repos` says "Use after" like the others.
- Benchmark: the image installs pinned copies of the two setup skills (`bench/arms/bk-skills/`, as of setup-v2.4, old names) instead of the live `skills/` folder.
- `project-setup`: dated install count removed (time-sensitive).

## setup-v2.4 (2026-10-16)

Clarifying questions only where they change the result.

- `rules/global.md` Ask, do not assume: questions only for open points that would change the result, batched in one message (`AskUserQuestion`), never about what the code, the docs or a sensible default answer. The restatement is its own bullet. Non-interactive runs continue without waiting for confirmation (Sonnet arm W stopped to wait for confirmation and scored 0 of 6, `bench/results/2026-10-15-winery-react.md:134`).

## setup-v2.3 (2026-10-16)

Task restatement (owner request). Rules trimmed to what the model does not do by default (audit of 2026-10-16 against the Claude Code and Claude prompting docs and arXiv 2602.11988, which found context files raise cost by over 20% without raising task success: https://arxiv.org/abs/2602.11988).

- `rules/global.md` Ask, do not assume: before a task, clarifying questions until goal, scope and expected result are clear, then the task restated in one to three lines with the tier line, before the first edit, command or subagent. Plain questions excepted.
- Brevity: allows that restatement and the closing line on what was skipped. The opener clause removed (current models answer directly). "No caveats" is now "no hedging", with uncertainty in a confidence level.
- Removed as self-evident or duplicated: "code, commands, error messages ... stay exact"; the Ponytail precedence line (in `sdlc`); the mount scoping line (in `project-setup`); "do not re-read unchanged files" (Claude Code's Read tool says so). Sources and Confidence merged into one section.

## setup-v2.2 (2026-10-16)

Decisions before Build, discard and restart, review input, documentation, opt-in checks.

- `sdlc` Specify (full tier): records deployment target, data storage, module boundaries, core types and interfaces where they apply, asking the user where the request leaves one open. A skeleton first only on request or in a repository without structure.
- `sdlc` Build: work that drifts materially from the plan or spec (a different design or scope) is discarded and restarted in a fresh context (a new subagent or session) with the cause added to the plan, instead of patched. `rules/global.md` Safety: a worktree or local branch created for the current task and not pushed may be discarded without asking.
- `sdlc` review and pull requests: the pre-push reviewer gets the diff and the plan or spec summary. The pull request lists the key decisions.
- `rules/global.md` Scope: documentation the task needs is in scope (README for a new project or app, updated with setup or behavior changes).
- `sdlc` opt-in for hard tasks, only on the user's explicit request: best-of-N in 2 or 3 worktrees, mutation testing on changed files.
- Benchmark: `bench/arms/bk-v2/` pins these rules and the `sdlc` skill as BenchKeeper layer v2 (`BK=v2` build argument, agent-skills arms). Published runs used v1.

## setup-v2.1 (2026-10-16)

CI, permission rules removed.

- Custom permission rules removed (`global-setup` part 11, owner decision): Claude Code's own permission modes and the auto-mode classifier decide. The safety limits stay as prose in `rules/global.md` and `sdlc`.
- `sdlc`: risky changes run `security-review` (Claude Code: reviews the diff between the branch and `origin`'s default branch, https://code.claude.com/docs/en/commands) before push, next to `code-review`.
- CI (`checks.yml`): `actionlint`, forbidden characters (em dash, emoji), SKILL.md front matter, `openspec validate --all --strict`. All actions pinned to commit SHAs. `links.yml` declares read-only permissions. Dependabot for actions and npm.

## setup-v2.0 (2026-10-16)

Claude Code best practices applied (#37, https://code.claude.com/docs/en/best-practices).

- `rules/global.md`: always-on core only (about 670 words, was 2,140). It loads the new `sdlc` skill before any edit in a repository, before issues, pushes and pull requests, and before research with several items. Hard limits (default branch, merges) stay in the core.
- `skills/sdlc`: task tiers, change types, issue, branch and pull request flow, SDLC phases, research flow (moved from the rules).
- `skills/maintain`: the Maintain pass, user-invoked only, with `/doctor prompt-audit` and `/skill-doctor`.
- Permission rules (Claude Code, `global-setup` part 11, native ask rules, no hooks): ask before skipping git hooks (`--no-verify`, `commit -n`), force pushes, remote and local branch deletion, pushes to `main` or `master`, hard resets, `git clean`, rebases, history rewrites, `gh pr merge`, `gh repo delete`, `gh release delete`. Em dashes, emojis and commits on the default branch stay prose rules.
- `global-setup`, `project-setup` and `maintain` never start on their own (`disable-model-invocation` for Claude Code, `agents/openai.yaml` for Codex). The rules tell the agent to ask the user to run them. `global-setup` links the new skills and checks `CLAUDE_CODE_DISABLE_ADVISOR_TOOL`.
- Contradictions resolved: closing line on skipped or unchecked items allowed under Brevity. Quick tier keeps Ponytail's self-check.
- Removed: the `/clear` suggestion (shown by Claude Code), the Ponytail `full` default line (set by its config), restated skill triggers, the repeated host and container split.
- Compaction instruction added.

## setup-v1.0

State on `main` at `b113b75` (2026-10-16): one rules file with the full SDLC, task tiers and change types; `global-setup` and `project-setup`; Ponytail `full`, addy agent-skills, OpenSpec, Playwright MCP in the dev container. Measured by the benchmark.
