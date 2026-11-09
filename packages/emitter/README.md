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
  - allow rules for the first stage, the precheck and each step's script, the commands the approval listed, as a workflow's agent cannot ask in `claude -p`; and for reads in the package folder, which a step's agent may make before it runs a script, in the [permissions docs'](https://code.claude.com/docs/en/permissions) `//` form for an absolute path;
  - an ask rule for each later stage. Claude Code asks before such a stage in an interactive session, in auto mode too, and refuses it in `claude -p` (2.1.316).
- **The level** is `--level`, else the default level (`cedarloom level`). Installing again at another level rebuilds the package; a project's own level does not reach it, as one package serves every project.
- **Every session:** the hooks run in every Claude Code session while the package is on, not only in its stages. There the guard refuses merges and approvals and holds its other rules, but the repository limit and its refusal of what it cannot read (a subshell, a brace group) reach only a workflow's agents (below). The plan says so.
- **For merges, the strictest installed level holds:** each package's guard runs in every session, so a merge passes only while every installed package is at Auto. The install warns (`package.levels-mixed`) when another package is on the other side of Auto.
- **Windows:** the precheck and step rules name the package folder with forward slashes (`C:/Users/...`), as Claude Code fills a skill's `${CLAUDE_PLUGIN_ROOT}` ([plugins reference](https://code.claude.com/docs/en/plugins-reference), "Quoting and path separators"); the Read rule takes the POSIX form (`//c/Users/...`). Unverified on a Windows machine.
- **Node.js** for the hooks: the PATH's `node` where it links to the running one, which stays put over an upgrade, else the running one. The plan names it: should it go, as a versioned Homebrew path does on `brew upgrade`, Claude Code refuses every guarded call in those sessions until the next install, and `cedarloom doctor` reports it.
- **Codex** loads the same folder from its own copy: `codex plugin marketplace add <folder>` once, then `codex plugin add <plugin>@cedarloom-workflows` after every install.

`cedarloom workflows uninstall <id>` removes the package, its settings entries and its data folder (what its hooks kept).

## The hooks

Claude Code runs the package under two hooks from `@cedarloom/orchestration`, bundled into one file each (`pnpm --filter @cedarloom/orchestration run build`); `buildPackage` takes their contents.

- **The guard**, before every shell call and agent of every session with the package on. A workflow's agent (`agent_type` `workflow-subagent` with an agent id) meets all of it: pushes and pull requests reach only the working folder's `origin` and this machine's hub and memory repositories, and what the guard cannot read, such as a subshell, PowerShell or a remote agent, is refused. Any other caller meets the rest: merges and approvals, force pushes, gh's configuration, the owner's writes and the memory repository's `main` stay refused, while other repositories, issues outside the hub and what the guard cannot read pass (owner question Q5, option b until the owner answers). Approvals are refused at every level, and so are merges. The one exception: at Auto, an agent of any workflow script (`agent_type` `workflow-subagent` with an agent id) may merge a pull request of the origin's own repositories, never the hub's or the memory repository's, and never with `--admin`, by GraphQL or as a branch merge without a pull request. That is this package's stage after its reviewer agreed, but also an agent of any other workflow the session runs. A step that runs as its own subagent (a fresh step, or one that names its tools) cannot merge, nor can a session started as that agent type (`claude --agent`, which has no agent id: [hooks reference](https://code.claude.com/docs/en/hooks)); at Auto an Agent call of that type is refused. A project agent of that name started without an Agent call merges as one at Auto: a skill with `context: fork` that names it does, whether the user types the skill or a session runs it through the Skill tool (seen with 2.1.316). That takes a deliberate setup, outside what the guard stops: an agent's mistakes, not a hostile session.
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
