# @cedarloom/orchestration

Launches CedarLoom's workers: their clean environment, the paths and hosts they may not reach, the checks that refuse a launch, and the guard hook that reads every shell command a worker's Claude Code session runs.

## The guard hook

`@cedarloom/orchestration/guard-hook` is a Claude Code `PreToolUse` command hook for the Bash and Monitor tools. It takes its policy as JSON in its argument, reads the call from stdin, and refuses with exit code 2 and the reason on stderr. It stops agent mistakes, not a determined hostile agent: for a worker, the narrow token is the hard limit (A13).

It reads a command by structure and refuses every form outside this grammar (A79):

- simple commands with their assignments, redirections and wrappers (`env`, `command`, `exec`, `nohup`, `time`, `nice`, `timeout`, `stdbuf`, `setsid`, `ionice`, `caffeinate`, `xargs`, each with the options it knows)
- pipelines and lists (`|`, `&&`, `||`, `;`, `&`, newlines)
- quotes, parameter expansions, `$(...)` and arithmetic that holds no command
- heredocs and here-strings; an unquoted heredoc's `$(...)` is read too
- `if`, `for`, `while` and `until`, every condition and body command read

It also refuses when it cannot read the call at all: input that is no JSON, a missing or invalid policy, a call without its command or folder, a crash or a timeout (the launch sets `onFailure: "block"`).

### Everyday forms it refuses

| Form                                                                                                                      | Instead                                                              |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| a subshell `(cd x && make)`, a group `{ a; b; } > f`                                                                      | `cd x && make`, `git -C x`, `make -C x`; one redirection per command |
| a function, `case`, `select`, `coproc`                                                                                    | `if` and `elif`                                                      |
| `[[ $x =~ (a\|b) ]]`, any `(` right after a word                                                                          | `grep -E`                                                            |
| a process substitution, `diff <(sort a) <(sort b)`                                                                        | temporary files                                                      |
| backquotes, also inside double quotes and unquoted heredocs                                                               | `$(...)`; a quoted heredoc (`<<'EOF'`) for text with backquotes      |
| `$(( $(cmd) + 1 ))`                                                                                                       | `n=$(cmd)` first                                                     |
| `bash -c`, `sh -c`, a shell reading a pipe, heredoc or here-string, `source /dev/stdin`, `eval`, `trap`, `alias`, `watch` | the command itself, or a script file                                 |
| `find -exec`, `-execdir`, `-ok`, `-okdir`                                                                                 | `find ... -print0 \| xargs -0 <program>`                             |
| `xargs` in front of gh, git, curl, a shell or a wrapper                                                                   | a `for` or `while read` loop                                         |
| a wrapper option it does not know (`env -S`, `env -P`, `nice -10`, an abbreviated long option)                            | the options it lists, spelled out                                    |
| a command named by a variable or a glob (`$PYTHON x.py`)                                                                  | the program's name                                                   |
| `export`, `read`, `printf -v` or `env -u` of a name it cannot read (`export $(cat .env \| xargs)`)                        | names written out                                                    |
| zsh's `=cmd`, `noglob`, `nocorrect`, `-`, glob qualifiers, `=(...)`, `${(...)...}`                                        | the bash forms                                                       |
| the PowerShell tool                                                                                                       | the Bash tool; on Windows the launch requires Git Bash               |

### Known limits

- Data run as code when it expands: bash arithmetic on a variable (`x='y[$(cmd)]'; echo $((x))`), `${x@P}`, `PS4` with `set -x`.
- Script files and interpreters (`bash x.sh`, `npm run x`, `make`, `python3 -c`, `node -e`), and programs that run their arguments which the guard does not list (`flock`, `parallel`, `script -c`, `ssh`).
- File writes: `.git/config` and git hooks, a shell's startup files, Claude Code's settings files.
- A word whose value the shell knows only when it runs, such as `find . "$a"` with `a=-exec`.
- zsh beyond the forms above.
