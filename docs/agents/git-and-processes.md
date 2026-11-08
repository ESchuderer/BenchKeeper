# Git and child processes

Read this before changing code that runs git or another program. Each item names what goes wrong and the code that already avoids it; reuse that code instead of writing a new runner.

## Child processes

- **No shell.** Pass an argv to `spawn` or `execFile`, never a command string: through a shell, a branch name or a path becomes a command ([security model](../security.md#commands-and-argv)).
- **Windows console windows.** Every spawn that opens a console sets `windowsHide: true` (`run` in `packages/git/src/git.ts` and in `packages/adapter-claude/src/index.ts`). The adapter's watcher runs detached without a console.
- **Program lookup.** Spawn a program by its file, never by its bare name: Windows looks for a bare name in the child's working folder, often a project, before PATH. `programPath` in `packages/orchestration/src/program.ts` finds it in the absolute folders of PATH only.
- **Stopping a process tree.** Windows has no POSIX signals: `kill()` ends the program at once and leaves its children running. `stop` in `packages/adapter-claude/src/index.ts` ends the tree with `taskkill /T /F` from System32, and only while the child has not exited, since Windows may give its process ID to another process.
- **A child that ignores SIGTERM** keeps its caller waiting: a timeout kills with `SIGKILL` (`ghProbe` in `packages/orchestration/src/gh.ts`).
- **Orphaned processes.** A runner that died leaves its attempts' processes running, and their pids may go to other processes. `stopOrphans` in `packages/use-cases/src/orphans.ts` stops a process and its tree only when it started in the minute before the attempt's start was recorded; a later process that reuses the pid started after that. Limits: `ps` tells the start to the second, so a process that ended and whose pid was reused within the second of the record would be taken for it; a command whose shell has ended, while a child of it runs on, is not found; on Windows a runner's shell ends with the runner (Node's job object kills it on close), so there is nothing to stop, though the shell's own children may outlive it (hub issue 103).
- **Environment.** Pass the child only the variables it needs. Windows names ignore case (`PATH` is `Path` there); elsewhere `path` is another variable (`cleanEnv` in `packages/orchestration/src/env.ts`). On Windows a child also needs the system, profile and temp folders: without `SystemRoot` it can fail to load system components (https://docs.python.org/3/library/subprocess.html#popen-constructor).

## Git

- **The caller's `GIT_*` variables** point git at another repository (`GIT_DIR` is set when CedarLoom runs inside a hook) or add configuration: drop them, and turn off prompts so git fails instead of waiting (`environment` in `packages/git/src/git.ts`).
- **Configuration of the repository or the user** can run hooks, an fsmonitor, maintenance or any transport, and a server can offer bundles or stall a transfer. `-c` flags win over every configuration file; they also check every object and end a stalled transfer (`config` in `packages/git/src/git.ts`; the legacy app's clone, `cloneChange` in `app/src/origin.mjs`). Hooks defined as `hook.<name>` (git 2.54) run even when `core.hooksPath` points at the null device: each is turned off through `GIT_CONFIG_*` (`hooksOff` in `packages/git/src/git.ts`).
- **Text from git, a server or another program** shown in a terminal can move the cursor or rewrite a line: escape control and bidirectional characters first (`shown` in `packages/contracts/src/text.ts`).

## Files

- **Case and device names.** macOS and Windows file systems join names that differ only in case, and Windows opens a device for a name such as `con` or `nul`. Drafts are one lower-case file per workflow id behind a prefix (`pathOf` in `packages/use-cases/src/drafts.ts`).
- **Links and FIFOs.** An open follows a symbolic link and waits on a FIFO. Reads that must do neither open with `O_NOFOLLOW` and `O_NONBLOCK` (`READ` in `packages/use-cases/src/drafts.ts`, `readResult` in `packages/orchestration/src/result.ts`). Windows has neither flag, and making a link there takes admin rights or developer mode.
- **Flushing a folder** fails on Windows, which cannot open one; NTFS journals the rename instead (`flushFolder` in `packages/engine/src/files.ts`).

## Stopping Claude Code

`packages/adapter-claude/src/index.ts` (`TASKKILL`, `WATCHER`, `spawned`).
- **Cancel.** On SIGTERM the CLI stops the process tree of a running command and exits; a slow reader delays the exit by 30 s at most (https://code.claude.com/docs/en/headless#stop-a-run-with-sigterm). A CLI still running `killAfterMs` after SIGTERM gets SIGKILL with its process group. Its exit clears the timer, since a signal sent after it would reach any process that reuses its ID (https://nodejs.org/api/child_process.html#subprocesskillsignal).
- **Windows.** Windows has no POSIX signals: `kill()` ends the CLI at once and leaves its commands running (same page), so `taskkill` ends the whole tree there, also at once and without the CLI's SessionEnd hooks. It runs from System32, not from PATH.
- **Process group.** On POSIX the CLI runs in a process group of its own, so a kill reaches the commands it started there. Its Bash tool commands lead groups of their own (Claude Code 2.1.316), which the CLI's SIGTERM stops. A group with members keeps its ID from reuse (https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap04.html, 4.17).
- **Watcher.** A watcher holds a pipe from the host. When the pipe closes before the host says the CLI exited (the host died, also by SIGKILL or with its terminal), it stops the CLI as a cancel does: SIGTERM, then SIGKILL to the CLI's group while it is still there after the grace. On Windows the CLI runs outside the host's job object, which would end the CLI with the host but leave the commands that broke away from it running (hub issue 142); the watcher ends the CLI's whole tree with taskkill instead. A CLI the host cannot watch (no watcher started: EAGAIN, EMFILE, ENFILE) is stopped at once.
- **Output.** A reader that leaves early (a session without the settings proof, a throw) must not close stdout: the CLI would die of EPIPE on its next line, before a cancel reaches it, and leave its commands running. Its output is drained instead (`readable.iterator`, stable since Node.js 24: https://nodejs.org/api/stream.html#readableiteratoroptions).

CedarLoom's Windows-only branches run only in the Windows leg of its test job (`.github/workflows/cedarloom.yml`). The legacy app runs on Windows only in the `app-windows-smoke` job (start, plan, apply).
