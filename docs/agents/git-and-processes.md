# Git and child processes

Read this before changing code that runs git or another program. Each item names what goes wrong and the code that already avoids it; reuse that code instead of writing a new runner.

## Child processes

- **No shell.** Pass an argv to `spawn` or `execFile`, never a command string: through a shell, a branch name or a path becomes a command ([security model](../security.md#commands-and-argv)).
- **Windows console windows.** Every spawn sets `windowsHide: true` (`packages/git/src/git.ts:109`, `packages/adapter-claude/src/index.ts:57`).
- **Stopping a process tree.** Windows has no POSIX signals: `kill()` ends the program at once and leaves its children running. `stop` in `packages/adapter-claude/src/index.ts:34` ends the tree with `taskkill /T /F` from System32, and only while the child has not exited, since Windows may give its process ID to another process.
- **A child that ignores SIGTERM** keeps its caller waiting: a timeout kills with `SIGKILL` (`packages/orchestration/src/gh.ts:30`).
- **Environment.** Pass the child only the variables it needs. Windows names ignore case (`PATH` is `Path` there); elsewhere `path` is another variable (`packages/orchestration/src/env.ts:43`).

## Git

- **The caller's `GIT_*` variables** point git at another repository (`GIT_DIR` is set when CedarLoom runs inside a hook) or add configuration: drop them, and turn off prompts so git fails instead of waiting (`environment` in `packages/git/src/git.ts:82`).
- **Configuration of the repository or the user** can run hooks, an fsmonitor, maintenance or any transport. `-c` flags win over every configuration file (`config` in `packages/git/src/git.ts:40`; the legacy app's clone in `app/src/origin.mjs:83`). Hooks defined as `hook.<name>` (git 2.54) run whatever `core.hooksPath` says: each is turned off through `GIT_CONFIG_*` (`hooksOff`, `packages/git/src/git.ts:71`).
- **Text from git or a server** shown in a terminal can move the cursor or rewrite a line: escape control characters first (`shown`, `packages/git/src/git.ts:24`).

## Files

- **Flushing a folder** fails on Windows, which cannot open one; NTFS journals the rename instead (`packages/engine/src/files.ts:63`).

CedarLoom's Windows-only branches run only in the Windows leg of its test job (`.github/workflows/cedarloom.yml`). The legacy app runs on Windows only in the `app-windows-smoke` job (start, plan, apply).
