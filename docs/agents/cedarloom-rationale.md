# CedarLoom: why the code does what it does

The reasons behind CedarLoom code whose why takes more than one line. Each section is linked from a one-line comment in the code. Platform and process reasons live in [git and child processes](git-and-processes.md).

## Drafts

`packages/use-cases/src/drafts.ts`

- **One lower-case file per workflow id, with a prefix.** Drafts are the working copies of the workflows the editor has open, in the canonical file form beside the run store. A case-insensitive file system (macOS, Windows) would join ids that differ only in case anyway. The prefix keeps a Windows device name (`con`, `nul`) from being a file's name.
- **Only a workflow id gets a path.** The routes take workflow ids only, and no other caller gets a path outside the folder either. The id's pattern is checked before lower-casing, which maps the Kelvin sign to `k`. The `startsWith(folder + sep)` check is the form CodeQL recognizes as a path guard.
- **No link and no wait on a FIFO.** The open uses `O_NOFOLLOW` and `O_NONBLOCK`. Windows has no `O_NOFOLLOW`; making a link there takes admin rights or developer mode.

## Update wait

`packages/use-cases/src/extensions.ts` (`UPDATE_WAIT_MS`)

An update is offered once this machine has seen its commit for 3 days (A94). A commit's own date is whatever its author wrote, so the clock starts when CedarLoom first fetched it here. An add never waits: it is a new choice with full consent, so a remove and an add install the newest commit at once.

Limit: only the ref's newest commit is fetched, so a ref that moves more often than every 3 days never offers an update; follow a tag or a release branch (`--ref`) there. The upgrade is to remember each commit seen and offer the newest one that has waited, fetched by its SHA where the server allows that.

## Orphans

`packages/use-cases/src/orphans.ts` (`stopOrphans`)

For each attempt still marked running, the process and its tree are stopped when the process started in the minute before the attempt's start was recorded. A later process that reuses the pid started after that and is left alone.

Limits:
- `ps` tells the start to the second, so a process that ended and whose pid was reused within the second of the record would be taken for it.
- A command whose shell has ended, while a child of it runs on, is not found this way.
- On Windows a runner's shell ends with the runner (Node's job object kills it on close), so there is nothing to stop; the shell's own children may outlive it (hub issue 103).

## Contracts

`packages/contracts/src/`

### Publishers

`extension.ts` (`RESERVED`). No extension takes a publisher that is the first part of a built-in node type (trigger, agent, command, file, human, workflow, condition, join), so `trigger.acme/go` never counts as a trigger. `cedarloom` is first-party: the app ships its extensions, and a Git install refuses that publisher, since trust comes from where the files are.

### Credential schemes

`extension.ts` (`CredentialScheme`). How the host adds a credential to a request, after the OpenAPI Security Scheme Object (https://spec.openapis.org/oas/v3.1.0#security-scheme-object), headers only: `Authorization: Bearer <value>`, `Authorization: Basic <user:value>` with the user part the user enters, or a header of its own. The scheme comes from the manifest, never from the request, so an extension cannot place the value where a host would store and return it.

### Names

`extension.ts` (`portable`). A name of the POSIX portable file name characters, not starting with `-`, up to 255 of them; no `.git` in any case, and nothing Windows would rename or open as a device (a trailing dot, which also refuses `.` and `..`; `CON`, `NUL`, `COM0`).

### Git URLs

`extension.ts`. The URL forms Git fetches over https and ssh, without a password and without a character a shell, a terminal or a credential helper reads specially (control characters, spaces, non-ASCII). A user or host never starts with `-`, which ssh would read as an option.

### Sealed files

`profile.ts` (`SEALED`). Files only their own parts write, at any depth: Claude Code's settings, where a settings part's allowed settings apply, and MCP server lists; a `files` part's text would bring hooks or servers past them. Targets are portable paths, so `./`, `//` and trailing dots cannot spell them another way, and none has a `.git` part. The manual's own files at the project's root are its blocks' alone, so a target never writes them twice in one plan.

### Reserved config

`profile.ts` (`RESERVED`). Config folders under `.config/` that a plugin's options never write: CedarLoom's own, Claude Code's by its XDG name (a `CLAUDE_CONFIG_DIR` there; any other folder that variable names is refused when the file is written), and the credential stores the worker launcher denies (`packages/orchestration/src/env.ts`).

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
