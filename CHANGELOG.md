# Changelog

Versions of the BenchKeeper setup (rules, skills, recommended stack). Each version is a git tag `setup-v<major>.<minor>` and a GitHub Release, both created on merge from the plugin `version` and the entry here; benchmark results name the setup version they measured. Major: the layout or the behavior of the rules changes. Minor: additions and fixes.

## setup-v6.21 (2026-10-26)

- App, usage per account and limit notices (#338, part of #300): `benchkeeper accounts track <name> [--off]` adds a status line script and a `StopFailure` hook (`rate_limit`, `authentication_failed`, `billing_error`) to a Claude Code account's folder, as a plan with a diff and undo (a dev container account is written through `devcontainer exec`); an existing status line of another kind is refused. The script keeps only the used percentage and reset time of the 5-hour and 7-day window and the type and time of a failed turn, never a credential. `accounts status` (`--json` key `usage`), `doctor` and the Accounts view show what is left per window (100 minus `used_percentage`; a window past its reset time is unknown, not full), a notice below twice the minimum and the latest failure.
- `accounts limits [name]` sets the minimum headroom (defaults 8 percent for the 5-hour and 3 percent for the 7-day window, per account too), the notice level, `--pool` and the launch settings. `run` below the minimum shows the account, window, what is left and the reset time and asks before it starts (`--yes` or `--continue-below on` starts anyway). Opt-in auto-pick, off by default (`--auto-pick on`): a launch without `--account` under a default account below its minimum starts under the pool member with the most headroom, or stops with the earliest reset time, or with `--when-none wait` waits for it; never inside a running session. The provider's consumer terms prohibit bypassing protective measures and are silent on switching accounts at a limit, so the setting says so and the owner carries that call. Codex has no documented usage source and shows none.
- Breaking, before 7.0 (no compatibility path): `accounts list --json` has `pool` and `limits` per account and `settings`; `accounts status --json` has `usage` per account; `accounts.json` may hold `settings` and, per account, `limits` and `pool`.
- Plugin `version` 6.21.0.
- Upgrade: `npx benchkeeper@6.21.0 apply`.

## setup-v6.20 (2026-10-26)

- App, two security controls in the Claude Code settings catalog (#313, ranks 5 and 6 of the control candidates in `docs/security.md`, part of #272): `env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` (strips credentials from the environments of Bash commands, hooks and stdio MCP servers; GitHub tokens and proxy settings stay) and `permissions.deny`, each with its documentation link and a one-line reason. `doctor` warns while the scrub is not on (`1`, taking the value of the highest settings layer, else the process environment) and while no `Read` deny rule that reaches a home folder (the home anchor, `//**/` or an absolute home path) covers each of the `.ssh`, `.aws` and `.config/gh` folders; it skips both warnings while a settings file cannot be read. `benchkeeper settings set env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB 1` turns the scrub on. Setup writes neither: a subprocess that needs a removed variable would break, and the deny rules merge into a list the user may already have. A deny rule does not cover a script that opens the files itself. Existing catalog entries are unchanged.
- Plugin `version` 6.20.0.
- Upgrade: `npx benchkeeper@6.20.0 apply`.

## setup-v6.19 (2026-10-26)

- App, `benchkeeper maintain knowledge show|clear [dir]` (#314, part of #274): `show` prints the entries the `maintaining-repos` skill stored for a project in `.benchkeeper/knowledge/` (`--json` prints `dir`, `path`, `files` and `ignored` in the usual envelope); `clear` removes that folder after a question (`--yes` skips it) and nothing else of the project. A file that does not parse, is a link or is larger than 1 MiB is ignored with a reason, a linked `.benchkeeper` is never followed or removed, and token shapes in stored text are masked in the output.
- `maintaining-repos` reads the project's local knowledge base before a pass and writes verdicts back after it (`knowledge.md` next to `SKILL.md`: files and entry shapes, reuse only while the sha256 of every file the entry names is unchanged, expiry of reference-based and rejected verdicts, size cap, modes 0700 and 0600, stored text is data). Breaking, before 7.0 (no compatibility path): the baseline file `.benchkeeper/maintenance.json` is replaced by `.benchkeeper/knowledge/verdicts.json`; an old file is not read.
- Plugin `version` 6.19.0.
- Upgrade: `npx benchkeeper@6.19.0 apply`.

## setup-v6.18 (2026-10-26)

- `orchestrating-projects` author filter for worker text (#311, rank 1 of the control candidates in `docs/security.md`): the worker spec template has a `Trusted authors:` line. A worker follows issue, pull request, review and comment text only from the policy's `trustedAuthors`, the repository owner and users with write access (`authorAssociation` OWNER, MEMBER or COLLABORATOR), and reads any other text, bots included, as data, never instructions. The coordinator picks only issues written by a trusted author. Breaking, before 7.0 (no compatibility path): a review bot's comments are no longer followed unless its login is in `trustedAuthors` of `docs/agents/orchestration.json` (new optional policy field, example in `policy.example.json`).
- Skill lint: `.github/scripts/skill-lint.mjs` fails a skill whose files mention a worker and hand it issue or pull request text without the `Trusted authors:` line and the words "data, never instructions" (a failing and a passing fixture in `skill-lint.test.mjs`). The filter is wording in the worker session, so it lowers the hit rate and is no boundary.
- Plugin `version` 6.18.0.
- Upgrade: `npx benchkeeper@6.18.0 apply`.

## setup-v6.17 (2026-10-26)

- App, `update-all` for chosen projects (#280): `benchkeeper update-all [dir..]` takes registered project folders and updates only those, with `--dry-run`, `--baseline`, `--max` and the cap on pushed repositories counting only the list. Without folders it behaves as before. A folder that is not a registered project stops the command before anything is listed or changed, with exit 2 and the message `<dir>: not a registered project`. The browser's Update all already took a project list.
- Breaking, before 7.0 (no compatibility path): the `doctor` message for a skill file that links a missing target now starts with the skill and the project (`skill <name> in <project dir>: <file> links <target>, which does not exist`); a script that matches the old text `<file> links ...` at the start of the message must match the new one. The link in the `accessibility` library skill to its sibling `web-quality-audit` is still reported: #276 did not remove that skill, and the dead link is in the upstream text.
- Plugin `version` 6.17.0.
- Upgrade: `npx benchkeeper@6.17.0 apply`.

## setup-v6.16 (2026-10-26)

- App, loops and groups per tier (#176): the sessions board has a `pattern` per session (single, loop, group, Orca worker) with a By pattern table (median cost and time, tests passed, pull requests merged), a Pattern filter and column, the subagent count and, for an Orca worker, its run id. Loop: `/goal`, `/loop` or a scheduled wakeup in a Claude Code transcript. Group: Claude Code subagent transcripts or Codex subagent rollouts. Orca worker: the two-line Orca dispatch text in the first typed prompt, or the `Orca run: <id>` line of the new worker-spec template; Codex rollouts are not checked for loops or workers. When several apply the first of Orca worker, loop, group wins. A session summary cached before this change, whose transcript the agent has deleted, shows `not recorded`. No rule or skill changes: the tier-to-pattern mapping stays in the playbooks.
- App, optional global step when Orca is installed (off unless chosen): the Orca worker-spec template (the five task-spec fields of the Orca orchestration guide plus tier, branch, commit and check lines, the run marker and a cap) and samples of `orca.yaml` and `.worktreeinclude` for new worktrees, written to the folder `orca` of the app config folder. Nothing is added to a project.
- Upgrade note: the sessions cache key now carries a parser version, so the first scan after the upgrade reads every transcript again (the cache keeps the summaries of deleted transcripts).
- Plugin `version` 6.16.0.
- Upgrade: `npx benchkeeper@6.16.0 apply`.

## setup-v6.15 (2026-10-26)

- `maintaining-repos` covers general improvement and cleanup (#274): the pass now starts on a clean tree and adds three parts, each in a file next to `SKILL.md` that is read only when its part runs: cleanup with a tool table per stack and pinned versions (`tools.md`: knip, jscpd, dependency-cruiser, with the Python and Rust candidates marked unverified), architecture checks (`architecture.md`: cycles, forwarding modules, one source of truth, documented against actual structure, and what to do without a `GLOSSARY.md` or ADRs), and a test audit by mutation testing (`test-audit.md`: StrykerJS through its command runner, a bound of one module per run, concurrency 4, a memory cap, a heap cap and a per-mutant timeout, survivors sorted into equivalent, unreachable, message and gap, and a test is removed only when the module's mutation result is unchanged without it). The report is one ranked list with a local baseline file, `.benchkeeper/maintenance.json`, that the next pass compares against. The rule "remove a test only together with the code it covers" now also allows removal with a recorded reason. The description stays a user-started skill (`disable-model-invocation`), so it costs no context in Claude Code. New eval set `skill-maintaining-repos` (should-not-load cases; not run). Evidence: the research comment on #274 and `evaluations/practices/code-health-pass.md`.
- Plugin `version` 6.15.0.
- Upgrade: `npx benchkeeper@6.15.0 apply`.

## setup-v6.14 (2026-10-26)

- App, hostile repositories and project registration (#203): a scan (`POST /api/scan`, `benchkeeper projects scan`) refuses a drive root and the BenchKeeper config folder, where it walked any absolute root before; the home folder and the folders around it stay scannable. Filter drivers (`clean`, `smudge`, `process`) that a repository's own config names, in `.git/config`, `config.worktree` or a file it includes, no longer run for the app's `status`, `add`, `write-tree`, `commit` and `worktree add` (the project list, Update all, session snapshots), except the exact commands git-lfs installs. A repository whose config git cannot read stops those commands. A repository that keeps another filter in its local config (git-crypt) reads as changed, Update all stops on it with the changed-tree message, and its session snapshots hold the files unfiltered (unreferenced objects in its `.git`). The other findings of #203 were fixed before (#239, #184): the registration deny list, the profile import, absolute paths for `POST /api/projects`, `core.fsmonitor`, the `.git` redirect file.
- Plugin `version` 6.14.0.
- Upgrade: `npx benchkeeper@6.14.0 apply`.

## setup-v6.13 (2026-10-26)

- App, environment and isolation of child commands, previews and eval sessions (#200): the commands the app runs for third-party code no longer get `GIT_ASKPASS`, `GIT_SSH`, `GIT_SSH_COMMAND`, `GIT_PROXY_COMMAND`, `GIT_EXTERNAL_DIFF`, `GIT_EXEC_PATH`, `GIT_PAGER`, `GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`, `GIT_TEMPLATE_DIR`, `GIT_CURL_VERBOSE`, `GIT_TRACE*`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_n`, `GIT_CONFIG_VALUE_n` or `GIT_CONFIG_PARAMETERS`: they run a program or their values can hold a key or an `Authorization` header, which the name filter cannot see. A setup that needs them (a dev container that exports git settings through `GIT_CONFIG_COUNT`, a private https remote with an askpass program) names each one in `BENCHKEEPER_PASS_ENV`, every `GIT_CONFIG_KEY_n` and `GIT_CONFIG_VALUE_n` too. The skill install preview reads an empty git config and no system config instead of the user's (a preview that needs a certificate or proxy set only in the system config fails, and the run is unchanged): url rewrites and git-only proxy settings of the user's config do not apply in the preview (the proxy and certificate environment variables still do), and the run itself is unchanged. An eval session saves no transcript (it no longer shows on the sessions board or in the agent's own history) where the installed CLI lists `--no-session-persistence` (Claude Code) or `--ephemeral` (Codex), and Claude Code starts no MCP server for it, rule cases included (`--strict-mcp-config`). An eval session that exits non-zero (a CLI that rejects a flag) stops the run with its exit code instead of counting as a missed trigger, and stores nothing for that target (the outputs of its earlier rule cases are removed too, and the output tail in the error is masked before it is cut). The eval's scratch `git init` (without the templates of the user's git config) and version probe get the filtered environment. The other findings of #200 were already fixed (#235, #240) or are decided in `docs/security.md`: the filtered environment of runs and previews, the preview on a click, the preview's context home, the size budget of seeded folders, the login-only environment and no-trace flags of advice sessions, and `benchkeeper record` unconfined by design. An absolute-path write and the network of a preview stay unconfined until there is an OS sandbox for every platform the app runs on.
- Plugin `version` 6.13.0.
- Upgrade: `npx benchkeeper@6.13.0 apply`.

## setup-v6.12 (2026-10-26)

- App, supply chain findings of the security review (#198): every `npm` and `npx` command the app runs (host tool, skills CLI, global and per project) now carries `npm_config_before` set to 7 days ago, so the dependencies of the pinned skills CLI and of the host tool resolve at releases at least 7 days old too, and the signature check, the preview and the run resolve the same tree. The two global skill sources moved back from commits that were 6 days and 1 day old to the newest commits that are 7 days old (`vercel-labs/skills` `13e4063`, `stablyai/orca` `5df4fef`), so the installed skill text is a week older than before. `PIN_DATES` records when each third-party pin was published and a test fails for a pin younger than 7 days or changed without its date. The other findings of #198 were already fixed (#235, #239, #240) or are decided in `docs/security.md`.
- Plugin `version` 6.12.0.
- Upgrade: `npx benchkeeper@6.12.0 apply`.

## setup-v6.11 (2026-10-26)

- App, remaining low-severity findings of the security review (#206): `benchkeeper test` reports a `skills-lock.json` that is not a lock file (not JSON, not an object, `skills` not an object) as a problem line instead of throwing; copies to a path that does not exist yet (backups, undo restores) are written beside it and renamed in, so a failed copy leaves no half-written file or folder; the Catalog lists pack files that are not packs with their reason and removes them (as `packs list` and `packs remove` already did).
- The other findings of #206 were already fixed (#239) or stay open on purpose in `docs/security.md`.
- Plugin `version` 6.11.0.
- Upgrade: `npx benchkeeper@6.11.0 apply`.

## setup-v6.10 (2026-10-25)

- Library: seven skills that fail the quality bar are removed from `library.json` and their packs: `docx`, `pdf`, `pptx`, `xlsx` (a license that forbids copies and distribution), `scientific-critical-thinking`, `fp-check` and `tdd-workflow` (they need files outside their folder). The `ecc` pack has three skills, the `security` pack three, the `science` pack four. Each is in `evaluations/skill-libraries/library-exclusions.md` with its reason. A project that installed one gets the removal in its next project plan, offered and not preselected.
- Plugin `version` 6.10.0.
- Upgrade: `npx benchkeeper@6.10.0 apply`.

## setup-v6.9 (2026-10-25)

- New skill `orchestrating-projects`, started by the user: a coordinator that runs one worker per project on labeled issues, projects in parallel, verifies each outcome, merges and closes only inside the repository's written policy (`docs/agents/orchestration.json`, read from the default branch; without it nothing merges, closes or deletes), then cleans up and starts the next issue. Workers decide the safest reversible option and write it in the pull request, report blocked and end, and never bypass a repository hook. A worker state of `ready` does not show a blocked worker: the coordinator also checks for no commit, PR or message for a set time. Worktree removal and branch deletion are separate steps. A spec template, a policy example and one reference file for Orca's commands are in the skill folder. Evaluation scenario and checks: `evaluations/practices/orchestrating-projects.md` (scenario not run yet).
- Plugin `version` 6.9.0.
- Upgrade: `npx benchkeeper@6.9.0 apply`.

## setup-v6.8 (2026-10-25)

- The tier band hook returns once per step (SonarCloud S3516); behaviour is unchanged. The rest of the release is the app's SonarCloud fixes: promises handled, linear-time regexes, sorts with a compare function, system tools by full path, scorer commands that accept only known paths, the benchmark arm image installs Claude Code, ECC and the skills CLI without their packages' install scripts (only Claude Code's own `install.cjs` runs) and Spec Kit from its PyPI wheel without a source build.
- Plugin `version` 6.8.0.
- Upgrade: `npx benchkeeper@6.8.0 apply`.

## setup-v6.7 (2026-10-25)

- Frameworks: project setup can add Superpowers, ECC, agency-agents and Matt Pocock's skills inside the project, after showing each with its evaluation. One workflow owner per project (Superpowers is one): choosing it takes BenchKeeper's workflow skill and the issue-tracker specs out of that project's block, and the `workflow` skill defers to a `Workflow owner:` line. `benchkeeper project apply --framework <id> [--agent-file <path>]`, `benchkeeper frameworks`; the setup form has a Frameworks section.
- Superpowers is a Claude Code plugin enabled for the project only (scope project when shared, local otherwise). ECC is four single skills at a pinned commit (no plugin, no hooks). agency-agents is a pick of agent files fetched at a pinned commit. Codex gets none of these (no project scope or no converter).
- Doctor reports a second workflow owner, and an owner framework installed for the user or the project that the setup does not record.
- Plugin `version` 6.7.0.
- Upgrade: `npx benchkeeper@6.7.0 apply`, then Update all.

## setup-v6.6 (2026-10-25)

- Install levels: `benchkeeper apply --level lite|standard|full`. Lite and standard install only the BenchKeeper plugin on the machine (lite relies on the `workflow` skill description to trigger; the trigger rate is not measured yet, see `evaluations/practices/lite-install.md`); standard adds the local project block that `project apply` writes. Without `--level`, `plan` and `apply` use the level found on the machine, full on a machine without BenchKeeper.
- The repository rules (load the workflow skill, ask open questions in one message, fix the cause of a failed check) moved from the global rules into the project block (`rules/project.md`). Global rules keep secrets and writing. Run `update-all` so each project carries them.
- Doctor, the Dashboard and the one-run setup show and choose the level; below full, doctor expects the plugin only.
- Plugin `version` 6.6.0.
- Upgrade: `npx benchkeeper@6.6.0 apply`, then Update all.

## setup-v6.5 (2026-10-24)

- One-run setup in the browser: the Dashboard and the command palette start Everything, Global only or Projects (a checklist; projects without a setup or behind are checked). One consent covers the agent suggestion sessions. One progress bar shows a line per item (the global plan with its skill rehearsal, per project the suggestion and the plan), one review page shows a section per plan with a checkbox per section and per change, diffs behind buttons and the project answers (agents, environment, packs, tier) editable in place, and one apply job reports progress per section with a link to each run for undo. A failed suggestion or plan shows its reason and leaves the rest; a failed section leaves the others; cancel stops after the running change.
- Projects with a shared setup, one still committed, or no repository stay with Update all; Fix everything stays as it is.
- Plugin `version` 6.5.0.
- Upgrade: `npx benchkeeper@6.5.0 apply`, which updates the plugin.

## setup-v6.4 (2026-10-24)

- No ask rules and no approval line in the rules: Claude Code's auto mode (its defaults) decides what needs a prompt. `gh pr merge`, force push, `git reset --hard`, `git branch -D` and `git clean` run without BenchKeeper asking first. The rule that required the user's go before hard-to-undo actions and merges is gone, as is the Codex command rules file. Global setup compares `permissions.ask` in the Claude Code settings and the files in the Codex rules folder with the set BenchKeeper wants (none) and offers each difference for removal, one change per rule or file, off by default so your own rules stay unless you pick them.
- Plugin `version` 6.4.0.
- Upgrade: update the plugin, then `npx benchkeeper@6.4.0 apply`.

## setup-v6.3 (2026-10-23)

- Project setups stay on this machine by default. `project apply` writes the BenchKeeper block into `CLAUDE.local.md` (importing `AGENTS.md`) and `AGENTS.override.md` (Codex reads it instead of `AGENTS.md`; rebuilt from `AGENTS.md` on each apply), the sandbox into `.claude/settings.local.json`, and lists every file it writes in a marked block of `.git/info/exclude`, so `git status` stays clean. `--share` (or "In the repository" in the browser) keeps the committed layout: the block in `AGENTS.md`, `CLAUDE.md`, a pull request from Update all. The project's own `AGENTS.md` text, `docs/agents/` and `.devcontainer/` stay committed.
- Update all applies local setups in the checkout. A repository that still tracks `.benchkeeper/state.json` while its setup is local (every setup from before 6.3) gets a pull request that removes the committed setup, branch `chore/agent-setup-local`; `benchkeeper projects unshare` does the same on request. The checkout stays as it is until you pull the merge, and the answers are kept in `projects.json`, so the next Update all writes the setup locally.
- Doctor: warns when a local setup is still committed. Projects view: a badge per project (local, local and still committed, shared).
- `setting-up-projects`: knows both layouts; after editing `AGENTS.md` in a local setup with Codex, it runs `project apply` so `AGENTS.override.md` follows.
- Plugin `version` 6.3.0.
- Upgrade: `npx benchkeeper@6.3.0 apply`, then Update all (or `benchkeeper projects unshare`) for the projects set up before; merge each pull request, pull, and run Update all once more.

## setup-v6.2 (2026-10-23)

- Sessions board as a file: each scan of the Sessions view in the browser UI also rewrites `~/.config/benchkeeper/board.html`, as `benchkeeper board` does.
- Tier band: a board button opens that file; without one, it says to open Sessions in the app or run `benchkeeper board`.
- Sessions board: the Project filter offers Registered projects (the app's project list and their Git worktrees), preset when any of them has sessions; All shows every session as before.
- Browser UI: a Stop button in the header stops the local server, as Ctrl+C does; it is refused while an apply or eval runs.
- Doctor: an older plugin shows as level `outdated` instead of a warning with an "outdated:" prefix.
- Evals view: a short explanation of what evals check and what Miss and False trigger mean.
- Plugin `version` 6.2.0.
- Upgrade: `npx benchkeeper@6.2.0 apply`, which updates the plugin.

## setup-v6.1 (2026-10-22)

- Sessions board: `benchkeeper board` and the Sessions view in the browser UI show every Claude Code and Codex session on this machine with its tier and change type, the setup installed at the time, the skills used, the last test run, pull request state, time, tokens and the cost Claude Code records. It reads the local transcripts, the run ledger and `gh`, and caches in `~/.cache/benchkeeper/`.
- `/benchkeeper:tier <quick|standard|full|research|auto>` (Codex: `$benchkeeper:tier`): a tier for the rest of the session, below a tier the user names for one task and a risky change.
- `benchkeeper:workflow`: the tier line names the change type, `Tier: standard (bug, known cause)`, and a new line follows when the work grows, so the board can report tiers that moved up.
- Optional tier band in Claude Code (plugin option `tierBand`, off by default; `apply` offers it unselected): the tier of the last answer above the prompt, buttons that run `/benchkeeper:tier`, and the override kept in the system prompt through compaction and resume.
- Project setup in the browser: Prefill all runs the agent's suggestions for every project of a batch after one consent; each project still gets its own review, apply and pull request.
- Library: each skill has its own "pick when" text (35 skills shared their pack's), so choosing the science, marketing or document packs no longer warns about overlapping descriptions; a test keeps the catalog free of overlaps.
- Project setup: when the project's own `AGENTS.md` says the agent runs on the host, the environment defaults to `host-agent` (`host` without `.devcontainer/`), and the warning about that text appears only when it contradicts the chosen environment. The adviser sees what each environment means.
- Plugin `version` 6.1.0.
- Upgrade: `npx benchkeeper@6.1.0 apply`, which updates the plugin; choose the tier band step to turn the band on.

## setup-v6.0 (2026-10-22)

- Rules rewritten to the lines that change agent behavior: load the workflow skill, ask open questions in one round, get a go before hard-to-undo actions and merges, fix the cause of failing checks, keep secrets out, and the writing rules (no filler, READMEs open with one or two sentences on what the product does, no em dash or emojis, sources). Removed: restating the task before the first edit, the default-branch commit line, the semicolon and middle-dot lines, and the scope, context and development environment sections (where project commands run now lives in each project's `AGENTS.md`).
- `following-dev-workflow` is now `benchkeeper:workflow`, a router: kind and tier, settle, then `software.md` (issue, branch and pull request flow, change types, verify), `docs.md` (a docs pass: Claude and Codex analyse the documents against the code separately and return findings, the main session alone decides and edits) or `research.md`, batch mode for several tasks on one branch, long checks and reviews once at the end. It runs without Matt Pocock's skills and names them where they help when installed.
- Matt Pocock's skills are optional: the app installs them with `--pack matt-pocock`, `setting-up-projects` asks whether a project uses them.
- The app (`app/`, `npx benchkeeper@6.0.0`) replaces `setup.sh`.
  - Global setup: the same steps for Claude Code and Codex, plus Gemini CLI and GitHub Copilot CLI (untested). Each change is shown before it applies (file changes as a diff, commands as their command line), settings files are merged, and each run goes into a ledger (the record undo reads), with undo per run or step. `setup.sh` backups stay restorable (`benchkeeper restore <name>`). New: an ask list in `~/.claude/settings.json` (`gh pr merge`, force push, `git reset --hard`, `git branch -D`, `git clean`; ask rules prompt in bypass and auto mode too, [docs](https://code.claude.com/docs/en/permission-modes)) and `~/.codex/rules/benchkeeper.rules`.
  - Per project: `project apply` writes the `AGENTS.md` block, `CLAUDE.md`, pack skills at pinned commits and `.benchkeeper/state.json`; `record` runs an agent session and makes its file changes undoable; own packs with export and import; skills turned off per project; Update all (one branch, commit and pull request per registered project); `doctor`, `test`, setup profiles, eval cases from observed misses, and `eval` (skill trigger rates, owner-started, first sets for `workflow` and `designing-technical-uis`).
  - Web UI, the same steps in the browser: a sidebar, a dashboard with install health, coverage per agent and a setup flow diagram, doctor findings that open their plan, a Fix everything wizard (global plan, chosen projects with a pull request each, findings to fix by hand), projects with a folder dialog and scan, a pack builder, a run report after each apply and in History (numbered diffs, unified or split, command output, undo per step or run), eval charts, profile export and import, and a command palette. A project without a state file is set up step by step, with the agent in the dev container as the default; a changed answer removes what the old one left (sandbox settings, files for a dropped agent, unused pack plugins offered unselected); an agent can suggest packs and skills in one read-only session after the user agrees; applies, evals and suggestions run with live progress that survives a reload, and can be cancelled.
  - Safety: the browser opens through a file only the user can read, so the link's token stays out of process arguments. Codex suggestions run under a permission profile that reads only the project, with no web search or MCP servers (the generated arguments are tested; enforcement in a real Codex session is unverified). Every plan in the browser rehearses its skills CLI installs in a scratch folder (its own HOME and agent folder variables) and shows the files they would write. Update all runs the checkout's git hooks, not those of the fetched tree. The app checks for a newer version in a terminal and never installs it.
- `setting-up-projects` and the library README run the skills CLI as `skills@npm:skills@1.7.2`, so npx fetches the registry package instead of a `skills` a cloned repository ships in `node_modules`.
- `setting-up-projects` asks where the agent runs: inside the devcontainer (default), on the host with project commands in the container, in a Docker Sandboxes microVM (untested), or without a container. It leaves the parts the app writes to `project apply`.
- Library: `library/library.json` is the catalog source (skills, sources pinned to a commit, packs); `library/README.md` tables are generated from it and checked in CI. New packs: frontend, testing (`playwright-best-practices`, new), security, science, docs, data, marketing, operations, and Matt Pocock's skills with his repository setup. Own skills pass a lint in CI.
- The app adds BenchKeeper's marketplace at the branch `stable`, which each release moves (Release workflow), so later releases update with a marketplace refresh instead of a removal that deletes the plugin's data. Install commands in the docs get the app version from `app/package.json` (`.github/scripts/version-pins.mjs`, checked in CI).
- Plugin `version` 6.0.0. Pinned bench arms keep their skill names.
- Upgrade: run `npx benchkeeper@6.0.0 apply`, which also updates the plugin (from a clone before the npm release: `node app/bin/benchkeeper.mjs apply`). Projects with `Default tier:` lines keep working; references to `following-dev-workflow` in a project's own files change to `benchkeeper:workflow`.

## setup-v5.4 (2026-10-21)

- Rules, Brevity: the facts-only line covers READMEs, docs, comments, commit, issue and PR text. Every sentence gives the reader something needed to use, build, change or decide. It also leaves out who the project is for or who uses it, restatements of headings, code or the previous sentence, feature lists that repeat the usage section, introductions and summaries of the document itself, and motivation and history unless asked.
- Plugin `version` 5.4.0.
- Upgrade: update the plugin and run `sh plugins/benchkeeper/setup.sh --apply` from the clone.

## setup-v5.3 (2026-10-21)

- `setup.sh` stops a file replacement when its backup fails. Shell configuration diagnostics print variable names and locations, without values or surrounding commands.
- Codex settings update existing analytics and feedback values, set effort at the root without changing profiles, and back up the original TOML for restore. Unsupported multiline, inline, dotted or array target forms and CRLF files require manual editing.
- Plugin `version` 5.3.0. Benchmark arm AO pins this plugin, rules and library separately from historical arms.
- Upgrade: update the plugin and run `sh plugins/benchkeeper/setup.sh --apply` from the clone.

## setup-v5.2 (2026-10-19)

- `setting-up-projects` step 5: after Matt Pocock's repository setup, move its `## Agent skills` block from `CLAUDE.md` into `AGENTS.md` when Codex is selected, and write the triage labels when it skipped them. His setup looks for a skill named `triage` and missed the plugin's `mattpocock-skills:triage` in the BenchKeeper repository, so `docs/agents/triage-labels.md` and the GitHub labels were missing.
- Plugin `version` 5.2.0.
- Upgrade: update the plugin. Repositories set up already: run `/benchkeeper:setting-up-projects` again, or add `docs/agents/triage-labels.md` by hand.

## setup-v5.1 (2026-10-19)

Fixes from the first setup-v5.0 runs on five repositories (BenchKeeper, the OpenReloading workspace, Artwork, AutoLever, PiMetry website).

- `setting-up-projects` step 7 is a review by a subagent after the apply step: commands and tools in the touched `AGENTS.md` files exist where they run, instructions for removed tools are gone (the workspace kept `openspec archive` after its OpenSpec skills went), checked statements match the checks (Artwork claimed byte-identical PNG rebuilds, they are pixel-identical), a folder `AGENTS.md` inside a docs source is excluded from the build (AutoLever's MkDocs would have published it), install and removal checks hold, and the branch merges cleanly into the default branch (Artwork conflicted with a pull request merged meanwhile). The report moves to step 8.
- Step 4 install: every file a skill references by relative path and the license file of CC-BY and CC-BY-SA skills must be in the installed folder.
- Step 4 removal: check that the folder and the lock entry are gone. `skills remove -a codex` reported success and removed nothing while other agents the CLI detects shared `.agents/skills/` (38 skills in the workspace).
- Library: Trail of Bits `dimensional-analysis` removed. The skills CLI does not copy the agent prompt files it runs.
- Plugin `version` 5.1.0.
- Upgrade: update the plugin (`claude plugin marketplace update benchkeeper && claude plugin update benchkeeper@benchkeeper`). Rules and settings are unchanged.

## setup-v5.0 (2026-10-18)

A skill library installed per project, and a generic cleanup in place of steps for older setups (#99). The global set is unchanged: rules, the BenchKeeper plugin, Matt Pocock's skills, Ponytail, find-skills, and the Orca skills on request.

- Library `plugins/benchkeeper/library/` (the plugin does not load it): `README.md` is the catalog with an own skill, Anthropic skills, a science set (K-Dense-AI/scientific-agent-skills) a marketing set (coreyhaines31/marketingskills), and single skills for security (Sentry, Trail of Bits), docs and data, operations, legal and product from a researched shortlist. None of these has an independent measurement of its effect. They are picked on publisher, license, clean security audits and no downloads at run time. Workflow frameworks other than Matt Pocock's and stack skills are not listed. Stack skills come from the find-skills search as before. `doc-coauthoring` is left out (no license file). The Anthropic document skills are Codex only, since Claude Code gets them from the claude.ai skills `anthropic-skills`. `skill-creator` is left out: both agents already have it.
- Own library skill `designing-technical-uis` (grown from the reverted #97 text rules): technical UIs for people who know the domain. Text (no restating captions, tooltips or lead paragraphs, help text only where a term needs a definition), numbers and units (unit in the label or header, metric by default with the domain's own unit where usual, one base unit, per-field unit toggles), inputs and selection (start empty, pick then compare, no preselected items), tables, comparisons and charts, accessibility. Visual style stays with `frontend-design`. Check of the text and units rules (before the rename): 4 tasks on `web/` (a settings drawer; bench empty state, error, intro and tooltip; a review of `Page.tsx`; a technical results table), one Sonnet subagent with and one without the skill each, scored by the author against a checklist set before the runs. Restating or reassuring lines: 0 with, 14 without (9 of them header and status tooltips in the table). Invented facts: 0 with (missing facts marked `[NEED]`), 5 without. Units sat in the column headers in both table runs. With the skill, the review proposed mostly deletions of repeated text, without it mostly rewording. Confidence low to medium (n = 1 per task).
- `setting-up-projects` step 4: the library first (sets proposed from what the repository contains, trimmed by the user), then the stack search. Step 6 lists everything agent-related in the project that the plan does not keep (skills, plugin and marketplace entries, MCP servers, hooks, other agent rules files, spec or workflow tool folders) and removes only what the user picks. The removal of setup-v3 project copies and the OpenSpec, Spec Kit, codegraph and LSP steps are gone. These show up in the step 6 list.
- `setup.sh` lists everything else installed globally, one item at a time: rules files, skills, plugins, marketplaces, MCP servers and hooks. Files go to the backup. Plugins, marketplaces and MCP servers are removed with the agent's own command. Hooks are offered per event, Orca's own entries stay and are only reported, and claude.ai synced skills are not touched. The steps for setup-v3 skill links, RTK files and host Playwright entries are gone. When one run changes a settings file twice, the backup keeps the file from before the first change.
- `setup.sh` asks to set the Claude Code default model to `opusplan` (Opus in plan mode, Sonnet otherwise). Its own step, since it replaces a model the user chose. Orca starts `claude` without `--model`, so the setting applies in Orca terminals too.
- `setup.sh` asks to set the default effort to `high`: Claude Code `effortLevel` plus a per-model level for Opus 5.5 and Sonnet 5.5 (in the user file Opus 5.5 and later ignore the global key, [settings](https://code.claude.com/docs/en/settings-reference#effortlevel)), and Codex `model_reasoning_effort`.
- `setup.sh` sets the auto-compact window to 400000 tokens and asks when another value is set, per-model `/autocompact` values included (they outrank the key). Research: no Anthropic recommendation and no Claude 5 long-context benchmark. The 1M models compact at about 967K by default. Usage per turn grows with the context, and Sonnet and Opus 5.x have no price tier above 200K ([costs](https://code.claude.com/docs/en/costs), [pricing](https://platform.claude.com/docs/en/about-claude/pricing#long-context-pricing)). Confidence in 400000: low to medium. `CLAUDE_CODE_AUTO_COMPACT_WINDOW` in the shell outranks it and is reported.
- `setup.sh` settings also set `cleanupPeriodDays` 14 (local transcripts, default 30), `autoUpdatesChannel` `stable` (a release about one week old that skips major regressions), `DISABLE_FEEDBACK_COMMAND` (`/feedback`, `/bug` and `/share` off: transcripts sent there are kept 5 years, [data usage](https://code.claude.com/docs/en/data-usage)) and `CLAUDE_CODE_SUBAGENT_MODEL` `sonnet` (subagents without a model no longer inherit Opus in plan mode. The built-in Explore and Plan agents ignore it, [subagents](https://code.claude.com/docs/en/sub-agents)). Picked by the owner from a researched list. Left out: `DISABLE_TELEMETRY` and nonessential-traffic off (they turn off the advisor), the sandbox (needs custom rules), the subprocess credential scrub (untested against the bench runners).
- `setup.sh --apply-all` applies every change of the dry run without asking.
- Rules: a repository without a devcontainer no longer stops the task. The agent creates a minimal pinned `.devcontainer/devcontainer.json`, starts it and continues, keeps those files out of the task's commits and names them with `/benchkeeper:setting-up-projects` for the full setup. Without the `devcontainer` CLI or a container engine it runs project commands on the host and says so. An existing container that fails to start is still reported and that command stops. Cause: setup-v4.0 (arm AL) stopped at the first step in 2 of 3 mistreevous trials to ask for `setting-up-projects`.
- Cleanup of the rules and skills, after a review per file against the defaults of Claude Code (its 2.1.302 system prompt) and Codex (`codex-rs/core/gpt_5_2_prompt.md`): lines either agent already follows, lines that repeat the rules, Matt Pocock's skills or the library catalog, and copies of `--help` output are gone. Rules 780 to 715 words, `following-dev-workflow` with `full-tier.md` 2170 to 1774, `setting-up-projects` 2239 to 1838, `maintaining-repos` 259 to 224, library catalog 817 to 713, `designing-technical-uis` 939 to 653. Also removed: the full tier's Best-of-N and mutation testing options (nothing ran them unprompted), the host/container lines in the project `AGENTS.md` text (the rules state them), and the accessibility section of `designing-technical-uis` (the library's `accessibility` skill covers WCAG). Its text rules behind the measured effect stay. The library's left-out list moved to `evaluations/skill-libraries/library-exclusions.md`.
- Not benchmarked: the library, the cleanup, `opusplan` and the 400000 window. The benchmarks so far ran on Sonnet at effort high. A setup-v5.0 run on opusplan follows.
- Plugin `version` 5.0.0.
- Upgrade from v4.0: update the plugin, then `git -C BenchKeeper pull` and `sh BenchKeeper/plugins/benchkeeper/setup.sh --apply`, then `/benchkeeper:setting-up-projects` in each repository. From v3.4: the same, after installing the plugin as in the README quick start. `setup.sh` lists the old skill links and global marketing or other skills as items to remove. Projects get skills back from the library.

## setup-v4.0 (2026-10-18)

BenchKeeper installs as a plugin in Claude Code and Codex, and a user-run `setup.sh` replaces the agent-run `setting-up-machine` skill (#88). No agent runs the machine install, nothing needs root, and nothing is removed without a per-item yes.

- Layout: the marketplace file `.claude-plugin/marketplace.json` sits at the repository root (both agents read it) and lists `plugins/benchkeeper/`. `skills/` and `rules/` moved there. A plugin version copies about 50 KB into the plugin caches instead of the 55 MB repository.
- Plugin `version` in `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` is the setup version (`4.0.0`) and changes with each entry here.
- Skill names carry the plugin namespace in both agents: `benchkeeper:following-dev-workflow`, `benchkeeper:setting-up-projects`, `benchkeeper:maintaining-repos`, and `mattpocock-skills:<name>` for Matt Pocock's. The rules and skills use these names.
- `setup.sh`: dry run by default, `--apply` asks per change, `--restore <date>` undoes the moves. It copies the rules, installs the plugins (BenchKeeper, Matt Pocock's skills, Ponytail at tag `v5.3.2`), merges the settings, moves other global rules and setup-v3 skill links to `~/.config/benchkeeper/backup/<date>/`, reports variables that disable the advisor, checks Docker and host Playwright entries, and offers find-skills and the Orca skills for each agent that lacks them. A failed step is reported and the rest still runs. `--restore` keeps the current copy of a restored file in `<date>-restore`. Host tools take the newest release that is at least 7 days old. Self-check in CI (`setup.test.sh`, POSIX sh).
- `setting-up-machine` is removed. Pin bumps move to `maintaining-repos` (newest release at least 7 days old). `setting-up-projects` names the Playwright MCP pin itself.
- Codex gets Matt Pocock's skills from his plugin (`mattpocock-skills@mattpocock`), as in Claude Code. `setting-up-projects` removes Codex project copies of his skills after asking.
- Dependabot waits 7 days after a release (`cooldown`).
- Benchmarks keep their frozen copies in `bench/arms/`. Behavior inside a task is unchanged apart from the skill names.
- Upgrade from v3: `git -C BenchKeeper pull`, then `sh BenchKeeper/plugins/benchkeeper/setup.sh` to see the plan and `--apply` to run it. It replaces the rules symlink with a copy, moves the old skill links to the backup and installs the plugins. An existing Ponytail marketplace keeps its current ref. Then `/benchkeeper:setting-up-projects` in each repository with Codex project copies of Matt Pocock's skills.

## setup-v3.4 (2026-10-17)

One level for the workflow: Matt Pocock's skills are global (his install), so the parts that shape them are global too. Otherwise his skills run without the tier filter in every repository that `setting-up-projects` has not touched.

- `setting-up-machine`: part 3 installs Ponytail (level `full`) as its install guide gives it, and part 5 links `following-dev-workflow` with the setup skills. Parts renumbered (Playwright MCP 4 to Orca 9).
- `setting-up-projects` step 5 keeps only what is repository-specific: Matt Pocock's repository setup (`/setup-matt-pocock-skills`), his Codex install, the default tier. It removes the project copies of setup-v3.0 to v3.3 (the workflow skill in the repository's skill folders, Ponytail and Matt Pocock entries in `.claude/settings.json`) after asking.
- `rules/global.md` loads `following-dev-workflow` before every repository edit again.
- Behavior inside a task is unchanged, so the SkillsBench arm AH (setup-v3.3) also stands for this version.
- Upgrade: `/setting-up-machine`, then `/setting-up-projects` in each repository that has project copies.

## setup-v3.3 (2026-10-17)

Matt Pocock's skills installed the way he documents it ([installation](https://github.com/mattpocock/skills#installation-30-second-setup)), with the BenchKeeper additions on top. His skills have no tiers, change-type checks, issue, branch or pull request rules, security review or Ponytail, so `following-dev-workflow` and Ponytail stay.

- `setting-up-machine` part 2: his Claude Code plugin from the official marketplace (`mattpocock-skills@claude-plugins-official`), user level, updated when the official marketplace entry moves (it pins a commit of his repository), no BenchKeeper pin. Parts renumbered (Playwright MCP 3 to Orca 8). The earlier `mattpocock` marketplace installs are extras to remove.
- `setting-up-projects` step 5: Codex gets his skills with his installer (`npx skills add mattpocock/skills`). The repository setup is his `/mattpocock-skills:setup-matt-pocock-skills`, run by the user, instead of a description of it. Its `## Agent skills` block goes where his setup puts it (`CLAUDE.md` next to `@AGENTS.md`), or into `AGENTS.md` when Codex is selected. Projects from setup-v3.0 to v3.2 lose their pinned plugin entries, so his skills load once. Ponytail and `following-dev-workflow` stay per project.
- `following-dev-workflow`: a missing `docs/agents/` points to his setup skill.
- Bench: arm AH (layer v5) measures this setup.
- Upgrade: `/setting-up-machine` (installs his plugin, removes the pinned project copies' marketplace), then `/setting-up-projects` in each repository with the workflow.

## setup-v3.2 (2026-10-17)

Fitted to Matt Pocock's own flow and conventions ([mattpocock/skills](https://github.com/mattpocock/skills) v1.3.1, `ask-matt`, `.agents/invocation.md`, `docs/engineering/setup-matt-pocock-skills.md`; [aihero.dev/skills](https://www.aihero.dev/skills)). The pin stays at v1.3.1, his latest release.

- `following-dev-workflow`: skills run through a Skill tool call, one per skill (his finding: a Skill tool call loads more reliably than a name in prose). Commits carry `Refs #<issue>` so his `code-review` finds the spec. Full tier keeps grilling, `/to-spec` and `/to-tickets` in one session and clears before each ticket (his context hygiene), tickets sized for one fresh session. His review is skipped when `/implement` just ran it and its output shows both of its sections. Seams name what they catch and miss. Research subagents work without his `research` skill (it spawns its own agent). `wizard` for steps only a person can take, `/retro` after a session that went sideways. A one-way door in a pull request's merge danger counts as risky.
- `setting-up-projects`: the tag pin replaces the plugins' own updates. One install per agent (a user-level copy next to the project one loads twice). His setup's trackers (GitHub, GitLab, local) and draft review. Added on top: the labels his skills apply are created after approval (his setup only records their names), and `docs/agents/` is compared after a version bump.
- `maintaining-repos`: a description without a trigger list (user-invoked), `/retro` among his suggestions.
- Every BenchKeeper skill has `agents/openai.yaml` for Codex, with implicit invocation off for the user-invoked ones, as his skills do.
- Upgrade: `/setting-up-projects` in each repository with the workflow.

## setup-v3.1 (2026-10-17)

Checked against the current Claude Code docs ([best practices](https://code.claude.com/docs/en/best-practices), [common workflows](https://code.claude.com/docs/en/common-workflows), [code review](https://code.claude.com/docs/en/code-review), retrieved 2026-10-17) and for Matt Pocock's skills by level.

- `following-dev-workflow`: the tier sets which skills are required, not which may load. Any installed skill, Matt Pocock's or another, loads in any tier when its description matches (quick: one targeted skill such as `tdd` or a stack skill). The tier table names the required and the matching skills per tier, user-invoked ones marked (U), with `/wayfinder` and `/grill-with-docs` as user options in the full tier.
- Reviews by their real names: `mattpocock-skills:code-review` for standards and spec, the bundled `/code-review` for correctness before push (scoped to correctness and the issue's requirements), `/security-review` for risky changes. Only his review and tracker skills need `docs/agents/`.
- Plan mode before the first edit in standard and full. Sessions: `/clear` once the plan is in the issue, `claude --continue`, `/resume` or `--from-pr` on the same machine, `/handoff` for a fresh context. Verify reports each check with its command and result. Best-of-N names `claude --worktree`.
- `rules/global.md`: no "project instructions win" line (user and project rules have no precedence order, [memory](https://code.claude.com/docs/en/memory)), a shorter workflow line, the development environment in two lines, no part number in the context rule.
- No cross-references by part number or another file's section name. `setting-up-projects` installs `following-dev-workflow` from the installed setup's release tag and keeps a `code-review` skill out of `.claude/skills/`. `maintaining-repos` suggests `/improve-codebase-architecture` and `/triage` where Matt Pocock's skills are installed.
- `AGENTS.md`: the benchmark pin history moved to `bench/AGENTS.md`.
- Upgrade: `/setting-up-projects` in each repository with the workflow, then `/setting-up-machine`.

## setup-v3.0 (2026-10-17)

Recommended stack: Matt Pocock's skills with Ponytail and the BenchKeeper workflow skill, without agent-skills and OpenSpec, installed per project. Evidence: `evaluations/skill-libraries/mattpocock-skills.md` (own cartridges and brownfield runs, signals only).

- Install split: the machine gets only the basic global rules, the setup skills and settings (`setting-up-machine`). The workflow (`following-dev-workflow`, Matt Pocock's skills v1.3.1, Ponytail v5.2.0) is installed per project and committed (`setting-up-projects` step 5: project skills, and plugins pinned to tags in `.claude/settings.json`), so nothing loads twice and teammates get the same setup. `rules/global.md` loads the workflow skill only where a repository has it.
- `following-dev-workflow` rewritten as a tier pre-filter. Quick: branch, edit, verify, commit, draft pull request. Standard: the existing tests covering the touched code (TDAD, arXiv 2603.17973), `tdd`, `mattpocock-skills:code-review`. Full (`full-tier.md`, loaded only then): Matt Pocock's flow (`grilling`, `/to-spec` and `/to-tickets` when the user runs them, `tdd`, `code-review`, `pr`). Kept: change types and their checks, issues, branches, pull requests, Verify, the pre-push correctness review (Claude Code's built-in `code-review`) and the security review for risky changes (`security-review`), which Matt Pocock's `code-review` does not cover.
- The change type sets the tier before the tier table. `Default tier:` applies only when neither matches. Unfinished work at the end of a session goes into an issue or pull request comment, with `/handoff` suggested. Conflicts with Matt Pocock's skills settled: `grilling` asks without its emoji markers, `research` saves outside the repository unless asked.
- `setting-up-machine`: parts are rules (1), Playwright MCP (2), skills (3, no global `following-dev-workflow`), settings (4), advisor (5), devcontainer (6), Orca (7). Global Ponytail, agent-skills, OpenSpec and a global workflow link are extras to remove, after the repositories in use have their project install.
- `setting-up-projects` step 5 writes Matt Pocock's repository setup (`docs/agents/`, the `## Agent skills` block in `AGENTS.md`) and proposes moving existing `openspec/` or `.specify/` work into the issue tracker.
- `maintaining-repos` names no agent-skills skill. Docs drift includes `GLOSSARY.md` and ADRs.
- Upgrade order: `/setting-up-projects` in each repository that should keep the workflow, then `/setting-up-machine`, which removes the global workflow parts.

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

- `rules/global.md` Ask, do not assume: questions only for open points that would change the result, batched in one message (`AskUserQuestion`), never about what the code, the docs or a sensible default answer. The restatement is its own bullet. Non-interactive runs continue without waiting for confirmation (Sonnet arm W stopped to wait for confirmation and scored 0 of 6 in the winery-react run, whose report was removed in #266).

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
