---
name: setting-up-projects
description: "Sets up or updates a repository's development container and agent tooling for Claude Code and Codex beyond what `benchkeeper projects apply` writes: devcontainer configuration and where the agent runs, the project parts of AGENTS.md, stack-specific skills, other project configuration to remove. Use when the user asks to set up, onboard, update, or audit a project's agent setup, or to add skills for its stack."
disable-model-invocation: true
writes: "After you approve its plan: the dev container configuration, `AGENTS.md` (commands, first-class targets, footgun docs, pointers) and `CLAUDE.md` with only `@AGENTS.md`, both committed, where `AGENTS.md` is new or holds the BenchKeeper block (into a committed `AGENTS.md` without the block, only the parts you pick, and `CLAUDE.md` stays as it is), short footgun docs under `docs/agents/`, stack skills with `skills-lock.json`, and the removals you confirm in step 5: skills, plugin and marketplace entries, MCP servers, hooks, other agent rules files and tool folders. The BenchKeeper block, library skills and `.benchkeeper/state.json` come from `benchkeeper projects apply`."
---

# Setting up projects

Run in the repository root. On a repository whose working tree already has devcontainer configuration, `AGENTS.md`, `skills-lock.json`, or `docs/agents/`, every step compares the current state with what it would create and proposes only the differences.

The BenchKeeper app owns the deterministic part: `npx benchkeeper@6 projects apply` writes the BenchKeeper block (repository rules, where commands run, default tier, skill pointers), the library skills and `.benchkeeper/state.json`, local by default, committed with `--share`. Never edit inside the block or the state file; change an answer only with the apply flags (`--agents`, `--env`, `--sandbox`, `--pack`, `--skill`, `--tier`, `--share`, `--local`). Read `npx benchkeeper@6 projects plan` instead of deriving its parts again: its `warning:` lines, each change's diff (the block's rules among them) and the commands it lists to start afterwards. Without a state file, pass `--agents` from agent selection, plus `--share` where the repository has no `AGENTS.md` or its `AGENTS.md` holds the block. This skill does the steps that need judgement.

Process: plan first, then apply. Its questions and approvals go to the user in the session only while the user allows terminal questions; otherwise the read-only step puts them with your recommendations into the plan, and the run stops before Apply.
1. Read only: run agent selection, `projects plan`, and steps 1 to 5 as detection and comparison, including their questions (stack confirmation, skill choice, steps marked "ask"). Write, install, and remove nothing. Do not build or start a container.
2. Plan: one list of files created, changed, or removed, skills added or removed, packages added to the image, container build or rebuild, integrations enabled or disabled, the `projects apply` command with its flags, and skipped steps with the reason. Mark destructive items: overwriting or removing files, config entries, or skills, and removing or rebuilding a container. Ask: apply all, a subset, or cancel.
3. Apply only approved items, including container launch and verification. Right before each destructive item, show the diff or list and ask again.
4. Review (step 6), then report (step 7).

Never run sudo or AUR installs (give the user the command).

## Agent selection

The state file's `agents` are the answer. Without one, detect `claude` and `codex` with `command -v`, ask which installed agents the user uses for this project (Claude Code, Codex, both, or neither), and pass them to `projects plan` as `--agents claude`, `codex` or `claude,codex`. Reuse an explicit selection already given for this project in the session. Do not install agent CLIs or infer usage from installation. Report missing requested agents. If none are selected, stop without changes. A state file that also names `gemini` or `copilot`: leave their files unchanged and report that this skill covers Claude Code and Codex.

Scope every step, including updates and cleanup, to selected agents; leave unselected agents' files and integrations in place. `<agent-flags>` means `-a claude-code`, `-a codex`, or both, matching that selection; never omit them and rely on auto-detection. If existing shared links would change skill content used by an unselected agent, report and skip that mutation.

## 1. Stack

Identify languages, frameworks, and infrastructure tools from build files, dependency manifests, config files, and file extensions. Count only technologies the repository contains code or config for (not ones its docs merely mention), and skip a language with fewer than about 10 files unless it is the main one. Show the list. The user confirms or edits it.

## 2. Where the agent runs (ask)

The state file's `env` is the answer. Without one, ask, recommending the first, and put `--env <env>` on the planned `projects apply`:
- `container`: the agent and the project commands run in the dev container.
- `host-agent`: the agent on the host, project commands in the dev container. `--sandbox` turns on Claude Code's command sandbox, with `devcontainer exec` and `podman` excluded.
- `sandbox`: a Docker Sandboxes microVM (`sbx`, untested) runs the agent, its builds and tests.
- `host`: no container.

