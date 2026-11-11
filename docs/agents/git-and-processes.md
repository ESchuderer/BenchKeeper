# Git and child processes

Read this before changing code that runs git or another program. Each item names what goes wrong and the code that already avoids it; reuse that code instead of writing a new runner.

## Child processes

- **No shell.** Pass an argv to `spawn` or `execFile`, never a command string: through a shell, a branch name or a path becomes a command ([security model](../security.md#commands-and-argv)).
- **Windows console windows.** Every spawn that opens a console sets `windowsHide: true` (`run` in `packages/git/src/git.ts`).
- **Program lookup.** Spawn a program by its file, never by its bare name: Windows looks for a bare name in the child's working folder, often a project, before PATH. `programPath` in `packages/orchestration/src/program.ts` finds it in the absolute folders of PATH only.
- **Stopping a process tree.** Windows has no POSIX signals: `kill()` ends the program at once and leaves its children running. `stopTree` in `packages/extension-host/src/tree.ts` ends the tree with `taskkill /T /F` from System32, and only while the child has not exited, since Windows may give its process ID to another process.
- **A child that ignores SIGTERM** keeps its caller waiting: a timeout kills with `SIGKILL` (`packages/use-cases/src/devcontainer.ts`).
- **Environment.** Pass the child only the variables it needs. Windows names ignore case (`PATH` is `Path` there); elsewhere `path` is another variable (`cleanEnv` in `packages/orchestration/src/env.ts`). On Windows a child also needs the system, profile and temp folders: without `SystemRoot` it can fail to load system components (https://docs.python.org/3/library/subprocess.html#popen-constructor).

## Git

- **The caller's `GIT_*` variables** point git at another repository (`GIT_DIR` is set when CedarLoom runs inside a hook) or add configuration: drop them, and turn off prompts so git fails instead of waiting (`environment` in `packages/git/src/git.ts`).
- **Configuration of the repository or the user** can run hooks, an fsmonitor, maintenance or any transport, and a server can offer bundles or stall a transfer. `-c` flags win over every configuration file; they also check every object and end a stalled transfer (`config` in `packages/git/src/git.ts`; the legacy app's clone, `cloneChange` in `app/src/origin.mjs`). Hooks defined as `hook.<name>` (git 2.54) run even when `core.hooksPath` points at the null device: each is turned off through `GIT_CONFIG_*` (`hooksOff` in `packages/git/src/git.ts`).
- **Text from git, a server or another program** shown in a terminal can move the cursor or rewrite a line: escape control and bidirectional characters first (`shown` in `packages/contracts/src/text.ts`).

## Files

- **Case and device names.** macOS and Windows file systems join names that differ only in case, and Windows opens a device for a name such as `con` or `nul`. Drafts are one lower-case file per workflow id behind a prefix (`pathOf` in `packages/use-cases/src/drafts.ts`).
- **Links and FIFOs.** An open follows a symbolic link and waits on a FIFO. Reads that must do neither open with `O_NOFOLLOW` and `O_NONBLOCK` (`readRegular` in `packages/engine/src/files.ts`). Windows has neither flag, and making a link there takes admin rights or developer mode.
- **Flushing a folder** fails on Windows, which cannot open one; NTFS journals the rename instead (`flushFolder` in `packages/engine/src/files.ts`).

CedarLoom's Windows-only branches run only in the Windows leg of its test job (`.github/workflows/cedarloom.yml`). The legacy app runs on Windows only in the `app-windows-smoke` job (start, plan, apply).
