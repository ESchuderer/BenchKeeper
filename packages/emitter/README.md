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
- **Every session:** outside a workflow's agents the guard refuses merges and approvals and holds its other rules, but not its repository limit or its refusal of what it cannot read, such as a subshell `( … )` ([the hooks](#the-hooks)).
- **For merges, the strictest installed level holds:** each package's guard runs in every session, so a merge passes only while every installed package is at Auto. The install warns (`package.levels-mixed`) when another package is on the other side of Auto.
- **Node.js** for the hooks: the PATH's `node` where it links to the running one, which stays put over an upgrade, else the running one. The plan names it. Should that file go, as a versioned one does when its version is removed, the hooks cannot start, which `onFailure: "block"` makes refuse every call they guard ([hooks reference](https://code.claude.com/docs/en/hooks), "Block the action when a hook fails") until the next install; `cedarloom doctor` reports it.
- **Codex** loads the same folder from its own copy: `codex plugin marketplace add <folder>` once, then `codex plugin add <plugin>@cedarloom-workflows` after every install. `cedarloom doctor` reports a package Codex has no copy of, a copy that differs from the installed package, and one CedarLoom no longer installs ([below](#running-in-codex)).

`cedarloom workflows uninstall <id>` removes the package, its settings entries and its data folder (what its hooks kept).

## The hooks

Claude Code runs the package under two hooks from `@cedarloom/orchestration`, bundled into one file each (`pnpm --filter @cedarloom/orchestration run build`); `buildPackage` takes their contents.

- **The guard**, before every shell call and agent of every session with the package on. A workflow's agents (a workflow script's, `agent_type` `workflow-subagent` with an agent id, and a step's own subagent) meet all of it: pushes and pull requests reach only the working folder's `origin` and this machine's hub and memory repositories, and what the guard cannot read, such as a subshell, PowerShell or a remote agent, is refused. Any other caller meets the rest: the merges, approvals, force pushes, gh configuration changes, owner's writes and pushes to the memory repository's `main` that the guard reads stay refused, while other repositories, issues outside the hub and what the guard cannot read pass, unless its text names a merge, an approval or a review (owner question Q5, option b until the owner answers). Approvals are refused at every level, and so are merges. The one exception: at Auto, an agent of any workflow script (`agent_type` `workflow-subagent` with an agent id) may merge a pull request of the origin's own repositories, never the hub's or the memory repository's, and never with `--admin`, by GraphQL or as a branch merge without a pull request. That is this package's stage after its reviewer agreed, but also an agent of any other workflow the session runs. A step that runs as its own subagent (a fresh step, or one that names its tools) cannot merge, nor can a session started as that agent type (`claude --agent`, which has no agent id: [hooks reference](https://code.claude.com/docs/en/hooks)); at Auto an Agent call of that type is refused. A project agent of that name started without an Agent call merges as one at Auto: a skill with `context: fork` that names it does, whether the user types the skill or a session runs it through the Skill tool (seen with 2.1.316). That takes a deliberate setup, outside what the guard stops: an agent's mistakes, not a hostile session.
- **The exit hook:** a command step's script prints only the last 6,000 bytes of its output, printed when the command ends, so that a hook reads it whole: Claude Code 2.1.316 handed a hook a successful call's output whole only up to 30,000 characters, and cut a failed call's middle to about 10,000 (observed in trials; the hooks reference gives no limit). The script ends with the line `cedarloom-exit <status>`. The hook keeps the last such line of each agent's run of a step script (a run without the line clears the status only in the runner's own form, `sh`, `bash` or `.` before the path, with options or without, so a `cat` of the script keeps it), whatever the agent added to the command, and refuses a reported exit code that differs, or a report other than -1 when no run was seen. A run in the background or cut by Bash's timeout leaves no line, so only -1 passes.

Both stop an agent's mistakes, not a hostile agent: the guard does not read a script file (a command step's script included), so a merge that a command step runs passes at every level, after the gates the level keeps; and an agent that prints the marker line itself can fake a status.

## Running in Codex

Codex (0.166.0 here, and the version `.github/codex` pins in CI) runs a package from its copy in `<CODEX_HOME>/plugins/cache/cedarloom-workflows/<plugin>/<version>/` (`CODEX_HOME` defaults to `~/.codex`):

- It loads the skills of both folders the manifest lists, `steps/` and `codex/`, and each skill's `agents/openai.yaml` keeps it off the model's list, so only the user starts one. CI's test job checks both with the pinned Codex (`.github/codex`): an installed package lists none of its skills, and lists a step's and a stage's once their policy files are gone from the copy.
- `codex plugin add` again replaces the copy, a rebuild at the same version too, and `codex plugin remove` deletes it. The doctor compares each package with its copy, file by file.

A stage runs in Codex, signed in (`codex login`), with this command from the project folder (unverified: the owner's signed-in check):

```sh
codex exec --sandbox workspace-write '$<plugin>:start'
```

The stage runs the precheck and its steps in order and ends with a report that names the next stage's skill (`$<plugin>:<gate>-approved`), which runs the same way.

## Windows

Not run on a Windows machine; CI's Windows job runs the tests, the rule forms below with its real drive path included.

- **Git for Windows is needed:** with it, Claude Code runs the Bash tool in Git Bash; without it, only the PowerShell tool, which the guard refuses to a workflow's agents, so no step runs ([setup](https://code.claude.com/docs/en/setup)). WSL works as Linux does.
- **Rules:** the precheck and step rules name the package folder with forward slashes (`C:/Users/...`), as Claude Code fills a skill's `${CLAUDE_PLUGIN_ROOT}` ([plugins reference](https://code.claude.com/docs/en/plugins-reference), "Quoting and path separators"); the Read rule takes the POSIX form (`//c/Users/...`).
- **Hooks** run as `node.exe` by its absolute path, in exec form, so no shell takes part; a step's script runs with Git Bash's `sh`.
- **Codex:** a step skill runs `sh '<root>/steps/<step>/scripts/run.sh'`, which needs an `sh` on the PATH Codex runs commands with; Git for Windows' default install puts only `git` there (unverified).

## Where Codex loses a guarantee

Codex runs the same steps through skills only (no Codex hooks, agents or rules in 0.1.0), so a Codex run is weaker than a Claude Code run:

- Order, skips, retries, the failure policy and a check's rounds are prose the model follows, not code that runs.
- A gate the level keeps is one sentence. Only the user's sandbox and approval settings stand between the model and an action past it, such as a merge.
- Task text, input defaults and approval messages share the skill with its control flow, so a task can steer the stage; the import review, which shows all three, is the safeguard left.
- A fresh step runs in a sub-agent Codex starts with no earlier turns (`spawn_agent`, `fork_turns` none) and every tool the session has.
- A step's `model` and `effort` are not applied.
- A command's exit code is reported by the model and not checked: the guard and the exit-code hook are Claude Code hooks.
- A missing input stops the stage with a question, where Claude Code's runner refuses to start.
- A step asks the user nothing mid-stage only because one sentence says so; Claude Code's step agents are subagents, which have no question tool ([subagents](https://code.claude.com/docs/en/sub-agents)).
