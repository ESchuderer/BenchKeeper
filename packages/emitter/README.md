# @cedarloom/emitter

Builds a CedarLoom workflow, at the automation level chosen at install, into one plugin folder: Claude Code runs it stage by stage through workflow scripts, and Codex follows it through one skill per stage. Nothing here runs a workflow; the agent tools do.

| Path                                                  | For         | What it is                                                                                                              |
| ----------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `steps/<step>/`                                       | both        | One Agent Skills folder per step: an agent step's task, a command step's `scripts/run.sh`; user-only in both tools      |
| `claude/<stage>/SKILL.md`, `workflows/run-<stage>.js` | Claude Code | The skill only the user runs, and the workflow script that runs the stage's steps (the stage runner in `src/runner.ts`) |
| `agents/<step>.md`                                    | Claude Code | A subagent for a fresh step or one that names its tools                                                                 |
| `codex/<stage>/SKILL.md`                              | Codex       | The stage's steps in prose, in order                                                                                    |
| `scripts/precheck.sh`                                 | both        | The workflow's precheck, which the start skills run                                                                     |

## Where Codex loses a guarantee

Codex runs the same steps through skills only (no Codex hooks, agents or rules in 0.1.0), so a Codex run is weaker than a Claude Code run:

- Order, skips, retries, the failure policy and a check's rounds are prose the model follows, not code that runs.
- A gate the level keeps is one sentence. Only the user's sandbox and approval settings stand between the model and an action past it, such as a merge.
- Task text, input defaults and approval messages share the skill with its control flow, so a task can steer the stage; the import review, which shows all three, is the safeguard left.
- A fresh step runs in a sub-agent Codex starts with no earlier turns (`spawn_agent`, `fork_turns` none) and every tool the session has.
- A step's `model` and `effort` are not applied.
- A command's exit code is reported by the model and not checked: the guard and the exit-code hook are Claude Code hooks.
- A missing input stops the stage with a question, where Claude Code's runner refuses to start.