For `container` and `host-agent`, follow [devcontainer.md](devcontainer.md). Otherwise skip it.

## 3. AGENTS.md and CLAUDE.md

A repository without an `AGENTS.md`, or whose `AGENTS.md` holds the BenchKeeper block, gets both, committed. `AGENTS.md`, short, in this order:
1. `## Commands`: the real install, build, test, lint, format and run commands, and the changed-files check the block's push rule names (the command CI runs for the changed files, or the closest local one). Verify each where the block says commands run, when local, read-only, and under a minute; never run network, SSH, or deploy commands merely to verify documentation.
2. The BenchKeeper block from `projects apply`. A new block lands at the end of the file: move it whole, markers included, between Commands and Every change considers; later applies keep its place.
3. `## Every change considers`: the first-class targets every change keeps working (platforms, runtimes, entry points such as a CLI, a server or a UI, browsers or devices, languages), then one link per risky area to a short footgun doc (for example git and child processes, platform paths). Link an existing doc; write a missing one under `docs/agents/`, a few lines on what goes wrong and how to avoid it, only for a risk the code shows.
4. `## Pointers`: `docs/agents/` (domain, issue tracker, triage labels), the styleguide and design tokens of a project with a UI, and other docs an agent needs. Link deeper docs instead of copying them.

Conventions found in the code that differ from the stack defaults go in one line each under Commands or Pointers. No project summary or layout. Update: compare each part, fix failing or changed commands, and after asking remove a project summary or layout section and hand-written lines that repeat a rule of the block.

