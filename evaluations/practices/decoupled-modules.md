# Decoupled modules: where BenchKeeper's seams are and whether to split before 7.0

Category: practices, Checked 2026-10-26, Decision: One repository and one npm package, modules by folder with enforced import rules, plus a content contract that separates the content version from the app version

Question ([#302](https://github.com/ESchuderer/BenchKeeper/issues/302)): does BenchKeeper split into decoupled modules (engine, content, agent adapters, CLI, UI, plugin) before 7.0, and as packages in one repository, as several repositories, or only as boundaries inside the code? Spike: nothing under `plugins/` or `app/` changed. The issue asks for the import graph and the version inventory "in the issue"; they are in this note instead (the brief for the spike forbids posting to the issue), and the pull request says so.

## Advertised

What the official documentation says about the two packaging surfaces BenchKeeper ships through. Read on 2026-10-26. Quotation marks mark a passage read verbatim (Claude Code pages); the npm and Codex statements are paraphrases of a fetched summary of the page.

| | Documented |
|---|---|
| Claude Code plugin root | Every component path "must resolve inside the plugin root"; a path that escapes it "doesn't load". Files outside the plugin directory are not copied into the cache. So `plugins/benchkeeper/` is already the content module physically: nothing outside it can be part of the plugin ([manifest reference](https://code.claude.com/docs/en/plugins-reference), [loading reference](https://code.claude.com/docs/en/plugins/loading.md)). |
| Claude Code plugin version | `version` in `plugin.json` "pins the plugin to that version until you change it"; the manifest's version wins over the marketplace entry's; without either, a git source uses the commit SHA. Users of a `stable` ref therefore receive a skill edit only when `version` changes ([loading reference, Versions and updates](https://code.claude.com/docs/en/plugins/loading.md)). This is why a change under `plugins/` has to raise the version (release-please does it on the release pull request, `release-please-config.json`). |
| Claude Code manifest fields | An unrecognized top-level key is "stripped" and `claude plugin validate` warns, `--strict` fails on warnings. `metadata` is a free-form object Claude Code "doesn't read" (v2.1.222 or later) ([manifest reference](https://code.claude.com/docs/en/plugins-reference)). A separate file next to the manifest avoids depending on either. |
| Claude Code marketplace sources | Relative path, `github`, `url`, `git-subdir`, `npm` (`package`, `version`, `registry`), `archive`, `command`. `ref` is a branch or tag, `sha` a full commit ([marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference.md)). BenchKeeper's marketplace uses the relative path `./plugins/benchkeeper` in this repository (`.claude-plugin/marketplace.json`) and the app adds it at the branch `stable` (`app/src/steps/global.mjs:50`). |
| Claude Code plugin dependencies | A plugin that ships a `package.json` and a lockfile gets its dependencies installed into the cache, but "a plugin with a git, GitHub, folder, workspace, or linked dependency gets no install" ([loading reference](https://code.claude.com/docs/en/plugins/loading.md)). `plugins/benchkeeper/` has no `package.json`, so a content package inside it would have to avoid workspace links. |
| Codex plugin | Marketplace entries: `local`, `url`, `git-subdir`, `npm`, with `ref` or `sha` on git sources. `.codex-plugin/plugin.json` is called a compatibility fallback next to a portable root `plugin.json`, and `.claude-plugin/marketplace.json` a legacy-compatible marketplace location; how versions are compared for an update is not stated ([Codex plugins](https://developers.openai.com/codex/plugins/build)). Both manifests of this repository carry the same version, checked at `.github/scripts/release.sh:16`. |
| npm workspaces | Declared with the `workspaces` property of `package.json`; a workspace used as a dependency is symlinked and takes a standard version range; the page does not mention a `workspace:` protocol or say whether the lockfile is shared ([npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces)). `npm publish --workspace=<name>` and `--workspaces` exist ([npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish)). |
| npm trusted publishing | Configured per package on npmjs.com, up to 10 publishers per package, a workflow file in `.github/workflows/`, npm CLI 11.5.1 or later, Node 22.14.0 or later, GitHub-hosted runners ([trusted publishers](https://docs.npmjs.com/trusted-publishers)). Today one package (`benchkeeper`) has one binding, in `npm.yml`; each additional published package would need its own. Whether the first publish of a new package can use the token-less path is unverified. |

## Independent evidence

None gathered: no comparison with other projects that split an installer from its content. The only external evidence is the documentation above. The internal evidence of the same kind is in [code health pass](code-health-pass.md): dependency-cruiser 18.6.0 found 2 real import cycles in `app/` with a `no-circular` rule configured (1.4 s), which is the cycle recorded below.

## User reports

None. No user has asked for separately versioned parts; the issue records the maintainer's cost of the single version stream (PR #296 changed 17 files for one option and one doctor message).

## Benchmark

Not measured. A module split changes no behavior of a skill, so no trial arm applies. Cost and benefit below come from the code and from the commit history, not from a run.

## Skill authoring check

This section holds the codebase check: the import graph, the version inventory and the change history. Nothing was run in an agent session.

### Import graph of `app/src`

Method: a script in the scratch directory read the static `import` and `import()` statements of the 46 `.mjs` files of `app/src` (44 at the top level, 2 in `steps/`), 7,840 lines, 209 local import edges. No dynamic `import()` of a local file exists. The JSON, TOML and Markdown folders (`settings/`, `baseline/`, `orca/`) are data, not code.

Layers as the imports show them (a module imports only from layers above it in this list, except the cycle named below):

| Layer | Modules (fan-in in brackets) | Reading |
|---|---|---|
| Leaves, no local import | `fsx` (30), `content` (14), `git` (8), `merge` (5), `redact` (9), `cooldown` (3), `states` (2), `browser` (1) | Pure helpers. `content.mjs` is the only file that knows the package layout (`content/` packed, or `../../plugins/benchkeeper/` in a clone). |
| Base | `childenv` (8), `ledger`, `diff`, `roots`, `packs` (9), `agents` (14), `verify`, `update` | `agents.mjs` is the registry (`agents.json`) plus format renderers; it imports only `merge`. |
| Run core | `runner` (12): context, apply, undo, history | Imports `childenv`, `diff`, `fsx`, `git`, `ledger`, `redact`. Writes `appVersion` into every ledger run (`runner.mjs:123,275`). |
| Plan builders | `steps/global` (12), `steps/project` (11), `frameworks`, `baseline` | Build the change lists. `steps/global.mjs` holds the plugin pins, the marketplace commands and the skill copies for agents without plugins; `steps/project.mjs` writes the project state. |
| Features | `rules`, `settings`, `skills`, `projects`, `doctor`, `level`, `allow`, `instructions`, `integrity`, `inventory`, `profile`, `knowledge`, `dashboard`, `eval`, `cases`, `advise`, `prerun`, `accounts`, `credstore`, `sessions`, `session`, `board`, and the module behind `benchkeeper verify` | Each answers a CLI command and usually a UI route. |
| Entries | `cli` (913 lines, 26 direct imports, nothing imports it), `server` (744 lines, 26 direct imports, imported only by `cli`) | `cli` reaches 45 of the 46 modules, `server` 41. |

<details>
<summary>Adjacency list: each module and the local modules it imports (46 lines)</summary>

```text
accounts.mjs -> browser.mjs childenv.mjs credstore.mjs fsx.mjs redact.mjs runner.mjs
advise.mjs -> childenv.mjs steps/project.mjs
agents.mjs -> merge.mjs
allow.mjs -> fsx.mjs projects.mjs settings.mjs
baseline.mjs -> fsx.mjs git.mjs
board.mjs -> fsx.mjs projects.mjs
browser.mjs ->
cases.mjs -> content.mjs fsx.mjs redact.mjs runner.mjs
childenv.mjs -> git.mjs
cli.mjs -> accounts.mjs agents.mjs baseline.mjs board.mjs cases.mjs content.mjs doctor.mjs eval.mjs frameworks.mjs fsx.mjs <self-test>.mjs knowledge.mjs level.mjs packs.mjs profile.mjs projects.mjs redact.mjs rules.mjs runner.mjs server.mjs session.mjs sessions.mjs settings.mjs skills.mjs steps/global.mjs steps/project.mjs
content.mjs ->
cooldown.mjs ->
credstore.mjs -> childenv.mjs
dashboard.mjs -> agents.mjs fsx.mjs inventory.mjs packs.mjs projects.mjs states.mjs steps/global.mjs steps/project.mjs
diff.mjs -> redact.mjs
doctor.mjs -> accounts.mjs allow.mjs baseline.mjs content.mjs frameworks.mjs fsx.mjs instructions.mjs integrity.mjs level.mjs packs.mjs rules.mjs runner.mjs settings.mjs steps/global.mjs steps/project.mjs
eval.mjs -> advise.mjs cases.mjs childenv.mjs content.mjs fsx.mjs redact.mjs
frameworks.mjs -> agents.mjs content.mjs fsx.mjs merge.mjs
fsx.mjs ->
git.mjs ->
<self-test>.mjs -> agents.mjs content.mjs doctor.mjs fsx.mjs steps/global.mjs steps/project.mjs
instructions.mjs -> fsx.mjs packs.mjs
integrity.mjs -> fsx.mjs packs.mjs
inventory.mjs -> agents.mjs fsx.mjs runner.mjs states.mjs steps/global.mjs
knowledge.mjs -> fsx.mjs redact.mjs
ledger.mjs -> fsx.mjs
level.mjs -> agents.mjs fsx.mjs projects.mjs steps/global.mjs steps/project.mjs
merge.mjs ->
packs.mjs -> content.mjs fsx.mjs
prerun.mjs -> agents.mjs childenv.mjs diff.mjs fsx.mjs redact.mjs steps/global.mjs
profile.mjs -> agents.mjs content.mjs packs.mjs projects.mjs roots.mjs rules.mjs runner.mjs steps/global.mjs steps/project.mjs
projects.mjs -> agents.mjs content.mjs doctor.mjs fsx.mjs git.mjs roots.mjs runner.mjs steps/project.mjs update.mjs
redact.mjs ->
roots.mjs -> fsx.mjs
rules.mjs -> agents.mjs fsx.mjs git.mjs instructions.mjs runner.mjs settings.mjs steps/project.mjs
runner.mjs -> childenv.mjs diff.mjs fsx.mjs git.mjs ledger.mjs redact.mjs
server.mjs -> accounts.mjs advise.mjs agents.mjs board.mjs cases.mjs content.mjs dashboard.mjs diff.mjs doctor.mjs eval.mjs frameworks.mjs fsx.mjs git.mjs inventory.mjs level.mjs packs.mjs prerun.mjs profile.mjs projects.mjs rules.mjs runner.mjs sessions.mjs settings.mjs skills.mjs steps/global.mjs steps/project.mjs
session.mjs -> fsx.mjs git.mjs ledger.mjs redact.mjs
sessions.mjs -> content.mjs fsx.mjs
settings.mjs -> fsx.mjs merge.mjs steps/global.mjs
skills.mjs -> agents.mjs content.mjs fsx.mjs packs.mjs runner.mjs steps/global.mjs steps/project.mjs
states.mjs ->
steps/global.mjs -> agents.mjs childenv.mjs content.mjs cooldown.mjs fsx.mjs merge.mjs verify.mjs
steps/project.mjs -> agents.mjs baseline.mjs content.mjs cooldown.mjs frameworks.mjs fsx.mjs git.mjs merge.mjs packs.mjs roots.mjs runner.mjs steps/global.mjs
update.mjs -> cooldown.mjs
verify.mjs -> childenv.mjs runner.mjs
```

</details>

Findings that differ from the issue text:

- The engine does not import the entries. The CLI and the server share no module with each other beyond the engine (`cli` imports `server` only to start it). The coupling the issue describes is the width of the entries: each reaches about 26 engine modules directly, with no facade between them. That width is why a UI route can exist without a command: nothing forces both to call one function.
- `app/ui/` reaches `src/` once, `ui/shell.jsx:6` re-exporting `RANK` from the 3-line `states.mjs`; everything else goes through HTTP (`ui/api.js`). The UI is already a separate module with a real interface, the route table. `app/test/routes-doc.test.mjs` already checks that the table in `app/README.md` lists every route of `server.mjs` and that each route names a command or a reason.
- `web/` imports nothing from `app/` or `plugins/` and has its own `package.json` and lockfile. It reads `web/src/data/facts.json` and the recorded benchmark data; `web/scripts/readme.mjs` writes README blocks from the facts. The site is already decoupled by imports; it follows the app through the version strings (below), the screenshots in `web/public/app/` that the app's `npm run screenshots` regenerates (14 files in one release commit), and the README blocks that `web/scripts/readme.mjs` writes into `app/README.md`.
- One import cycle group with two elementary cycles, `level`, `projects`, `doctor` and `level`, and `allow`, `projects`, `doctor` and `allow`: `level` imports `projects`; `projects` imports `doctor` (`projects.mjs:8`); `doctor` imports `allow` and `level` (`doctor.mjs:5,11`); `allow` imports `projects` (`allow.mjs:6`). All four are static top-level imports, so the four modules cannot be extracted separately. The one edge that closes it is `projects.mjs:8` importing `skillFiles`, a reader of skill folders, from `doctor.mjs` (`doctor.mjs:71`); both cycles run through that edge, so moving the function to `skills.mjs` breaks the group.
- Sizes in the issue are stale: `cli.mjs` 913 lines (issue: 670), `server.mjs` 744 (685), `projects.mjs` 483 (482).

Per-agent logic. `agents.json` plus `agents.mjs` is data-driven for paths and file formats of all four agents (rules, skills, settings, MCP, subagents). Code branches on the agent id for Claude Code and Codex only; Gemini CLI and Copilot CLI appear only through the registry and the skill copy for agents without plugins (`steps/global.mjs:260-267`, `agents.mjs:30`). Count of lines that name `'claude'` or `'codex'` per file: `steps/global` 38, `steps/project` 23, `settings` 16, `rules` 13, `accounts` 12, `sessions` 8, `advise` 8, `cli` 6, `server` 4, `frameworks` 3, `eval` 3, `allow` 3. Accounts (`accounts.mjs`, 339 lines) splits into a generic part (registry, default account, credential store, launcher) and per-agent commands for login and status (`claude auth status`, `codex login status`, `accounts.mjs:168,255`), which is adapter code.

### Version coupling

Every place the version appears or is derived:

| Where | What | Set by |
|---|---|---|
| `app/package.json`, `app/package-lock.json` | app version, the only npm package published | release-please |
| `plugins/benchkeeper/.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` | setup (content) version, must be equal | release-please |
| `app/test/package.test.mjs:9-11` | asserts app version equals both plugin versions | test |
| `app/src/steps/global.mjs:50,55` | `version: 'app'`: the pinned plugin version is the app version, so `doctor` and `plan` report any other plugin version as drift | code |
| `.benchkeeper/state.json` `setupVersion` | the app version a project was set up with (`steps/project.mjs:474`); `doctor.mjs:93`, the due check of `projects update` (`projects.mjs:234,251`) and the branch `chore/agent-setup-<version>` compare against it | code |
| Ledger runs `appVersion` | history record only (`runner.mjs:123,275`) | code |
| `CHANGELOG.md`, tag `setup-v<major>.<minor>.<patch>`, branch `stable`, GitHub Release | one entry and one tag per setup version; `stable` is the ref the marketplace follows | release-please, `release.yml` |
| `npx benchkeeper@<x.y.z>` and `--branch app-v<x.y.z>` (was `setup-v<x.y>`) | 44 lines in 11 tracked files outside the recorded history: `README.md` 4, `app/README.md` 6, `docs/setup.md` 9, `docs/stack.md` 2, `AGENTS.md` 1, `web/src/data/facts.json` 7, `web/src/components/Page.tsx` 6, `AppPage.tsx` 1, **`plugins/benchkeeper/skills/setting-up-projects/SKILL.md` 6, `skills/maintaining-repos/SKILL.md` 1, `library/README.md` 1** | `version-pins.mjs` rewrites them, CI checks it |

The last row is the knot. Skill text and the library README, which are content, carry the app version. So a release that changes only the app has to edit three files under `plugins/`, and the release then carries a plugin version bump, a changelog entry, a tag and a move of `stable` for a change users of the plugin cannot see.

Measured on the non-merge commits of `main` from 2026-10-12 to 2026-10-26 (166 commits):

- 29 commits raised the setup version, with a median of 23 changed files per release (maximum 136; the example in the issue, #296, changed 17).
- 8 of the 29 changed nothing under `plugins/` except the version and the app pins: all 8 were app releases. 12 of the 29 changed no file under `app/src` or `app/ui`: content-only releases. The remaining 9 changed both.
- 41 commits touched `app/src` or `app/bin`, 29 touched `plugins/benchkeeper/`, 17 touched both. So 59 % of the plugin changes also change the engine, and 41 % of the engine changes also change the plugin: the two change together often enough that separate repositories would put a majority of plugin changes across two pull requests.
- 27 commits touched `app/ui`, 24 of them also `app/src`: the UI follows the engine and the server in the same pull request.

Content reaches users on three paths, which decides what a content-only release can skip:

1. The plugin, from the marketplace at `stable`: git only, no npm publish.
2. The npm package: `scripts/content.mjs` copies `rules`, `skills`, `library` and `evals` into `content/` at pack time (`app/scripts/content.mjs`, `PARTS`). The global rules, the library packs, the eval sets and the skill copies for Gemini CLI and Copilot CLI (agents without plugins, `steps/global.mjs:260-267`) reach users only this way.
3. The per-project copies written by `projects apply`, from the packed content.

A content-only release therefore still needs an npm publish of the same package, and because `app/package.json` supplies the npm version it also bumps the app version; `release.yml` already starts `npm.yml` for a version npm does not have yet, so no new trigger is needed. The independent content version removes the reverse direction (an app-only release no longer touches `plugins/`), not the forward one. Fetching content at run time instead would need network access and a pin of its own, and `apply` and `plan` run offline today.

### Seams, as modules

| Module | Holds today | Public interface | May import |
|---|---|---|---|
| `core` | `fsx`, `git`, `merge`, `redact`, `childenv`, `cooldown`, `states`, `ledger`, `diff`, `roots`, `runner` | `context()`, `apply(changes, ctx)`, `undo`, `history`, the change record `{ id, step, title, kind, path or argv, edit or after }`, text and file helpers | nothing local |
| `agents` | `agents.json`, `agents.mjs` and the Claude Code and Codex branches now spread over `steps/global`, `settings`, `rules`, `accounts`, `sessions`, `advise` | one adapter per agent: `{ id, paths, renderRules, renderSubagent, pluginCommands, settingsLayers, sessionLogs, loginStatus, adviseArgv }`; Gemini CLI and Copilot CLI implement only the file operations | `core` |
| `content` | `content.mjs`, `packs`, the library catalog, a new `content.json` | `contentDir`, `contentVersion`, `minApp`, `library()`, `skills()`, `rules()`, `evals()` | `core` |
| `engine` | `steps/*`, `frameworks`, `baseline`, `rules`, `settings`, `skills`, `projects`, `doctor`, `allow`, `level`, `inventory`, `profile`, `knowledge`, `dashboard`, `eval`, `cases`, `advise`, `prerun`, `instructions`, `integrity`, `verify`, `sessions`, `board`, the generic part of `accounts` | functions that return plain documents with a `schema` field (plan, doctor, status, inventory, dashboard, sessions, history), and `apply` over a plan; these documents are the CLI JSON documents | `core`, `agents`, `content` |
| `cli` | `cli.mjs` | argument parsing and printing; calls only the engine functions | `engine` |
| `server` and `ui` | `server.mjs`, `app/ui/` | HTTP routes (the table in `app/README.md`) and the browser app; a route calls the engine function that a command calls | `engine` |
| `plugin` | `plugins/benchkeeper/`: manifests, hooks (the tier band), skills, rules, library, evals, types | the plugin manifests and `content.json`; skills name commands, not versions | none (files only) |
| `site` | `web/` | `facts.json` and the bench data | none |

Questions of the issue that sit across these modules:

- Account support. Generic registry, default, credential store and launcher belong in the engine; the login and status commands per agent belong in the adapters; the CLI and the UI call the engine. The usage work in #338 is built on the current `accounts.mjs` and moves in the adapter step, last, so it does not collide.
- CLI JSON documents (#297, #316 to #321). They are the return values of the engine functions, printed by the CLI with `--json` and returned by the server. The rule that removes the UI-only routes: a route handler calls a facade function that a command also calls; the route table test already names the reason when one does not.
- Agent-facing CLI skill (#299). Content, in `plugins/benchkeeper/skills/`. It lists commands, not versions, and the command list is checked against `HELP` the way the route table is, so it cannot drift from the CLI.

Deliberately not split: the plan builders and the ledger (undo needs the plan's change records, one change set is applied and undone as one unit); per-agent code for the four agents into four packages (three of them differ only by registry data); accounts into its own package (one consumer); the UI into its own package (its only interface, HTTP, is already enforced by `api.js`); the site (already separate); `evaluations/` and `bench/` (records, not code).

### Split options compared

| Option | Cost | Benefit | Verdict |
|---|---|---|---|
| Status quo | none now; every app release edits `plugins/`, 3 more files than needed; the cycle and the 26-wide entries stay | none | no |
| Boundaries in one package, enforced | break the cycle (move one function, `skillFiles`), add import rules to CI (dependency-cruiser, found the cycle in 1.4 s), a facade the entries call, adapters per agent; file moves last. One lockfile, one publish binding, one `npm ci` per job | the seams of the table above, checked on every pull request, no release machinery changes | **yes** |
| Content contract (`content.json`, pin-only diffs under `plugins/` need no release) | one file, one engine check, the state file gains a field, `release.sh` ignores pin-only diffs under `plugins/`, `release.yml` adds an `app-v` tag | app releases no longer force a content release, tag or move of `stable` (8 of 29 releases in the window); content releases state which app they need | **yes, 7.0** |
| One repository with npm workspaces, independent versions | root `package.json`; `app/` and `web/` are separate npm projects today, each with its lockfile and its CI `working-directory`; one trusted publisher binding per new published package; pack and release scripts per package | enforced boundaries by declared dependencies, which the import rules give without packages; independent versions, which no consumer needs: the CLI and the server are the only consumers of the engine and both ship in one package | no for 7.0 |
| Several repositories | the marketplace source of every existing user moves, which removes the marketplace and the plugin's data (`steps/global.mjs:44-47`); 59 % of plugin changes also change the engine, so they become two pull requests; skills name commands, so content and CLI changes must be ordered | content cadence apart from the engine | no |

Revisit workspaces when a second consumer of the engine exists (for example a separate agent-facing package) or when a part needs its own release cadence that the content contract cannot give.

### Content contract

Since this note was written, `release.sh` (the check and the self-test) was replaced by release-please and a weekly release. The rules below that name `release.sh` (pin-only diffs under `plugins/` need no release, an `app/`-only change raises the app version) need a release-please equivalent when this is built, for example a second package with its own tag.

`plugins/benchkeeper/content.json`: `{ "schemaVersion": 1, "contentVersion": "<major>.<minor>.0", "minApp": "<x.y.z>" }`. A separate file, not a `plugin.json` field: Claude Code strips unknown top-level keys with a warning and whether Codex tolerates them is not documented on the page read (unverified). `plugin.json` `version` stays the plugin's own version and equals `contentVersion`; both manifests keep the `release.sh` equality check.

- The app reads `content.json` from the packed copy; `doctor` and `apply` refuse content whose `minApp` is above the app version and tell the user to run a newer `npx benchkeeper@<version>`. The installed plugin is checked the same way, so an older app does not apply skills that name commands it lacks.
- The app declares the content range it supports (`minContent`); `PLUGINS` pins `version: 'app'` becomes the content version.
- Pins in skill text (owner decision of 2026-10-27, #391): the skills and the library README name `npx benchkeeper@<major>` (for example `@7`), not an exact version. The content release writes the major, which changes only at a breaking release, so app-only releases never touch `plugins/`; `version-pins.mjs` skips `plugins/`. README, `docs/`, the site and `AGENTS.md` keep exact pins. Cost: the newest release of the major runs without a cooldown, and whether `npx` with no exact version refreshes a cached copy is unverified.
- `release.sh check` keeps its rule for `plugins/` (apart from the pin-only diffs above): a change there raises the content version, the changelog entry, the tag `setup-v<major>.<minor>` and the move of `stable`. A matching check for the app: a change under `app/` other than `app/test` and the READMEs (`src`, `ui`, `bin`, `scripts`, the dependency list) raises the app version, because `app/scripts/content.mjs` decides what enters the package. Every release of either kind raises the app version, since content reaches npm users only inside the package; `npm.yml` already publishes on the app version, not on the tag.
- Project state: `.benchkeeper/state.json` goes to `schemaVersion: 2` with `appVersion` and `contentVersion` and no `setupVersion`. A project is behind when either differs, so `doctor` and `projects update` behave as before; a version 1 file is read with `setupVersion` as both values; the 7.0 reader refuses a `schemaVersion` above 2. The branch and title of `projects update` use the content version.

### What existing users see on upgrade to 7.0

An upgrade note is required. State files migrate on the next `projects apply` or `projects update` (a version 1 file is read, never rejected). Shared repositories: a 6.x app reads a version 2 file as "project setup undefined" and its next apply rewrites it as version 1, so every machine that shares such a repository updates together. Skill text now says `npx benchkeeper@<major>`. The marketplace ref `stable` and the plugin id `benchkeeper@benchkeeper` do not change, so no marketplace is removed. The tag `setup-v<major>.<minor>` keeps meaning a content release. Every app release (content releases included) also gets a tag `app-v<x.y.z>`; the clone install in the docs names that tag, `version-pins.mjs` rewrites it from `app/package.json`, and `release.yml` creates it.

### Tests and CI

Coverage floors (`app/package.json`, `test:coverage`: lines 97, branches 89, functions 94) stay one gate over `src/**` and `ui/*.js` until the folders exist; #327 (test audit per module) then sets a floor per module. The `app (ubuntu-latest)`, `app (macos-latest)`, `app-windows-smoke`, `build`, `lychee`, `check`, `dependency-review` names stay. New checks: the import rules (one job step in `checks-core` or the app job), the `content.json` consistency test, the `release.sh` app check.

## Decision

One repository, one npm package, one release workflow for 7.0. Boundaries inside `app/src` as folders (`core`, `agents`, `content`, `engine`, with `cli` and `server` as thin entries over `engine`) enforced by import rules, and a content contract that separates the content version from the app version. No new npm workspace, no new repository.

| Part | Verdict | Reason |
|---|---|---|
| Plugin directory as its own module | keep as is | Claude Code already refuses component paths outside it; moving it changes every user's marketplace |
| Several repositories | no | marketplace source moves for all users; most plugin changes also change the engine |
| npm workspaces with independent versions | not for 7.0 | the boundaries come from import rules; no consumer needs another engine version; one more trusted publisher binding per package |
| Import cycle `level`, `projects`, `doctor`, `allow` | break first | nothing can be extracted while it exists |
| Engine facade returning documents | yes | one function per CLI command and route; the CLI JSON documents and the route table follow from it |
| Agent adapters | yes, Claude Code and Codex code first | 118 of the 141 lines that name `'claude'` or `'codex'` sit in plan builders, settings, rules, accounts, sessions and advise |
| Content contract and state version 2 | yes, in 7.0 | removes the content release that an app-only release forces today; breaking for the state schema, so it belongs in 7.0 |
| Pins in skill text | keep literal, ignore pin-only diffs in the plugin check | skills must work with no CLI and no state file; keeps the `AGENTS.md` pin rule |

Order of the build (each one pull request; the follow-up list is in the pull request description): the cycle and the import rules first (no behavior change), then the facade with the read commands, the adapters, the content contract, state version 2 and the release workflow (the 7.0 breaking part), and the file moves last, so that open pull requests do not conflict with them.

What the spike did not check: any agent session (the plugin and marketplace statements come from documentation); whether Codex reads `content.json` or tolerates an unknown field in `.codex-plugin/plugin.json`; whether npm trusted publishing works for the first publish of a new package; npm's lockfile and `workspace:` behavior (the workspaces page is silent); the effect of the import rules on CI time beyond the 1.4 s measured in the code health note; whether the Codex portable root manifest makes `.codex-plugin/plugin.json` redundant (read from a summary of the page, not from the page itself).

[All evaluations](../../EVALUATIONS.md)
