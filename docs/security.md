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
- App to the user's files: every change goes through the engine with a list of write roots.
- App to child processes: argv only, no shell; the child's own writes are not confined.
- App to repositories: git runs under the repository's own configuration unless pinned.
- App to the network: only through tools that fetch and run third-party code.

## What the app writes

| Step kind | May write | Confinement |
|---|---|---|
| Global setup (`steps/global.mjs`) | Rules, settings and skill files of the selected agents below the home folder; removal of other rules is offered, off by default | Write root is the home folder (`ctx.roots`) |
| Project setup (`steps/project.mjs`) | Files in the project folder and the repository's `info/exclude`; never the project's own `.git` | Roots are the project and `<git-common-dir>/info`; `.git` is denied |
| Commands (plugin installs, `npm i -g`, `npx skills`) | What the tool writes | Not confined; declared `snapshot` paths are root-checked, backed up and restored on undo |
| Update all (`projects.mjs`) | A worktree under `.cache/benchkeeper/worktrees` in the home folder, one commit, a branch, a push and a pull request per repository | Roots are the worktree and the repository's `info`; checkout untouched |
| Recorded session (`session.mjs`) | The agent writes in its working tree; the app writes the ledger | Undo restores files inside the repository root only |
| App state | `projects.json`, packs, eval sets and results, `board.html`, session caches | Fixed paths below the config and cache folders |

## What the app never does

