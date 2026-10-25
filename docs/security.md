# Security model of the BenchKeeper app

What the `benchkeeper` app (`app/`) may change on a machine, what it never changes, and which code or test enforces each limit. A limit without a control is listed as open with its issue. Reviewed against `develop` for [#184](https://github.com/ESchuderer/BenchKeeper/issues/184). The plugin's rules and skills are text for agents and are not covered here. Report a vulnerability as described in [SECURITY.md](../SECURITY.md).

## Assets

| Asset | Where | Why it matters |
|---|---|---|
| Agent configuration and rules | the `.claude`, `.codex`, `.gemini`, `.copilot` and `.agents` folders in the home folder (settings, rules, skills, plugin state) | Controls what agents may run; settings files can hold tokens |
| Credentials | `settings.json` env blocks, `.claude.json` MCP entries in the home folder, the `gh` login, `.npmrc`, process environment | Reach other systems |
| Project repositories | registered folders, their `.git`, branches, remotes | Source code; hooks and git config run code |
| The ledger and backups | `.config/benchkeeper/ledger` and `backup` in the home folder | Hold copies of the files above and make undo possible |
| The user's machine | everything the user can write | A run must not reach beyond its roots |
| Published packages and pull requests | npm package, `stable` branch, pull requests of Update all | Reach every user and repository |

## Actors

| Actor | Trusted | Capability considered |
|---|---|---|
| The user running the app | yes | Chooses what to apply; confirms plans |
| A hostile repository | no | Crafted `AGENTS.md`, `.devcontainer`, `.git/config`, hooks, symlinks, file and branch names, a `.git` folder that came with a copied folder |
| A hostile web page | no | Requests to `127.0.0.1` from the user's browser: cross-origin, DNS rebinding, forms |
| Another local user or process | no | Reads files and `ps`; connects to the loopback port |
| A compromised release of a plugin, skill, CLI or dependency | no | Runs code at install time and later, as the user |
| An agent session the app starts or records | partly | Acts on repository text; may write inside its working tree |
| A hostile file the user imports (profile, pack) | no | Names, paths and ids in JSON |
| Someone with write access to the config folder | same user | Edits the ledger or packs; out of scope beyond the notes under Recovery |

## Entry points

1. CLI: `benchkeeper plan | apply | undo | update-all | record | eval | profile | ...` (`app/src/cli.mjs`).
2. Local web server: `benchkeeper ui` (`app/src/server.mjs`), one-time URL token, then cookie plus API key.
3. Files read: agent configuration, repositories (`AGENTS.md`, `.claude`, `package.json`, git state), session transcripts, imported profile and pack files, eval sets, the ledger.
4. Commands run: `git`, `gh`, `npm`, `npx`, the agents' own CLIs, browser and folder-dialog launchers, and the argv of `benchkeeper record`.
5. Network: package registry and GitHub through those tools, the update notice (`app/src/update.mjs`).

## Trust boundaries

- Browser to server: the loopback port, the session cookie and the `x-benchkeeper` key.
- App to the user's files: every file change the app makes goes through the engine with a list of write roots. The writes of the commands it starts are not confined (see Commands below).
- App to child processes: argv only, no shell; the child's own writes are not confined.
- App to repositories: git runs under the repository's own configuration unless pinned.
- App to the network: only through tools that fetch and run third-party code.

## What the app writes

| Step kind | May write | Confinement |
|---|---|---|
| Global setup (`steps/global.mjs`) | Rules, settings and skill files of the selected agents below the home folder; removal of other rules is offered, off by default | Write root is the home folder (`ctx.roots`) |
| Project setup (`steps/project.mjs`) | Files in the project folder and the repository's `info/exclude` list; never the rest of the project's own `.git` | Roots are the project and `<git-common-dir>/info/exclude`; `.git` is denied |
| Commands (plugin installs, `npm i -g`, `npx skills`) | What the tool writes | Not confined; declared `snapshot` paths are root-checked, backed up and restored on undo |
| Update all (`projects.mjs`) | A worktree under `.cache/benchkeeper/worktrees` in the home folder, one commit and a branch per repository, and for a GitHub origin (unless `--no-push`) a push and a pull request | Roots are the worktree and the repository's `info/exclude`; checkout untouched |
| Recorded session (`session.mjs`) | The agent writes in its working tree; the app writes the ledger | Undo restores files inside the repository root only |
| App state | `projects.json`, packs, eval sets and results, `board.html`, session caches | Fixed paths below the config and cache folders |

## What the app never does

- Run a command through a shell.
- Write outside the roots of a run, also through a symlink, a dangling symlink or `..` (the commands a run starts write what their tool writes).
- Write into a project's `.git` except `info/exclude`.
- Force push, push with a `+` refspec, run `git clean`, `git reset`, `git stash` or `git checkout` on a user's checkout, delete a remote branch, or merge or close a pull request.
- Delete a local branch it did not create in the same run.
- Edit a file that changed since the preview without telling (a whole-file write of new text is refused, an edit applies to the file as it is; a copy from a folder is not checked).
- Start a second run while another one holds the lock.
- Add telemetry or send file contents itself. What leaves the machine is what the tools it starts send: `git push` and `gh pr create` of Update all (a GitHub origin, not with `--no-push`), the package registries, the agents' own CLIs (an advice or eval session sends what its agent reads to the agent's provider), and the update notice (an unauthenticated GET for the package version).
- Apply a removal that is not selected. Removals are unselected by default, except removals of files the app identifies as its own by content (see Open, #206).
- Open the `gh` login files: `gh` runs as a command only, and transcripts are read for names and counts.

## Limits and their controls

A test name refers to the file named in the same row.

### Paths and write roots

| Limit | Control | Test |
|---|---|---|
| Write, remove, snapshot and undo stay inside the roots, links resolved | `allowed` in `runner.mjs`, `inside` and `realish` in `fsx.mjs` | `engine.test.mjs` "writes outside the roots are refused, also through a link"; `security.test.mjs` "a remove, a command snapshot and an undo outside the roots are refused", "a path through a dangling link" |
| A removed link is judged as a link, not by its target | `inside(..., follow)` | `global.test.mjs` "full apply" (dangling link removed) |
| A project run never writes into `.git` except `info/exclude` | `projectCtx` (`deny`) and `allowed` | `security.test.mjs` "a project run never writes into .git" |
| A temporary file is never written through a planted link and is removed on failure | `writeAtomic` (`wx`, random name) | `security.test.mjs` "an atomic write that fails leaves no temporary file" |
| The server takes plan ids and change ids, never paths or argv | `POST /api/apply` in `server.mjs` | `server.test.mjs` "apply: answers at once with a job"; `security-server.test.mjs` "a select that is not a list of ids" |
| Ids that become file names are plain: run id, pack id, eval target and case id, skill name | `Ledger.get`, `ownPacks` and `validate` in `packs.mjs`, `readSet` in `cases.mjs`, `SKILL_NAME` in `steps/project.mjs` | `security.test.mjs` "a pack file whose id is not a plain id", "an eval set with a target or case id that is a path"; `packs.test.mjs` "pack files name library skills only"; `project.test.mjs` skill-name test |
| Folder arguments are registered projects | `server.mjs` routes | `server.test.mjs` "reveal opens registered projects only", "scan needs an absolute root" |
| An empty `BENCHKEEPER_HOME` is not the working directory | `machineContext` | `security.test.mjs` "an empty BENCHKEEPER_HOME" |
| The root of a drive, the home folder, a parent of it and the config folder are no project (registration, a profile import, `projectCtx`, the scope of an undo); the server takes absolute paths only | `unfit` in `roots.mjs`, `addProject`, `projectCtx`, `scopeCtx` in `steps/project.mjs` | `bounds.test.mjs` "the root of a drive, the home folder ...", "a profile import registers no home folder", "undo takes the scope of a run ..." |
| A command's own writes are not confined | none (snapshots cover declared paths); the preview runs with a scratch `HOME` and the machine's context home, not the real one, and refuses a seeded folder over 5000 files or 64 MB (links followed) | `prerun.test.mjs` "no credentials reach the command, the home is the context home, and a link loop is refused unrun"; open: [#200](https://github.com/ESchuderer/BenchKeeper/issues/200) |

### Commands and argv

| Limit | Control | Test |
|---|---|---|
| No shell anywhere | `spawn` and `spawnSync` with argv in `runner.mjs`, `server.mjs` | `security.test.mjs` "no code of the app runs a shell" |
| External text never becomes an option: default branch, GitHub host, option-like file names | `safeBranch` in `git.mjs`, `githubRemote`, `git ... -- path`, `diff-tree -z` | `security.test.mjs` "a default branch named by origin", "only a github.com origin", "files named like options", "a default branch that is an option" |
| A failing `git status` is not a clean tree | `clean` | `security.test.mjs` "a failing git status is not a clean tree" |
| Variables that point git at another repository are dropped from the git calls of `git.mjs` and `projects.mjs` (the `git init` of `eval.mjs` and the `worktree list` of `board.mjs` pass the environment as it is) | `repoEnv` and `git` in `git.mjs` | `security.test.mjs` "git gets no variable that points it at another repository" |
| The repository's `core.hooksPath` is pinned for worktree, commit and push | `viaPullRequest` in `projects.mjs` | `projects.test.mjs` "Update all runs the hooks of the checkout" |
| Project `npx` uses the public registry; the skills CLI is an exact version under an alias, never a repo-local binary | `NPX_ENV`, `SKILLS_SPEC` | `project.test.mjs` (the skills command asserts the registry variable and the spec) |
| Commands without a folder run in the home | `applySteps` in `runner.mjs`, `newest` in `steps/global.mjs` | `security.test.mjs` "commands without a folder of their own run in the home" |
| Commands that install or look up third-party code get an environment of an allowlist (path, locale, proxy and certificate settings, tool folders), never a variable named like a credential; `BENCHKEEPER_PASS_ENV` names what the owner lets through | `childEnv` in `childenv.mjs`, used by `applySteps` and `undoRun` in `runner.mjs`, `newest` and `rehearse` | `secrets.test.mjs` "childEnv", "commands run with the filtered environment" |
| Eval and advice sessions get the same allowlist plus the login variables of the agent that runs (`ANTHROPIC_` and `CLAUDE_` for Claude Code, `OPENAI_` and `CODEX_` for Codex), never another agent's key; `GH_TOKEN`, `NPM_TOKEN`, `SSH_AUTH_SOCK` and other credential-like names stay out, and `BENCHKEEPER_PASS_ENV` lets one through (cloud logins such as AWS or Google variables for Bedrock or Vertex need it) | `agentEnv` in `childenv.mjs`, used by `eval.mjs` and `advise.mjs` | `advise.test.mjs` "an agent session gets its own login variables"; `secrets.test.mjs` "an eval session starts with the agent login variables only" |
| `record` runs the command the user typed with the full environment and no confinement | none, by design: the user chooses the command and the agent needs its own login | none |
| A preview runs the skills CLI in a scratch folder and so downloads and runs third-party code: it starts on a click, never when a plan loads | `usePrerun` in `ui/parts.jsx`; the server rehearses only on `POST /api/prerun` | `ui.spec.mjs` "Fix everything walks through" (no file diff before the click) |
| PR URLs are matched before `gh pr view` | `sessions.mjs` | `sessions.test.mjs` "PR states" |
| A `.git` file that points at another repository does not make that repository's `info/exclude` a write root (a worktree's gitdir file or a submodule's `core.worktree` must point back at the project) | `redirectedElsewhere` in `steps/project.mjs` | `bounds.test.mjs` "a .git file that points at another repository ..." |
| `core.fsmonitor` (a command the repository's config names) never runs for the git calls of the app; filter drivers still run for paths whose attributes name them, as in the user's own git (git-lfs needs them), and so does the rest of the repository's config on push and commit | `git` in `git.mjs` (`-c core.fsmonitor=false`) | `bounds.test.mjs` "a repository that names a core.fsmonitor command ..." |
| `-c` settings of an outer git command (`GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT` with its pairs) are dropped when a repository variable shows the app runs from a hook; a container's own pairs pass | `repoEnv` in `git.mjs` | `bounds.test.mjs` "the -c settings of an outer git command ..." |
| A branch name that git allows (`@`, `+` inside, non-ASCII) is taken; option and refspec syntax is not | `safeBranch` in `git.mjs` | `bounds.test.mjs` "safeBranch takes the names git allows ..." |
| Plugin ids, marketplace names and MCP server names read from agent files must match `^[A-Za-z0-9][\w.@:-]*$` before they become an argument or a path; others are skipped | `SAFE_NAME` in `steps/global.mjs` | `global.test.mjs` "names from agent files that start with a dash" |

### Local server

| Limit | Control | Test |
|---|---|---|
| Loopback only | `listen(port, '127.0.0.1')` | `security-server.test.mjs` "listens on 127.0.0.1 only" |
| One-time URL token becomes an HttpOnly, SameSite=Strict cookie plus an API key; the token is not exchanged under another Host | `startServer` | `server.test.mjs` "the URL token works once"; `security-server.test.mjs` "the token is not exchanged" |
| Host, Origin and `Sec-Fetch-Site` checks: other Host 421, foreign or null Origin 403, and when `Sec-Fetch-Site` is present only `same-origin` or `none` pass | `rejectReason` | `server.test.mjs` "rejected: other Host"; `security-server.test.mjs` "same-site" |
| Changes only by POST with the key header; other methods refused | `rejectReason` | `server.test.mjs` "rejected: state changes on GET" |
| Body is a JSON object, at most 1 MB; `select` is a list of strings | `body`, `POST /api/apply` | `security-server.test.mjs` "a body over 1 MB", "a body that is not an object" |
| A bad request target or an unhandled failure ends the request, not the server | `handle` wrapper | `security-server.test.mjs` "a request target the URL parser refuses" |
| Errors do not carry the machine's paths for a missing run | `Ledger.get` | `security-server.test.mjs` "an unknown run is a 404" |
| Static files stay in the build folder | `inside(file, [dist])` | `server.test.mjs` "static files stay inside the build folder" |
| One apply, eval, undo or Update all at a time in the process | `idle` | `server.test.mjs` "apply: ... one at a time" |
| The sessions board needs a one-time ticket | `boardTickets` | `server.test.mjs` "the sessions board" |
| The URL token works once and for 10 minutes; a snap or Flatpak default browser, or a redirect file that cannot be written, launches nothing, so the token is never in an argument and the CLI prints the link | `TOKEN_MS` and `startServer`, `openBrowser` | `security-server.test.mjs` "the URL token stops working after its lifetime"; `server.test.mjs` "a snap or Flatpak browser is not launched", "a redirect file that cannot be written" |
| A POST needs `Content-Type: application/json` (415 otherwise); the page's policy forbids `base` and form targets | `handle` in `startServer` | `security-server.test.mjs` "every answer forbids a base tag" |
| An apply that names a destructive change needs `confirmDestructive: true` in the request; the UI sends it only when a selected change is destructive | `confirmed` in `api` (`server.mjs`), `confirms` in `ui/parts.jsx` | `server.test.mjs` "a removal runs only with confirmDestructive" |
| Registering or removing a project, saving a pack and importing a profile with registration wait for a running apply | `guarded` in `api` | `server.test.mjs` "registry, pack and profile writes wait" |
| The UI test server (`app/test/ui/serve.mjs`) has a fixed port and token | none: a test tool that serves a fixture home only | accepted |

### Agent sessions and data they read

| Limit | Control | Test |
|---|---|---|
| Advice sessions are read-only: Claude `--tools Read,Grep,Glob --restricted`, Codex read-only sandbox, web search and MCP servers off | `advise.mjs` | `advise.test.mjs` "Codex answers through its output file"; `server.test.mjs` "setup advice" |
| Advice output only names known library ids; reasons are one line of at most 200 characters, rendered as text | `parseAdvice` | `advise.test.mjs` "advice: no JSON fails" |
| Session output never becomes a path, command, branch name or pull request text | design; recorded paths come from `git diff-tree` and pass the roots check | `project.test.mjs` "a recorded session lists its files; undo restores them" |
| Evals and the sessions board read transcripts, never build paths from them; the board escapes data and has a CSP | `sessions.mjs`, `board.mjs` | `board.test.mjs` "a title that closes the script element stays data" |
| Advice sessions leave no session file where the installed CLI has the flag: `--no-session-persistence` (Claude Code), `--ephemeral` (Codex), found in the CLI's help, never by a prompt | `noTrace` in `advise.mjs` | `advise.test.mjs` "advice keeps no session on disk" |
| Eval and record sessions run with the user's own configuration (plugins, hooks, login): the measurement needs it, and their hooks and MCP servers run as that user | none, by design | none |

### Supply chain and downloads

| Limit | Control | Test |
|---|---|---|
| Library skills are pinned to a commit and chosen from the library only; imports name library skills only | `library.json`, `packs.mjs` `validate` | `packs.test.mjs` "pack files name library skills only"; `.github/scripts/library-readme.test.mjs` |
| Host tools are installed at the newest release at least 7 days old, no prereleases, only a version the registry still lists, with a string publish time; the registry lookup has a timeout; an installed newer release is not replaced; `npm i -g` and the skills CLI run without lifecycle scripts (the tools need none) | `newest` in `steps/global.mjs`, `cooled` in `cooldown.mjs` | `global.test.mjs` "newest picks the highest release older than 7 days"; `secrets.test.mjs` "cooled" |
| The update notice offers only a release at least 7 days old | `updateNotice` in `update.mjs` | `package.test.mjs` "update check" |
| Global skills install from a pinned commit, with a snapshot of the skill folders and the lock, so undo restores them and the preview shows what the run installs | `SKILL_SOURCES` in `steps/global.mjs` | `secrets.test.mjs` "global skills come from a commit" |
| The publish job holds the OIDC token and runs no repository or dependency code: dependencies are installed with `--ignore-scripts`, built and tested in a job without the token, and only the packed tarball is published | `.github/workflows/npm.yml` | CI (actionlint, zizmor) |
| A merge to `main` starts the publish only through a `workflow_dispatch` from the `npm` job of `release.yml`, which holds `actions: write` and no OIDC token; the publish runs only for a version npm does not have yet | `.github/workflows/release.yml` | CI (actionlint, zizmor) |
| A marketplace on another ref is a manual step, not an automatic move | `steps/global.mjs` | `global.test.mjs` |
| The app has no download or archive code of its own; lockfile with integrity hashes, runtime dependencies pinned, actions pinned to commit SHAs, npm publish by trusted publishing | `app/package-lock.json`, `.github/workflows` | CI (`checks.yml`, zizmor) |
| Third-party plugins are pinned to the commit their tag points to: Codex adds the marketplace at the commit; Claude Code takes only a branch or tag there, so the commit it records for the installed plugin is compared with the pin and a difference at the pin's version is a manual step, never an automatic reinstall | `PONYTAIL_COMMIT`, `MATT_POCOCK_COMMIT`, `marketRef` and the plugin loop in `steps/global.mjs` | `global.test.mjs` "pins: Codex adds a marketplace at the pinned commit", "pins: an installed Claude Code plugin at the pin version from another commit" |
| The host tool and the skills CLI (global and per project) install only after `npm audit signatures` passed for the exact package and its dependencies, fetched without lifecycle scripts into a throwaway project; one check per run (a passed check counts for 10 minutes in the preview), and the preview runs it too | `verify.mjs`, the `verify` field of a command in `runner.mjs` and `prerun.mjs` | `global.test.mjs` "signature check", `prerun.test.mjs` "a failed signature check stops the rehearsal" |
| BenchKeeper's own marketplace follows the branch `stable`, not a tag per release: a marketplace moved to another ref is removed first, and that removes the plugin's options and data in Claude Code on every release. Protection of `stable` and of the release tags is a repository setting of the owner | repository rules, not code | owner check |
| The registry's publish times and this machine's clock decide the 7-day cooldown, and a registry that serves forged signatures with a forged time is trusted | none: the registry is the trust anchor of every npm install | accepted |
| The npm package's trusted-publisher setting names the workflow and, if one is set, the environment with required reviewers | npm and GitHub settings of the owner, not code | owner check, see [#199](https://github.com/ESchuderer/BenchKeeper/issues/199) |

### Secrets

| Limit | Control | Test |
|---|---|---|
| Ledger, run files and backup folders are readable by the user only | `Ledger.save`, `Ledger.backupPath` | `security.test.mjs` "the ledger, its backups and run files are private" |
| A command's environment is never written to the ledger | `applySteps` journals argv and cwd only | `security.test.mjs` "the ledger keeps the argv of a command, never its environment" |
| Preview and API answers leave out file contents and environment | `serialize` in `server.mjs` | `server.test.mjs` (run report, job and plan routes) |
| Commit and pull request text is built from constants; Update all commits only files the app wrote into a fresh worktree | `projects.mjs` | `projects.test.mjs` "Update all commits the new setup on a branch in a worktree" |
| `board.html` and the session caches are mode 0600; the browser redirect file is 0600 | `board.mjs`, `sessions.mjs`, `openBrowser` | `server.test.mjs` "the browser opens a file only this user can read", "a session scan is reused"; `cli.test.mjs` |
| Doctor reports variable names, never values | `doctor.mjs` | `doctor.test.mjs` "feature switches ... never values" |
| A token next to a changed line stays out of the plan: values of keys named like a secret and token shapes are masked in every diff line, context included (files are written from the real text) | `mask` in `redact.mjs`, `diffLines` | `secrets.test.mjs` "mask", "a diff of a settings file masks a token" |
| Session argv, the last lines of command output and the first prompt copied into an eval case are masked before they are stored (best effort: a secret in an unflagged argument is kept) | `redactArgv`, `mask`; `recordSession`, `applySteps`, `undoRun`, `addCase` | `secrets.test.mjs` "a recorded session keeps its argv", "an undo command reports the last lines", "a case copied from a transcript" |
| A new agent settings, config or hooks file is created for the user alone (mode 0600); an existing file keeps its mode | `PRIVATE_NEW` in `runner.mjs` | `secrets.test.mjs` "a new agent settings file is private" |
| Backups of a run are deleted after 90 days (`BENCHKEEPER_BACKUP_DAYS`, 0 keeps them), so a rotated token does not stay in them; undo of that run reports the missing backup | `Ledger.prune`, run before each apply | `secrets.test.mjs` "backups of runs older than the retention period go" |
| Eval outputs and results are written for the user alone, in folders tightened at each run | `runEval` | `secrets.test.mjs` "eval outputs and results are private" |

### Recovery and concurrency

| Limit | Control | Test |
|---|---|---|
| Every change is backed up and hash-verified before it is written; a failed backup stops the step | `applySteps` | `engine.test.mjs` "a failed backup stops the step before any write" |
| The run is journaled before the first change, so a crash leaves an undoable entry | `applySteps`, `undo` | `engine.test.mjs` "an interrupted run stays listed", `project.test.mjs` "a change journaled as running" |
| The file written must hash as planned | `applySteps` | `engine.test.mjs` "apply backs up, records, and undo restores" |
| A failed command with a snapshot can be undone; an undo records each file and backup before it moves anything | `applySteps`, `undoRun` | `security.test.mjs` "a command that fails after its snapshot", "an undo of a snapshot command records each file" |
| A file changed between preview and apply is not overwritten; edits of one file still chain | `preview` (`planHash`), `applySteps` | `security.test.mjs` "a file changed between the preview and the apply", "two edits of one file" |
| Undo refuses a file changed after the run and a missing or changed backup | `undoRun` | `engine.test.mjs` "undo refuses a file changed after the change" |
| Undo of a recorded session fails when git removed its snapshot | `hasTree` | `security.test.mjs` "undo of a session whose snapshots are gone" |
| One run at a time per config folder, across processes; a dead process's lock is taken over | `Ledger.lock` | `security.test.mjs` "a second run is refused while another process holds the lock" |
| Changes of one unit go together; a cancel finishes its unit | `applySteps` | `engine.test.mjs` "changes of one unit go together" |
| Run ids do not repeat | `runId` | `security.test.mjs` "run ids do not repeat in one second" |
| Undo runs only the plugin and marketplace commands plans produce (`undoable`), in a folder below the home or a root, with a time limit; it restores only from backups in this config folder and takes the scope from a folder that could be a project. Someone who writes the ledger can still make undo restore files inside those roots (same user, out of scope beyond this) | `undoable`, `stored` and `undoRun` in `runner.mjs`, `scopeCtx` | `bounds.test.mjs` "undo runs the plugin commands plans produce ...", "undo restores from backups inside this config folder only" |
| A failed snapshot command's undo keeps a later hand edit; overlapping snapshot paths and an undo that failed midway can be undone (a file never reached is left alone) | `undoRun` | `bounds.test.mjs` "undo of a failed snapshot command ...", "an undo of overlapping snapshot paths ...", "an undo that fails midway ..." |
| `doctor` names files changed or back outside the ledger (also restore entries), unfinished runs, unreadable run files and invalid pack files; `restore` and `apply --all` list what they write or remove and ask first | `integrity` in `integrity.mjs`, `choose` in `cli.mjs` | `bounds.test.mjs` "doctor names an edited file ...", "apply --all names the removals ..." |
| The lock is taken over from a dead run under a guard file, and a reused pid does not keep it | `Ledger.lock` | `bounds.test.mjs` "a dead lock is taken over under a guard ..." |

### Destructive actions and Update all

| Limit | Control | Test |
|---|---|---|
| Removals, uninstalls and ask-rule or hook removals are marked destructive and unselected by default; they move to the backup | `preview` in `runner.mjs`, `steps/global.mjs` | `engine.test.mjs` "preview drops no-op changes and marks removals destructive" |
| Update all only touches registered projects with a clean tree, in a worktree from origin's default branch; the checkout is untouched | `viaPullRequest` | `projects.test.mjs` "Update all commits the new setup on a branch in a worktree", "a project with changes ... stops alone" |
| The branch holds only commits the app made (by id from the ledger); a diverged remote branch is an error, never a force push | `viaPullRequest` | `projects.test.mjs` "Update all adds to its own unmerged branch, refuses an amended commit" |
| Push and pull request only for a github.com origin; `--no-push` is respected | `githubRemote` | `projects.test.mjs` "a GitHub origin gets a push and a pull request", "update-all ... --no-push"; `security.test.mjs` "only a github.com origin" |
| An Update all commit run is not undone locally | `undoRun` | `projects.test.mjs` (a local undo of an Update all run is refused) |
| A failed fetch of origin stops a pushed Update all (the local default branch may hold unpushed commits); `--no-push` still starts at the local branch | `viaPullRequest` | `bounds.test.mjs` "a failed fetch never starts a pushed branch ..." |
| At most 25 repositories with a GitHub origin per pushed run (`--max N`, the server's `max`; `projects unshare` too); `--dry-run` (the server's `dryRun`) lists the plan and changes nothing | `updateAll` (`MAX_PROJECTS`), `update-all` in `cli.mjs`, `POST /api/update-all` | `bounds.test.mjs` "Update all pushes to a bounded number ...", "update-all --dry-run ..." |
| git push, ls-remote, commit, worktree add and `gh pr create` run with a time limit, and the network calls without a password or passphrase prompt; the synchronous undo command has one too | `LOCAL`, `NET` and `quiet` in `projects.mjs`, `runCommand` (`SIGKILL` on timeout) | `bounds.test.mjs` "git push, ls-remote, commit, worktree add and gh pr create run with a time limit ..." |
| Only the app's own stale worktree record is removed, never `git worktree prune` on the user's repository; a project in a subfolder of a repository stops | `viaPullRequest` | `bounds.test.mjs` "Update all clears only its own stale worktree record ...", "... a project in a subfolder stops" |
| Removals the setup preselects are files whose whole content is BenchKeeper's (its block alone, an import-only `CLAUDE.md`, an `AGENTS.override.md` as written); text added by hand makes the removal an offer | `projectPlan` in `steps/project.mjs` | `bounds.test.mjs` "a hand-edited AGENTS.override.md is offered ..." |
| Remove BenchKeeper setup changes only files the setup wrote (the recorded skills, BenchKeeper's blocks and files, the state folder), inside the project roots, as one run that undo restores byte for byte; a shared setup becomes a pull request | `localSetup` and `committedSetup` in `steps/project.mjs`, `removeSetup` in `projects.mjs` | `projects-manage.test.mjs` "Remove BenchKeeper setup, local", "keeps a hand-written CLAUDE.local.md", "shared" |
| A project's display name and notes are bounded text without control characters and are kept in `projects.json` only; Relocate rewrites the history of that folder under the run lock | `renameProject`, `relocateProject` in `projects.mjs`, `Ledger.relocate` | `projects-manage.test.mjs` "display name and notes", "relocate" |

## Open

[#206](https://github.com/ESchuderer/BenchKeeper/issues/206) what is left of the low-severity findings: `claude mcp remove` and `codex mcp remove` have no undo (a snapshot of `.claude.json` would copy credentials into the backup), a run killed with SIGKILL leaves its child process groups running while the ledger says `running`, undo copies onto the path instead of a temporary file and a rename, a session undo covers neither commits, branch switches nor ignored files, and session snapshots are unreferenced trees that `git gc` removes after about two weeks (undo then fails loudly).

Not changed on purpose: `POST /api/scan` still walks any absolute root (read only, three levels, it lists folders with an agent setup), a repository's filter drivers and its config on push and commit are the user's own git behavior, and the server's Update all has no plan token (the cap, `dryRun` and the UI's own confirmation bound it).

## Keeping this current

A change that adds a write path, a command, an endpoint or a download adds its limit and test to the tables above, or lists it as open with an issue.
