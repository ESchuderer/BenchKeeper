# Orca worker spec

For a coordinator that fans work out through Orca orchestration. Orca orchestration is experimental: turn it on under Settings, Experimental. Use the executable the `orchestration` skill resolves for `ORCA` (on Linux outside an Orca terminal that is `orca-ide`, not `orca`).

## Rules for the fan-out

- One layer fans out: Orca places the workers. A worker is one session; inside it at most subagents, no agent teams.
- When the work is to run as Orca workers, do not run the same items as subagents of the coordinator's own session.
- Fan out only work that decomposes into independent items. Sequential work, or items that edit the same files, stays in one session.
- `worker-start` takes the agent, and `--model` and `--effort` when the worker needs another model than the default of that agent. Orca starts `claude` without `--model`, so the model from the Claude Code settings applies when none is given.
- A worker stops on its own condition: the checks of the project pass, or the task's acceptance is met. Name a cap (turns or time) in the spec.

## Spec

Paste into `ORCA orchestration worker-start --spec "..." --worktree current --agent claude`, or `task-create --spec` for planned fan-out. One spec per worker; the first line is the same in every spec of one fan-out, and the sessions board shows it with each worker's session.

```text
Orca run: <id of this fan-out, letters, digits, dot, dash, at most 64>
Tier: <quick|standard|full> (<change type>)
Branch and pull request: <type>/<issue>-<slug> from <base branch>; the pull request targets <base branch>
Commits: <convention and footer lines from the project's AGENTS.md>
Checks: <the commands from AGENTS.md, with the container prefix where it names one>
Cap: <turns or minutes>

Target: <files, component or environment in scope>
Change: <the concrete result to produce>
Constraints: <invariants, compatibility rules, do-not-touch boundaries>
Ownership: <what this worker may edit; what it leaves to others>
Observable acceptance: <the test, output or evidence that proves completion>

Report: three sentences (what you did, what you found, what is left) and what you did not check.
```

The five fields from `Target` to `Observable acceptance` are the task-spec contract of the `orchestration` guide (`ORCA skills get orchestration`, Orca 1.4.237). The lines above them are BenchKeeper's: they carry what a new worktree does not carry on its own (tier, branch, commit and check conventions, the run marker).

## New worktrees

`ORCA orchestration worker-start --worktree new-child --name <name> --setup run` makes a worktree for the worker. Skills and setup files that the project keeps out of Git are not in it unless `.worktreeinclude` lists them; see `orca.yaml.sample` and `worktreeinclude.sample` in this folder. Neither is added to a project for you.
