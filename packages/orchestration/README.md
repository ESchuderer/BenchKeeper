# @cedarloom/orchestration

Launches CedarLoom's workers: their clean environment, the paths and hosts they may not reach, the checks that refuse a launch, and the guard hook that reads every shell command a worker's Claude Code session runs.

## The guard hook

`@cedarloom/orchestration/guard-hook` is a Claude Code `PreToolUse` command hook for the Bash and Monitor tools. It takes its policy as JSON in its argument, reads the call from stdin, and refuses with exit code 2 and the reason on stderr. It stops agent mistakes, not a determined hostile agent: for a worker, the narrow token is the hard limit (A13).

It reads a command by structure and refuses every form outside this grammar (A79): simple commands with their assignments, redirections and wrappers (`env`, `command`, `builtin`, `exec`, `nohup`, `time`, `nice`, `timeout`, `stdbuf`, `setsid`, `ionice`, `caffeinate`, `xargs`, each with the options it knows); pipelines and lists; quotes, parameter expansions, `$(...)` and arithmetic that holds no command; heredocs and here-strings, an unquoted heredoc's `$(...)` read too; and `if`, `for`, `while` and `until`, every condition and body command read.

It also refuses when it cannot read the call at all: input that is no JSON, a missing or invalid policy, a call without its command or folder, a crash or a timeout (the launch sets `onFailure: "block"`).

### In a worker session

The launch gives every worker the hook through `--settings`: a `PreToolUse` hook on `Bash|Monitor|PowerShell` in exec form (this Node.js, the hook's file, the policy's JSON), `timeout` 10 and `onFailure: "block"`. The policy holds the GitHub repositories of the project's remotes and the hub this machine binds. What keeps the worker from switching the hook off:

| Way round                                                                                           | What stops it                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disableAllHooks` in a settings file, also one written mid-session                                  | the launch reads no settings file (`--setting-sources ""`), and its `--settings` say `"disableAllHooks": false`, which outranks local, project and user settings ([settings precedence](https://code.claude.com/docs/en/settings#settings-precedence)); the sandbox and `blockWritesOutsideWorkingDirectories` refuse writes to `.claude` settings files |
| `disableAllHooks`, `allowManagedHooksOnly` or `allowManagedPermissionRulesOnly` in managed settings | the launch refuses to start (`launch.sandbox-overridden`)                                                                                                                                                                                                                                                                                                |
| rewriting the hook or the contracts it reads its policy with                                        | both packages' folders are closed to the file tools (`Edit` deny) and to commands (`sandbox.filesystem.denyWrite`), and lie outside the working folders                                                                                                                                                                                                  |
| a crash, a timeout or invalid output of the hook                                                    | `onFailure: "block"` refuses the call                                                                                                                                                                                                                                                                                                                    |
| `--bare` or `CLAUDE_CODE_SIMPLE`, which skip `--settings` hooks                                     | the launch never passes `--bare`, and the worker's environment is an allowlist                                                                                                                                                                                                                                                                           |
| PowerShell                                                                                          | `CLAUDE_CODE_USE_POWERSHELL_TOOL=0`, and the hook refuses PowerShell calls; on Windows the worker's shell is Git Bash (`CLAUDE_CODE_GIT_BASH_PATH` where it is not found)                                                                                                                                                                                |

Not covered: MDM profiles, the Windows registry and server-managed settings, which the launch does not read; native Windows, where Claude Code has no sandbox for commands.

### Everyday forms it refuses

| Form                                                                                                                                                                              | Instead                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| a subshell `(cd x && make)`, a group `{ a; b; } > f`                                                                                                                              | `cd x && make`, `git -C x`, `make -C x`; one redirection per command |
| a function, `case`, `select`, `coproc`, `for x do` without `in`                                                                                                                   | `if` and `elif`                                                      |
| `[[ $x =~ (a\|b) ]]`, any `(` right after a word                                                                                                                                  | `grep -E`                                                            |
| a process substitution, `diff <(sort a) <(sort b)`                                                                                                                                | temporary files                                                      |
| backquotes, also inside double quotes and unquoted heredocs; an unquoted heredoc line ending in `\`                                                                               | `$(...)`; a quoted heredoc (`<<'EOF'`) for text with backquotes      |
| `$(( $(cmd) + 1 ))`                                                                                                                                                               | `n=$(cmd)` first                                                     |
| `bash -c`, `sh -c`, a shell reading a pipe, heredoc or here-string, `source /dev/stdin`, `eval`, `trap`, `alias`, `hash`, `watch`, `emulate`, `compgen`, `complete`, `mapfile -C` | the command itself, or a script file                                 |
| `find -exec`, `-execdir`, `-ok`, `-okdir`                                                                                                                                         | `find ... -print0 \| xargs -0 <program>`                             |
| `xargs` in front of gh, git, curl, a shell or a wrapper                                                                                                                           | a `for` or `while read` loop                                         |
| a wrapper option it does not know (`env -S`, `env -P`, `nice -10`, an abbreviated long option)                                                                                    | the options it lists, spelled out                                    |
| a command named by a variable or a glob (`$PYTHON x.py`)                                                                                                                          | the program's name                                                   |
| `printf -v`, `read -a`, `let`, `declare -i`; `export`, `read` or `env -u` of a name it cannot read (`export $(cat .env \| xargs)`)                                                | names written out                                                    |
| zsh's `=cmd`, `noglob`, `nocorrect`, `-`, glob qualifiers, `=(...)`, `${(...)...}`, short `if [[ ... ]] cmd`                                                                      | the bash forms                                                       |
| the PowerShell tool                                                                                                                                                               | the Bash tool; on Windows the launch requires Git Bash               |

### Known limits

- Data run as code when it expands: a variable's value used in arithmetic or as a subscript (`x='y[$(cmd)]'; echo $((x))`), `${x@P}`, `PS4` with `set -x`. A subscript written out with a command in it refuses, as does arithmetic in `[[ ]]` on anything but a number or a plain `$name`, and `$'...'` with a numeric escape.
- Script files and interpreters (`bash x.sh`, `npm run x`, `make`, `python3 -c`, `node -e`), and programs that run their arguments which the guard does not list (`flock`, `parallel`, `script -c`, `ssh`).
- File writes: `.git/config` and git hooks, a shell's startup files, Claude Code's settings files.
- A word whose value the shell knows only when it runs, such as `find . "$a"` with `a=-exec`; zsh beyond the forms above.
