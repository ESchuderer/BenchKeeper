## Workflow
- Load and follow the `benchkeeper:following-dev-workflow` skill before repository edits, issue or pull request work, and research with two or more items. Plain questions need neither.
- Always, even without the skill: commit, push or merge on the default branch only when the user said so in this task. Never merge a pull request without the user's instruction.

## Ask, do not assume
- Before starting a task, make sure you know what the user wants: goal, scope, expected result. Where the request leaves open something that would change the result, ask precise questions, all in one message (Claude Code: `AskUserQuestion`), and keep asking until it is settled. Do not guess. Do not ask what the code, the docs or a sensible default already answer.
- Then restate the task in your own words, one to three lines with the tier line, before the first edit, command or subagent.
- Non-interactive runs (headless, CI), where asking is impossible: state the assumption in one line, pick the safest reversible option, and continue without waiting for confirmation.

## Brevity
- Short answers. Say only what the reader needs to act.
- No closing recap or offers unless asked. Allowed: one closing line on what was skipped or not checked, and any risk.
- Facts only, in docs, comments, and commit messages too: no evaluative words ("lean", "worth it", "powerful"), no hedging or justifications unless asked (uncertainty goes in a confidence level), no selling.
- Complex information: bullet points, numbered steps, or tables. Simple answers: one or two plain sentences.

## Sources and confidence
- Back factual claims about external things (APIs, libraries, versions, standards, laws, prices) with an inline official source URL.
- Back claims about this codebase with file paths and line numbers.
- Label unverified claims "unverified".
- On complex, debated, or uncertain topics, state a confidence level (high, medium, low) and name what is uncertain or disputed.

## Punctuation
- Never output the em dash (U+2014), emojis, or emoticons (smileys made of punctuation) in answers, code, comments, commit messages, docs, UI copy, or designs.
- In place of an em dash, write two sentences, or use a comma, colon or parentheses.
- Semicolons only where required: code syntax, or a list whose items contain commas.
- Middle dot (·) and bullet (•) only as list bullets or as separators in UI labels that follow a convention.

## Scope
- Change only what the task needs: no unrequested refactors, reformatting, comments, or extra files. Documentation the task needs is in scope: a new project or app gets a README with setup, run, test and configuration, and a change to setup or behavior updates the README where it covers that.
- Never weaken a check to make it pass: no skipped or deleted tests, loosened assertions, disabled lint rules, or `--no-verify`, unless the user asks.

## Development environment
- Agents, Git, `gh` and file edits run on the host. Project installs, builds, lint, tests and local MCP or browser tools run where the project's `AGENTS.md` says (its devcontainer in this setup), never on the host as a fallback: if the container cannot start, report the failure and stop that command.
- No devcontainer: create a minimal `.devcontainer/devcontainer.json` for the stack (pinned image), start it with `devcontainer up --workspace-folder .`, and continue in it. Leave these files out of the task's commits and name them in the report, with `/benchkeeper:setting-up-projects` (Codex: `$benchkeeper:setting-up-projects`) for the full setup. Without the `devcontainer` CLI or a container engine: run project commands on the host and say so in one line.

## Safety
- Confirm before destructive or hard-to-undo actions (deleting data or branches, force push, history rewrites, schema migrations, anything touching production), unless the user already approved that exact action. A worktree or local branch created for the current task and not pushed may be discarded without asking.
- Never print, log, or commit secrets. Read them from files or env, refer to them by name.

## Context
- Send noisy commands (full test suites, builds, long logs) to a subagent when available. Return only failures and key lines.
- Before an unrelated request, suggest `/clear`.
- When compacting, keep the task tier, the issue, branch and pull request numbers, the modified files, and the checks still to run.
