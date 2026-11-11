# Skills

What each skill does, who starts it, when it runs and what it writes, so you can pick one without reading its `SKILL.md`. The tables come from each skill's front matter and from `plugins/benchkeeper/library/library.json`; CI fails when this page differs from them (`node .github/scripts/skills-doc.mjs` rewrites it).

## BenchKeeper's skills

The BenchKeeper plugin installs these nine in Claude Code and Codex at every level. A skill that "you" start never starts on its own.

<!-- generated:skills -->
| Skill | What it is for | Started by | When it runs | What it writes |
| --- | --- | --- | --- | --- |
| [ask](../plugins/benchkeeper/skills/ask/SKILL.md) | Allows terminal questions (the question tool and plan mode) in this Claude Code session for a while: 30 minutes, a span, until a time, or off again. | you: `/benchkeeper:ask` (Codex `$benchkeeper:ask`) | On request, while you sit at the terminal and want the agent to ask you, for example to grill a plan. | One file per Claude Code process in the plugin's data folder (ask/<process id>.json, the window's end); off deletes it. |
| [maintaining-repos](../plugins/benchkeeper/skills/maintaining-repos/SKILL.md) | Runs a repository-wide maintenance pass: dead code, duplicates, unused options and dependencies, dependency cycles, test audit by mutation, shortcut debt, dependency audit, version pins, docs drift, instruction-file audit, unused skills, repository hygiene. | you: `/benchkeeper:maintaining-repos` (Codex `$benchkeeper:maintaining-repos`) | On request, on a clean working tree. | Nothing until you approve the findings (Edit and Write are off), apart from the verdicts in the project's local knowledge base and the `.benchkeeper/` line in `.git/info/exclude` that keeps it local; then the commits of each approved change under `workflow`. |
| [operating-benchkeeper](../plugins/benchkeeper/skills/operating-benchkeeper/SKILL.md) | How an agent manages its own BenchKeeper setup through the benchkeeper CLI alone, without the web UI: plan, review the diff, apply with --yes, read the JSON, undo a run, run doctor and verify, update one project. | the agent, or you with `/benchkeeper:operating-benchkeeper` | Use when asked to install, update, check, change or undo the BenchKeeper setup of this machine or a repository, or to read its state (projects, skills, packs, history, settings, rules) from the command line. | What the `benchkeeper` commands you approve write: rules, skills, settings and project setup files, each run recorded for `benchkeeper undo`. |
| [orchestrating-projects](../plugins/benchkeeper/skills/orchestrating-projects/SKILL.md) | Runs a coordinator for parallel autonomous issue work: workers on labeled issues with the projects in parallel, each pull request reviewed by a fresh reviewer, merged only where the repository's written policy allows, cleaned up, then the next issues started. | you: `/benchkeeper:orchestrating-projects` (Codex `$benchkeeper:orchestrating-projects`) | Start it on request with the project paths. | Specs, prompts, approvals, handoff copies and scratch clones of the repositories in `.benchkeeper/runs/<run id>/` and the coordinator's handoff file `.benchkeeper/runs/handoff.md`, deleted when the run closes, and a `.benchkeeper/runs` line in `.git/info/exclude` when git does not ignore it yet; the ref `refs/benchkeeper/policy` in each project; reviewed draft pull requests marked ready; the worktrees and containers of finished workers removed; issue and pull request comments; a merge of the default branch into a pull request's branch, merges, issue closes and local and remote branch deletions only where the project's `docs/agents/orchestration.json` allows; one Escape into a worker's terminal where that policy sets `permissionPrompts` to `decline`; the `daily-digest` automation's digest file when the owner asks for one or the run closes with decisions taken on the owner's behalf that it does not list, committed or posted as one issue comment only when the owner asks, with that automation's checks, never to a public repository. Workers write the branches and pull requests. |
| [questions](../plugins/benchkeeper/skills/questions/SKILL.md) | Asks you the open question issues of the hub repository in batches with the question tool, records each answer on its issue, and keeps the ones you defer out of the queue. | you: `/benchkeeper:questions` (Codex `$benchkeeper:questions`) | On request, while you sit at the terminal to answer the open questions; it allows terminal questions for the rest of the session. | A comment and new labels on each issue you answer or defer, in the hub repository, and the deferred label there when the hub lacks it; the window file /benchkeeper:ask keeps, open for the rest of the session. |
| [reviewing-rules](../plugins/benchkeeper/skills/reviewing-rules/SKILL.md) | Reviews one rule file such as CLAUDE.md or AGENTS.md for contradictions, vague lines, lines a tool could enforce and lines that restate the code or config. | you: `/benchkeeper:reviewing-rules` (Codex `$benchkeeper:reviewing-rules`) | On request, after you wrote or changed a rule file. | Nothing: a list of findings in the conversation. Each is a suggestion; you decide what to change. |
| [setting-up-projects](../plugins/benchkeeper/skills/setting-up-projects/SKILL.md) | Sets up or updates a repository's development container and agent tooling for Claude Code and Codex beyond what `benchkeeper projects apply` writes: devcontainer configuration and where the agent runs, the project parts of AGENTS.md, stack-specific skills, other project configuration to remove. | you: `/benchkeeper:setting-up-projects` (Codex `$benchkeeper:setting-up-projects`) | Use when the user asks to set up, onboard, update, or audit a project's agent setup, or to add skills for its stack. | After you approve its plan: the dev container configuration, `AGENTS.md` (commands, first-class targets, footgun docs, pointers) and `CLAUDE.md` with only `@AGENTS.md`, both committed, where `AGENTS.md` is new or holds the BenchKeeper block (into a committed `AGENTS.md` without the block, only the parts you pick, and `CLAUDE.md` stays as it is), short footgun docs under `docs/agents/`, stack skills with `skills-lock.json`, and the removals you confirm in step 5: skills, plugin and marketplace entries, MCP servers, hooks, other agent rules files and tool folders. The BenchKeeper block, library skills and `.benchkeeper/state.json` come from `benchkeeper projects apply`. |
| [tier](../plugins/benchkeeper/skills/tier/SKILL.md) | Sets the tier for the rest of this session: quick, standard, full or research, or auto to let the workflow pick again. | you: `/benchkeeper:tier` (Codex `$benchkeeper:tier`) | On request, or from the tier buttons of the optional status band, for the rest of the session. | Nothing on disk: one line with the tier now in force. The override lives in the conversation. |
| [workflow](../plugins/benchkeeper/skills/workflow/SKILL.md) | Picks the workflow and tier for a task: a software change (quick, standard, full), a docs pass, research, or a batch of tasks on one branch, with the checks and reviews each needs. | the agent, or you with `/benchkeeper:workflow` | Use before the first edit in a repository, before issue or pull request work, and before research with two or more items. | The tier line `Tier: <tier> (<change type>)` before the first edit; through its playbooks commits and a pull request in the project's convention. |