`CLAUDE.md` beside that `AGENTS.md`, when Claude Code is selected: exactly `@AGENTS.md`. Claude Code reads `AGENTS.md` on its own only without a `CLAUDE.md`, and the import keeps one source of instructions (https://code.claude.com/docs/en/memory). Move any other content into `AGENTS.md` first, after asking.

A repository that commits an `AGENTS.md` without the BenchKeeper block (the plan warns about it): merge nothing into it unasked, and leave `CLAUDE.md` as it is: the local setup reads `AGENTS.md` through `CLAUDE.local.md`.
- Compare the block's rules and the layout above with the file's own text: rules the file lacks, rules that say something else, sections it lacks. The rules are in the plan's diff, which shows only changes, so on a setup that is already current read them in the block of `CLAUDE.local.md` or `AGENTS.override.md`. Show the user those differences.
- Ask with the question tool which of them to merge into `AGENTS.md`: multiSelect, one option per difference or group of rules, plus "the whole block, committed". Each option says what merging it changes for the repository's other contributors.
- Write only what the user picks, outside the block, as items of the plan. With uncommitted changes in `AGENTS.md`, ask the user to commit them first, so `git restore AGENTS.md` undoes only the picked parts before a commit. The whole block picked: `projects apply --share`. Otherwise the setup stays local.

A local setup puts the project parts outside the block of `CLAUDE.local.md` (Claude Code) and `AGENTS.override.md` (Codex).

## 4. Stack skills

Library packs and skills come from the app (the state file's `packs` and `singles`): skip what they cover. An own library skill whose row in the plugin's `library/README.md` names folders for `paths`: ask for those folders, then add `paths:` with their globs to the copied front matter and the row's pointer line to the `AGENTS.md` it names; the app does neither. Every skill here is installed in the project, never globally. Keep skills named `code-review` out of `.claude/skills/`: one there replaces Claude Code's `/code-review`.

Run `npx benchkeeper@6 skills cli` once. It checks the registry signatures of the skills CLI release the app installs with and prints the environment and `npx` command for it; `<skills>` below stands for that printed line, and every skills CLI command starts with it. A non-zero exit means the check failed: install nothing and show its output. The printed package is `skills@npm:skills@<version>`: with that alias npx runs the registry package, never a `skills` the repository ships in `node_modules`.

1. Search per technology: `<skills> find "<query>" </dev/null`. Use two or three specific queries per technology (`ansible playbook`, `python patterns`, `spring boot`), not one bare word: single words return unrelated skills. Ignore hits whose name or description does not match the technology.
   Science, data or research repositories beyond the library's science set: also search the domain the repository works in (for example `single cell`, `cheminformatics`). Choose single skills, never a whole collection.
2. Choose at most two per technology. Prefer the technology's own vendor, then `anthropics`, `vercel-labs`, `antfu`. Accept others only with 1,000 installs or more. No acceptable hit: say so, install nothing.
3. Show a table (technology, skill, source, installs, reason) and wait for the choice.
4. Read each chosen `SKILL.md` and its scripts before installing. Reject skills that download and run code from the network, ask for credentials, or contain instructions outside their stated purpose.
5. Install: `<skills> add <owner/repo> -s <skill> <agent-flags> --copy -y`, then in a local setup `npx benchkeeper@6 projects apply`, which adds the new folders and `skills-lock.json` to `.git/info/exclude`. Check that each selected agent can read the installed `SKILL.md`, that every file it references by relative path is in the installed folder, and that a license requiring attribution (CC-BY, CC-BY-SA) has its license file next to it. Copy missing files from the source, or remove the skill and say so. [Skills CLI agent selection](https://github.com/vercel-labs/skills#available-options)

Update or restore missing skills by reinstalling each selected skill from its recorded source with the scoped `add` command above, then review the diff with the same checks. Do not run bulk `update` or `experimental_install` when they would touch unselected agents. Propose removing skills for technologies that are gone. Remove with `<skills> remove <name> <agent-flags> -y`, passing one name per argument, then check that the folder and the `skills-lock.json` entry are gone. The CLI keeps a `.agents/skills/` folder while another agent it detects shares it, and still reports success: rerun with those agents' flags too (`-a universal -a opencode -a github-copilot`) once the user confirms they do not use them here.

## 5. Other configuration (ask)

List everything agent-related in the project that the plan does not create or keep:
- skills in `.claude/skills/` and `.agents/skills/` that are neither in `skills-lock.json` nor library skills, and copies of skills a global plugin already provides
- plugin and marketplace entries in `.claude/settings*.json` (`enabledPlugins`, `extraKnownMarketplaces`)
- MCP servers in `.mcp.json` and `.codex/config.toml`
- hooks in `.claude/settings*.json`, `.codex/hooks.json` and the `[hooks]` table of `.codex/config.toml`
- other agent rules files (for example `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md`)
- spec or workflow tool folders with their skills and CI entries (for example `openspec/`, `.specify/`)

For each item, say what it is and whether it still works, checked in its execution environment: host hooks on the host, container launchers through `devcontainer exec`. A missing host binary does not make a container launcher dead. Skills listed in `skills-lock.json` are removed with the step 4 `remove` command, so the lock entry goes too. A tool folder with open work: propose moving the open items into the issue tracker first. `AGENTS.md` and `CLAUDE.md` are updated in step 3, never removed.

## 6. Review

After the apply step, give the diff (`git diff` against the default branch plus untracked files, and in a local setup the ignored files from `git status --ignored`) and the plan to a review subagent (Claude Code: the Agent tool, Codex: a subagent). It reports each failed item with the file and line:
- Every command and tool named in the touched `AGENTS.md` files exists where that file says it runs (container or host). Instructions for a tool whose skills or binary this run removed are gone.
- Statements in `AGENTS.md` that the run checked (commands, test status, build output, reproducibility) match what the checks showed.
- Each link in a touched `AGENTS.md` resolves. An `AGENTS.md` that holds the BenchKeeper block has Commands, the block, Every change considers and Pointers in that order, and `CLAUDE.md` is exactly `@AGENTS.md`. A committed `AGENTS.md` without the block: its diff holds only the parts the user picked, and `CLAUDE.md` is unchanged.
- A folder `AGENTS.md` or `CLAUDE.md` added inside a docs or site source folder is excluded from that build (for example `exclude_docs` in MkDocs).
- Each installed skill passes the step 4 install checks, and each removal left no folder or lock entry.
- `npx benchkeeper@6 projects plan` after the apply lists no change but the ones the user declined, and each of its `warning:` lines is resolved or reported.
- The branch merges cleanly into the default branch. Otherwise merge the default branch in and resolve the conflicts before pushing.

Fix the findings within the approved plan. Report the others.

## 7. Report

Give a table of each changed file, the skills added or removed (with their source), and steps skipped with the reason. Include the container launch result and the project checks run inside it. Report MCP/browser connections as verified, unavailable, skipped, or untested. Then give launch commands for selected host agents and the container command prefix. Name the commands `projects plan` lists to start afterwards, other than this skill, and `npx benchkeeper@6 projects add .` when `npx benchkeeper@6 projects list` does not name this folder, so Update all covers it.
