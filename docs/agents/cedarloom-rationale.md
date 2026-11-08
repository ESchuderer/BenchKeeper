# CedarLoom: why the code does what it does

The reasons behind CedarLoom code whose why takes more than one line. Each section is linked from a one-line comment in the code. Platform and process reasons live in [git and child processes](git-and-processes.md).

## Drafts

`packages/use-cases/src/drafts.ts`

Drafts are the working copies of the workflows the editor has open, in the canonical file form beside the run store. Only a workflow id gets a path: the routes take workflow ids only, and no other caller gets a path outside the folder either. The id's pattern is checked before lower-casing, which maps the Kelvin sign to `k`. The `startsWith(folder + sep)` check is the form CodeQL recognizes as a path guard. The file system's part (case, device names, links, FIFOs) is in [git and child processes](git-and-processes.md#files).

## Update wait

`packages/use-cases/src/extensions.ts` (`UPDATE_WAIT_MS`)

An update is offered once this machine has seen its commit for 3 days (A94). A commit's own date is whatever its author wrote, so the clock starts when CedarLoom first fetched it here. An add never waits: it is a new choice with full consent, so a remove and an add install the newest commit at once.

Limit: only the ref's newest commit is fetched, so a ref that moves more often than every 3 days never offers an update; follow a tag or a release branch (`--ref`) there. The upgrade is to remember each commit seen and offer the newest one that has waited, fetched by its SHA where the server allows that.

## Contracts

`packages/contracts/src/`

### Publishers

`extension.ts` (`RESERVED`). No extension takes a publisher that is the first part of a built-in node type (trigger, agent, command, file, human, workflow, condition, join), so `trigger.acme/go` never counts as a trigger. `cedarloom` is first-party: the app ships its extensions, and a Git install refuses that publisher, since trust comes from where the files are.

### Credential schemes

`extension.ts` (`CredentialScheme`). How the host adds a credential to a request, after the OpenAPI Security Scheme Object (https://spec.openapis.org/oas/v3.1.0#security-scheme-object), headers only: `Authorization: Bearer <value>`, `Authorization: Basic <user:value>` with the user part the user enters, or a header of its own. The scheme comes from the manifest, never from the request, so an extension cannot place the value where a host would store and return it.

### Names

`extension.ts` (`portable`). A name of the POSIX portable file name characters, not starting with `-`, up to 255 of them; no `.git` in any case, and nothing Windows would rename or open as a device (a trailing dot, which also refuses `.` and `..`; `CON`, `NUL`, `COM0`).

### Git URLs

`extension.ts`. The URL forms Git fetches over https and ssh, without a password and without a character a shell, a terminal or a credential helper reads specially (control characters, spaces, non-ASCII). A user or host never starts with `-`, which ssh would read as an option. `urlAllowed` in `packages/git/src/git.ts` checks the rule again before git runs, also percent-encoded (a carriage return reaches a credential helper as a new line), with no user over https, no backslash and no query; a transport the caller adds (the tests' file and ext) is git's own allowlist's to refuse.

### Sealed files

`profile.ts` (`SEALED`). Files only their own parts write, at any depth: Claude Code's settings, where a settings part's allowed settings apply, and MCP server lists; a `files` part's text would bring hooks or servers past them. Targets are portable paths, so `./`, `//` and trailing dots cannot spell them another way, and none has a `.git` part. The manual's own files at the project's root are its blocks' alone, so a target never writes them twice in one plan.

### Reserved config

`profile.ts` (`RESERVED`). Config folders under `.config/` that a plugin's options never write: CedarLoom's own, Claude Code's by its XDG name (a `CLAUDE_CONFIG_DIR` there; any other folder that variable names is refused when the file is written), and the user's credential stores.

### Tokens

`profile.ts` (`TOKEN`). Token shapes by their documented prefixes and lengths (GitHub, npm, Anthropic and OpenAI, GitLab, Slack, AWS, Google), private keys in PEM form, URLs with a password, and environment names with a credential word. A profile is shared, so none of them may sit in it.

### Unsafe text

`text.ts` (`UNSAFE`). Characters a manifest text or its translation may not hold: control characters, with which a text could move a terminal's cursor or rewrite a line, and the bidirectional controls that reorder what a reader sees (Trojan Source, CVE-2021-42574): U+061C, U+200E and U+200F, U+202A to U+202E, U+2066 to U+2069.

### Settings

`profile.ts` (`Rule` and the settings rules). The settings a profile may set (owner, 2026-11-07, hub issue 126): the default profile's keys, the model, deny and ask rules, sandbox keys that only tighten it, and named environment variables of the kinds Claude Code applies at startup (feature toggles, limits and timeouts; https://code.claude.com/docs/en/settings-reference). Anything else, a hook, a status line, a plugin, a login or a base URL among them, is refused. `true` allows any value there.

### Profile merge

`compose.ts` (`composeProfile`). The merge follows Renovate's presets, with three rules that differ on purpose:
- A parent reached twice applies once, at its first place. Renovate merges it again on each path, so the second application would take back the first branch's changes.
- A cycle is refused. Renovate skips it.
- Every list grows without duplicates. Renovate concatenates only its mergeable options, keeps duplicates and replaces other arrays.

## Profiles

`packages/profiles/src/`

### Project links

`project.ts`. A profile names its targets by portable paths, which cannot point outside the project, into its Git folder or onto a sealed file (Claude Code's settings, an MCP list, the manual's files). A link can, so the plan resolves each path on disk and is refused when a link leads a target, a `.claude` path or the files record there. Otherwise a skill's file could land in a user's Claude Code home, in Git's hooks or in the committed settings, and the record would be read and written outside the project.

### Gates

`project.ts`. A gates part writes, per bound workflow, a caller of the reusable workflow of that name at the bound commit, with read access only, on each pull request and merge queue entry, which every change to the default branch passes whatever its name (https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows). Dependabot updates the workflows' pins once a release is the cooldown's days old (https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference#cooldown-). The bound gates repository is ignored there, so the binding stays the gates' one source and they move only by a new binding.

### Settings writes

`project.ts` (`settingsWrites`). Settings parts merge into the committed `.claude/settings.json` or the local `.claude/settings.local.json` by their `commit` field. Plugin parts that `approved` names go into the local file, the only one Claude Code downloads a plugin from. Every other plugin part that would change it waits for its approval by name and is held back with the parts that require it. Git ignores the local file while a part that writes it is on, also once its plugins are in place.

### Manual

`project.ts` (`manualWrites`). The manual's writes are its two blocks and the CLAUDE.md to make. An owner's CLAUDE.md that does not import AGENTS.md is reported when no local block does, as Claude Code reads AGENTS.md by itself only without a CLAUDE.md (https://code.claude.com/docs/en/memory#agents-md).

### Skills as plugins

`skills.ts` (`skillFiles`). Claude Code loads a skills folder with `.claude-plugin/` as a plugin, hooks and servers included, which a plugin part brings only with its approval by name (https://code.claude.com/docs/en/plugins/loading). The folder counts in any case, as macOS's and Windows' file systems read `.Claude-Plugin` as `.claude-plugin`.

## Ledger

`packages/ledger/src/`

### SQLite

`store.ts`.
- **`secure_delete` only around blanking.** It zeroes what an update leaves behind, such as a blanked plan's content, which SQLite otherwise keeps on freed pages (https://www.sqlite.org/pragma.html#pragma_secure_delete). On every write it kept another process's appends out longer, so it is on only there.
- **The log is emptied as the store closes.** The checkpoint moves the log into the database and empties it, so the pages from before a blanking leave the log too; a checkpoint at each finish kept another process's appends out. It waits for nothing: while another connection reads the store, it stops short without an error, and the log keeps those pages until that connection closes (https://www.sqlite.org/pragma.html#pragma_wal_checkpoint).
- **The 1 s busy wait (`SETTLE_MS`).** A writer's last close cleans up the WAL, and the next open recovers it. Without the wait, reads and opens beside another process's runs fail with "database is locked". It matches the store lock's own wait: 250 ms was too short on a loaded CI runner, where runs in a tight loop kept a reader out longer. The lock file's probe does not wait.

## Engine

`packages/engine/src/`

### Write step

`files.ts` (`writeStep`). A run step's write goes to a flushed temporary file. An existing target is first moved aside and checked there, then the new file is linked in. A change another process makes by path after the move lands in a new file at the path, which the step then finds, so such a change is refused, never overwritten. Only a write through a handle opened before the check, made after it, is lost. Between the two moves the path is absent for a moment; a crash there leaves the old file aside, and `recover()` puts it back.

## Server

`packages/server/src/`

### Workflow JSON

`app.ts` (`WorkflowJsonInput`). The request schema of a workflow document, as a request carries it.
- Fastify's JSON parser refuses a `__proto__` key and a `constructor` object with a `prototype` key at any depth (400 `FST_ERR_CTP_INVALID_JSON_BODY`). The schema says so, so clients and Schemathesis send only JSON that reaches the route.
- It describes the document only: a recursive zod schema would overflow the stack on deeply nested values, which `readDocument` refuses with a finding.
- Its first branch has no `type: "array"`, so the generated client type stays `unknown` instead of one TypeScript refuses as circular.

## Orchestration

`packages/orchestration/src/`

### Managed settings

`managed.ts`. Reads the managed settings files as Claude Code does and finds whatever loosens the sandbox (https://code.claude.com/docs/en/settings-reference).
- **Merge order.** `managed-settings.json`, then `managed-settings.d/*.json` by name, hidden files left out (https://code.claude.com/docs/en/managed-settings#split-a-file-based-policy-across-teams).
- **Invalid values.** A quoted `"true"` or `"false"` counts as that Boolean, as Claude Code reads it; any other invalid value keeps the sandbox strict (https://code.claude.com/docs/en/managed-settings#invalid-values-inside-sandbox).
- **Proxies.** A proxy port of the policy's own takes over filtering: Claude Code stops applying its domain lists to it (`#sandbox-network-httpproxyport` and `#sandbox-network-socksproxyport` in the settings reference).
- **What loosens whatever follows.** List entries, hosts beyond GitHub, and a policy helper, whose output replaces the files read (https://code.claude.com/docs/en/settings-reference#policyhelper).
- **Sources.** `policyProblems` and `cachedPolicyProblems` read every place Claude Code 2.1.316 reads a policy from, and `cedarloom doctor` warns when one switches hooks (`disableAllHooks`, `allowManagedHooksOnly`) or the sandbox (`sandbox.enabled`, `sandbox.filesystem.disabled`) off for the user's own sessions, or cannot be read:
  - the configuration profile's plists, per user (`/Library/Managed Preferences/<user>/com.anthropic.claudecode.plist`) and the device's, converted by `/usr/bin/plutil -convert json`;
  - the `Settings` value under `HKLM` and `HKCU\SOFTWARE\Policies\ClaudeCode` through `reg.exe`, and under WSL the Windows ones (`/mnt/c/Windows/System32/reg.exe`, `/mnt/c/Program Files/ClaudeCode`);
  - the server-managed cache, `remote-settings.json` in the Claude Code home (`CLAUDE_CONFIG_DIR`, else `~/.claude`).

  Paths and programs are Claude Code's own (strings of its 2.1.316 binary), and the ranking follows https://code.claude.com/docs/en/managed-settings#how-claude-code-combines-managed-sources.
- **Each source on its own.** By default Claude Code applies only the highest-ranked source that holds a policy key (`first-wins`). With `managedSourcesBehavior: "merge"`, a higher source's value wins on most keys, lists union and locks take the strictest value (https://code.claude.com/docs/en/managed-settings#compose-every-managed-source). A policy helper's output replaces every managed source, so the doctor reports one as a policy it cannot read. The check still counts a value in any source, so the doctor warns rather than stays silent on a policy it read wrong. The cost is a warning when a stricter source outranks the loosening one.
- **The server-managed cache.** The cache is the settings object itself. Claude Code treats a copy it cannot read, or does not trust, as absent, so such a copy counts as none here too. A session's startup fetch can bring a newer policy than the cache holds.

## Hub tracker

`packages/adapter-github/src/`

### Rate limits

`index.ts` (`limited`). A rate limit is a 429, or a 403 with `x-ratelimit-remaining` 0, a `retry-after` header or, for a secondary limit, only its message (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#exceeding-the-rate-limit).