## Matt Pocock's skills

The `matt-pocock` pack installs his plugin (skill list of version 1.3.1). Claude Code installs it from the official marketplace, which pins it to one commit ([marketplace.json](https://github.com/anthropics/claude-plugins-official/blob/main/.claude-plugin/marketplace.json)); the pin moves when that marketplace updates it. Skills you start run as `/mattpocock-skills:<name>` (Codex `$mattpocock-skills:<name>`); the agent starts the others on its own, and you can start them too.

| Skill | Started by | What it does |
| --- | --- | --- |
| `ask-matt` | you | Routes you to the skill or flow that fits your situation. |
| `diagnosing-bugs` | the agent or you | A diagnosis loop for hard bugs and performance regressions. |
| `grill-with-docs` | you | Interviews you to sharpen a plan or design and writes ADRs and glossary entries as it goes. |
| `triage` | you | Moves issues and external pull requests through triage roles and writes agent-ready briefs. |
| `improve-codebase-architecture` | you | Scans for deepening opportunities, reports them as an HTML page, then grills through the one you pick. |
| `setup-matt-pocock-skills` | you | Sets up the issue tracker, triage labels and domain doc layout in `docs/agents/`, once per repository. |
| `tdd` | the agent or you | Test-driven development, red-green-refactor. |
| `to-spec` | you | Turns the conversation into a spec on the issue tracker. |
| `to-tickets` | you | Breaks a plan or spec into tracer-bullet tickets with their blocking edges. |
| `wayfinder` | you | Plans work too big for one session as decision tickets and resolves them one by one. |
| `implement` | you | Implements a piece of work from a spec or tickets. |
| `implement-spec` | you | Implements the result of `to-spec` and `to-tickets`. |
| `prototype` | the agent or you | Builds a throwaway prototype to answer a design question. |
| `research` | the agent or you | Investigates a question against primary sources and writes the findings to a Markdown file. |
| `domain-modeling` | the agent or you | Builds the domain model: `GLOSSARY.md` and ADRs. |
| `codebase-design` | the agent or you | Shared vocabulary for designing deep modules and their seams. |
| `code-review` | the agent or you | Reviews changes since a fixed point against the repository's standards and the issue or spec. |
| `pr` | the agent or you | Writes a pull request body. |
| `retro` | you | A retrospective on a coding session. |
| `wizard` | the agent or you | Generates an interactive bash wizard for steps only a human can do. |
| `grill-me` | you | Interviews you to sharpen a plan or design. |
| `grilling` | the agent or you | Grills you about a plan, decision or idea. |
| `handoff` | you | Compacts the conversation into a handoff document for another agent. |
| `teach` | you | Teaches you a skill or concept within this workspace. |
| `to-questionnaire` | you | Turns an open decision into a questionnaire for someone else to fill in. |
| `wait-what` | you | Re-pitches the last message when it did not land. |
| `writing-for-agents` | the agent or you | Writing skills, `AGENTS.md` and `CLAUDE.md` for agents. |
<!-- /generated:skills -->

Skills installed per project (packs and single skills): [the library catalog](../plugins/benchkeeper/library/README.md).
