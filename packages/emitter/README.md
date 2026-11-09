# @cedarloom/emitter

Builds a CedarLoom workflow, at the automation level chosen at install, into one plugin folder: Claude Code runs it stage by stage through workflow scripts, and Codex follows it through one skill per stage. Nothing here runs a workflow; the agent tools do.

| Path                                                                  | For               | What it is                                                                                                              |
| --------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`             | each tool its own | The manifest: the step skills and that tool's stage skills                                                              |
| `steps/<step>/`                                                       | both              | One Agent Skills folder per step: an agent step's task, a command step's `scripts/run.sh`; user-only in both tools      |
| `hooks/claude-code.json`, `hooks/guard.mjs`, `hooks/exits.mjs`        | Claude Code       | The guard and the exit hook (below), run by the Node.js whose absolute path `buildPackage` is given                     |
| `claude/<stage>/SKILL.md`, `workflows/run-<stage>.js`                 | Claude Code       | The skill only the user runs, and the workflow script that runs the stage's steps (the stage runner in `src/runner.ts`) |
| `agents/<step>.md`                                                    | Claude Code       | A subagent for a fresh step or one that names its tools                                                                 |
| `codex/<stage>/SKILL.md`                                              | Codex             | The stage's steps in prose, in order                                                                                    |
| `steps/<step>/agents/openai.yaml`, `codex/<stage>/agents/openai.yaml` | Codex             | The policy file that keeps a skill off the model's list: only the user starts it                                        |
| `scripts/precheck.sh`                                                 | both              | The workflow's precheck, which the start skills run                                                                     |

## Install

`cedarloom workflows install <id>` shows the plan for a stored workflow; with `--allow <plugin> --yes` it installs the package as one run, which `cedarloom runs undo` takes back. The approval names the plugin because its hooks run in every Claude Code session, and the plan lists every command the package runs.

- **The package** goes into `workflow-packages/<plugin>/` in CedarLoom's state folder: a directory marketplace, `cedarloom-workflows`, from which Claude Code loads it in place.
- **The user's Claude Code settings** get:
  - the marketplace and the plugin switched on;
  - allow rules for the first stage, the precheck and each step's script, the commands the approval listed, as a workflow's agent cannot ask;
  - an ask rule for each later stage. Claude Code asks before such a stage in an interactive session, in auto mode too, and refuses it in `claude -p` (2.1.316).
- **The level** is `--level`, else the default level (`cedarloom level`). Installing again at another level rebuilds the package; a project's own level does not reach it, as one package serves every project.
- **Node.js** for the hooks: the PATH's `node` where it links to the running one, which stays put over an upgrade, else the running one.
- **Codex** loads the same folder from its own copy: `codex plugin marketplace add <folder>` once, then `codex plugin add <plugin>@cedarloom-workflows` after every install.

`cedarloom workflows uninstall <id>` removes the package, its settings entries and its data folder (what its hooks kept).

## The hooks

Claude Code runs the package under two hooks from `@cedarloom/orchestration`, bundled into one file each (`pnpm --filter @cedarloom/orchestration run build`); `buildPackage` takes their contents.

- **The guard**, before every shell call and agent: pushes and pull requests reach only the working folder's `origin` and this machine's hub and memory repositories. Approvals are refused at every level, and so are merges. The one exception: at Auto, an agent of any workflow script (`agent_type` `workflow-subagent` with an agent id) may merge a pull request of the origin's own repositories, never the hub's or the memory repository's, and never with `--admin`, by GraphQL or as a branch merge without a pull request. That is this package's stage after its reviewer agreed, but also an agent of any other workflow the session runs. A step that runs as its own subagent (a fresh step, or one that names its tools) cannot merge, nor can a session started as that agent type (`claude --agent`, which has no agent id: [hooks reference](https://code.claude.com/docs/en/hooks)); at Auto an Agent call of that type is refused. A project agent of that name started without an Agent call, such as by a skill's `context: fork`, would merge as one (unverified).
- **The exit hook:** a command step's script prints only the last 6,000 bytes of its output, printed when the command ends, so that a hook reads it whole: Claude Code 2.1.316 handed a hook a successful call's output whole only up to 30,000 characters, and cut a failed call's middle to about 10,000 (observed in trials; the hooks reference gives no limit). The script ends with the line `cedarloom-exit <status>`. The hook keeps the last such line of each agent's run of a step script (a run without the line clears the status only in the runner's own form, `sh`, `bash` or `.` before the path, so a `cat` of the script keeps it), whatever the agent added to the command, and refuses a reported exit code that differs, or a report other than -1 when no run was seen. A run in the background or cut by Bash's timeout leaves no line, so only -1 passes.

Both stop an agent's mistakes, not a hostile agent: the guard does not read a script file (a command step's script included), so a merge that a command step runs passes at every level, after the gates the level keeps; and an agent that prints the marker line itself can fake a status.

## Where Codex loses a guarantee

Codex runs the same steps through skills only (no Codex hooks, agents or rules in 0.1.0), so a Codex run is weaker than a Claude Code run:

- Order, skips, retries, the failure policy and a check's rounds are prose the model follows, not code that runs.
- A gate the level keeps is one sentence. Only the user's sandbox and approval settings stand between the model and an action past it, such as a merge.
- Task text, input defaults and approval messages share the skill with its control flow, so a task can steer the stage; the import review, which shows all three, is the safeguard left.
- A fresh step runs in a sub-agent Codex starts with no earlier turns (`spawn_agent`, `fork_turns` none) and every tool the session has.
- A step's `model` and `effort` are not applied.
- A command's exit code is reported by the model and not checked: the guard and the exit-code hook are Claude Code hooks.
- A missing input stops the stage with a question, where Claude Code's runner refuses to start.