- Run a command through a shell.
- Write outside the roots of a run, also through a symlink, a dangling symlink or `..`.
- Write into a project's `.git` except `info/exclude`.
- Force push, push with a `+` refspec, run `git clean`, `git reset`, `git stash` or `git checkout` on a user's checkout, delete a remote branch, or merge or close a pull request.
- Delete a local branch it did not create in the same run.
- Edit a file that changed since the preview without telling (a whole-file write is refused, an edit applies to the file as it is).
- Start a second run while another one holds the lock.
- Send file contents, settings or tokens anywhere (the update notice sends an unauthenticated GET for the package version).
- Apply a removal unless it is selected (removals are unselected by default; see the exception under Open).
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
| Any folder can be registered as a project | none | open: [#203](https://github.com/ESchuderer/BenchKeeper/issues/203) |
| A command's own writes are not confined | none (snapshots cover declared paths) | open: [#200](https://github.com/ESchuderer/BenchKeeper/issues/200) |

### Commands and argv

| Limit | Control | Test |
|---|---|---|
| No shell anywhere | `spawn` and `spawnSync` with argv in `runner.mjs`, `server.mjs` | `security.test.mjs` "no code of the app runs a shell" |
| External text never becomes an option: default branch, GitHub host, option-like file names | `safeBranch` in `git.mjs`, `githubRemote`, `git ... -- path`, `diff-tree -z` | `security.test.mjs` "a default branch named by origin", "only a github.com origin", "files named like options", "a default branch that is an option" |
| A failing `git status` is not a clean tree | `clean` | `security.test.mjs` "a failing git status is not a clean tree" |
| Variables that point git at another repository are dropped | `git` in `git.mjs` | `security.test.mjs` "git gets no variable that points it at another repository" |
| The repository's `core.hooksPath` is pinned for worktree, commit and push | `viaPullRequest` in `projects.mjs` | `projects.test.mjs` "Update all runs the hooks of the checkout" |
| Project `npx` uses the public registry; the skills CLI is an exact version under an alias, never a repo-local binary | `NPX_ENV`, `SKILLS_SPEC` | `project.test.mjs` (the skills command asserts the registry variable and the spec) |
| Commands without a folder run in the home | `applySteps` in `runner.mjs`, `newest` in `steps/global.mjs` | `security.test.mjs` "commands without a folder of their own run in the home" |
| PR URLs are matched before `gh pr view` | `sessions.mjs` | `sessions.test.mjs` "PR states" |
| Read-only git commands run under the repository's own config | none | open: [#203](https://github.com/ESchuderer/BenchKeeper/issues/203) |
| Names from agent files are passed as arguments unchecked | none | open: [#206](https://github.com/ESchuderer/BenchKeeper/issues/206) |

### Local server

| Limit | Control | Test |
|---|---|---|
| Loopback only | `listen(port, '127.0.0.1')` | `security-server.test.mjs` "listens on 127.0.0.1 only" |
| One-time URL token becomes an HttpOnly, SameSite=Strict cookie plus an API key; the token is not exchanged under another Host | `startServer` | `server.test.mjs` "the URL token works once"; `security-server.test.mjs` "the token is not exchanged" |
| Host, Origin and `Sec-Fetch-Site` checks: other Host 421, foreign or null Origin 403, only `same-origin` or `none` pass | `rejectReason` | `server.test.mjs` "rejected: other Host"; `security-server.test.mjs` "same-site" |
| Changes only by POST with the key header; other methods refused | `rejectReason` | `server.test.mjs` "rejected: state changes on GET" |
| Body is a JSON object, at most 1 MB; `select` is a list of strings | `body`, `POST /api/apply` | `security-server.test.mjs` "a body over 1 MB", "a body that is not an object" |
| A bad request target or an unhandled failure ends the request, not the server | `handle` wrapper | `security-server.test.mjs` "a request target the URL parser refuses" |
| Errors do not carry the machine's paths for a missing run | `Ledger.get` | `security-server.test.mjs` "an unknown run is a 404" |
| Static files stay in the build folder | `inside(file, [dist])` | `server.test.mjs` "static files stay inside the build folder" |
| One apply, eval, undo or Update all at a time in the process | `idle` | `server.test.mjs` "apply: ... one at a time" |
| The sessions board needs a one-time ticket | `boardTickets` | `server.test.mjs` "the sessions board" |
| The token is visible in argv for snap and Flatpak browsers; the token does not expire | none | open: [#204](https://github.com/ESchuderer/BenchKeeper/issues/204) |

### Agent sessions and data they read

| Limit | Control | Test |
|---|---|---|
| Advice sessions are read-only: Claude `--tools Read,Grep,Glob --restricted`, Codex read-only sandbox, web search and MCP servers off | `advise.mjs` | `advise.test.mjs` "Codex answers through its output file"; `server.test.mjs` "setup advice" |
| Advice output only names known library ids; reasons are one line of at most 200 characters, rendered as text | `parseAdvice` | `advise.test.mjs` "advice: no JSON fails" |
| Session output never becomes a path, command, branch name or pull request text | design; recorded paths come from `git diff-tree` and pass the roots check | `project.test.mjs` "a recorded session lists its files; undo restores them" |
| Evals and the sessions board read transcripts, never build paths from them; the board escapes data and has a CSP | `sessions.mjs`, `board.mjs` | `board.test.mjs` "a title that closes the script element stays data" |
| Eval and record sessions run with the user's own configuration | none, by design | open: [#200](https://github.com/ESchuderer/BenchKeeper/issues/200) |

### Supply chain and downloads

| Limit | Control | Test |
|---|---|---|
| Library skills are pinned to a commit and chosen from the library only; imports name library skills only | `library.json`, `packs.mjs` `validate` | `packs.test.mjs` "pack files name library skills only"; `.github/scripts/library-readme.test.mjs` |
| Host tools are installed at the newest release at least 7 days old, no prereleases | `newest` in `steps/global.mjs` | `global.test.mjs` "newest picks the highest release older than 7 days" |
| A marketplace on another ref is a manual step, not an automatic move | `steps/global.mjs` | `global.test.mjs` |
| The app has no download or archive code of its own; lockfile with integrity hashes, runtime dependencies pinned, actions pinned to commit SHAs, npm publish by trusted publishing | `app/package-lock.json`, `.github/workflows` | CI (`checks.yml`, zizmor) |
| Plugin and global skill sources are mutable (tags, branches, default branch), the cooldown has gaps, installs run lifecycle scripts, the publish job runs dependency scripts | none | open: [#198](https://github.com/ESchuderer/BenchKeeper/issues/198), [#199](https://github.com/ESchuderer/BenchKeeper/issues/199) |

### Secrets

| Limit | Control | Test |
|---|---|---|
| Ledger, run files and backup folders are readable by the user only | `Ledger.save`, `Ledger.backupPath` | `security.test.mjs` "the ledger, its backups and run files are private" |
| A command's environment is never written to the ledger | `applySteps` journals argv and cwd only | `security.test.mjs` "the ledger keeps the argv of a command, never its environment" |
| Preview and API answers leave out file contents and environment | `serialize` in `server.mjs` | `server.test.mjs` (run report, job and plan routes) |
| Commit and pull request text is built from constants; Update all commits only files the app wrote into a fresh worktree | `projects.mjs` | `projects.test.mjs` "Update all commits the new setup on a branch in a worktree" |
| `board.html` and the session caches are mode 0600; the browser redirect file is 0600 | `board.mjs`, `sessions.mjs`, `openBrowser` | `server.test.mjs` "the browser opens a file only this user can read", "a session scan is reused"; `cli.test.mjs` |
| Doctor reports variable names, never values | `doctor.mjs` | `doctor.test.mjs` "feature switches ... never values" |
| Diff context can show a token next to a changed line; session argv, command output and backups can hold tokens | none | open: [#201](https://github.com/ESchuderer/BenchKeeper/issues/201) |

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
| Undo trusts the ledger file; synchronous git and gh calls have no timeout | none | open: [#205](https://github.com/ESchuderer/BenchKeeper/issues/205), [#202](https://github.com/ESchuderer/BenchKeeper/issues/202) |

### Destructive actions and Update all

| Limit | Control | Test |
|---|---|---|
| Removals, uninstalls and ask-rule or hook removals are marked destructive and unselected by default; they move to the backup | `preview` in `runner.mjs`, `steps/global.mjs` | `engine.test.mjs` "preview drops no-op changes and marks removals destructive" |
| Update all only touches registered projects with a clean tree, in a worktree from origin's default branch; the checkout is untouched | `viaPullRequest` | `projects.test.mjs` "Update all commits the new setup on a branch in a worktree", "a project with changes ... stops alone" |
| The branch holds only commits the app made (by id from the ledger); a diverged remote branch is an error, never a force push | `viaPullRequest` | `projects.test.mjs` "Update all adds to its own unmerged branch, refuses an amended commit" |
| Push and pull request only for a github.com origin; `--no-push` is respected | `githubRemote` | `projects.test.mjs` "a GitHub origin gets a push and a pull request", "update-all ... --no-push"; `security.test.mjs` "only a github.com origin" |
| An Update all commit run is not undone locally | `undoRun` | `projects.test.mjs` (a local undo of an Update all run is refused) |
| Update all can publish unpushed local commits when the fetch fails; no repository cap, no dry run | none | open: [#202](https://github.com/ESchuderer/BenchKeeper/issues/202) |
| Removal changes that identify their own files by content are preselected although marked destructive | none | open: [#206](https://github.com/ESchuderer/BenchKeeper/issues/206) |

## Open

[#198](https://github.com/ESchuderer/BenchKeeper/issues/198) supply chain pins and integrity, [#199](https://github.com/ESchuderer/BenchKeeper/issues/199) publish job scripts, [#200](https://github.com/ESchuderer/BenchKeeper/issues/200) child environment and isolation, [#201](https://github.com/ESchuderer/BenchKeeper/issues/201) secrets in plans and backups, [#202](https://github.com/ESchuderer/BenchKeeper/issues/202) Update all bounds, [#203](https://github.com/ESchuderer/BenchKeeper/issues/203) hostile repositories and registration, [#204](https://github.com/ESchuderer/BenchKeeper/issues/204) server token handling, [#205](https://github.com/ESchuderer/BenchKeeper/issues/205) ledger trust, doctor check, dry-run default, [#206](https://github.com/ESchuderer/BenchKeeper/issues/206) low-severity findings.

## Keeping this current

A change that adds a write path, a command, an endpoint or a download adds its limit and test to the tables above, or lists it as open with an issue.
