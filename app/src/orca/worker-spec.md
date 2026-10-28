# Orca worker spec

For a coordinator that fans work out through Orca orchestration. Orca orchestration is experimental: turn it on under Settings, Experimental. Use the executable the `orchestration` skill resolves for `ORCA` (on Linux outside an Orca terminal that is `orca-ide`, not `orca`).

## Rules for the fan-out

- One layer fans out: Orca places the workers. A worker is one session; inside it at most subagents, no agent teams.
- When the work is to run as Orca workers, do not run the same items as subagents of the coordinator's own session.
- Fan out only work that decomposes into independent items. Sequential work, or items that edit the same files, stays in one session.
- `worker-start` takes the agent, and `--model` and `--effort` when the worker needs another model than the default of that agent. Orca starts `claude` without `--model`, so the model from the Claude Code settings applies when none is given.
- A worker stops on its own condition: the checks of the project pass, or the task's acceptance is met. Name a cap (turns or time) in the spec.

## Spec

Paste into `ORCA orchestration worker-start --spec "..." --worktree new-child --name <name> --agent claude`, or `task-create --spec` for planned fan-out. `--worktree current` only in an attended run: an unattended one starts each worker in a disposable worktree. Pass no flag that bypasses or skips permission prompts (`--extra-agent-args` included); the worker runs in its agent's default permission mode. One spec per worker; the first line is the same in every spec of one fan-out, and the sessions board shows it with each worker's session.

```text
Orca run: <id of this fan-out, letters, digits, dot, dash, at most 64>
Tier: <quick|standard|full> (<change type>)
Branch and pull request: <type>/<issue>-<slug> from <base branch>, remote origin; a draft pull request that targets <base branch>
Commits: <convention and footer lines from the project's AGENTS.md>
Checks: <the commands from AGENTS.md, with the container prefix where it names one>
Cap: <turns or minutes>
Skills: <skills to use for this task, by name, or none>
Shared context: <what the coordinator already knows that saves a re-read: sibling items, files another worker owns, an earlier attempt's finding; or none>
Your cwd is the worktree you start in: run every command there, with no cd into another checkout.

Target: <files, component or environment in scope>
Change: <the concrete result to produce>
Constraints: <invariants, compatibility rules, do-not-touch boundaries>
Ownership: <owned paths this worker may change; what it leaves to others>
Observable acceptance: <the test, output or evidence that proves completion>

Authority: agent <agent>, model <model or agent default>, effort <effort or agent default>, permission mode the agent's default. You may create the branch above, commit changes to the owned paths, run the checks, push that branch, and open or update its draft pull request. You may not merge, force-push, stash, reset, clean, push another branch or change a path outside Ownership.
Steps: implement, run the checks, review the diff before pushing (one correctness pass against Change and Observable acceptance, fixes made once; full tier more rounds), commit, push, open the draft pull request, wait for its checks once. The coordinator marks it ready.
Acknowledge: send one heartbeat as your first action, and more heartbeats during long work. Ask a blocking question with `ORCA orchestration ask`, never a local prompt.
Checkpoints: set the worktree's status and a one-line comment with ids and states only at start (`ORCA worktree set --worktree active --workspace-status in-progress --comment "..." --json`), when the draft pull request is open (`in-review`) and when done (`completed`). Read the current comment first (`ORCA worktree current --json`) and keep what is still valid, so context a person wrote there survives.
Outcome: DONE (`worker_done --outcome succeeded`), BLOCKED (`--outcome failed`, subject starts `BLOCKED:`; a hook refused, a credential is missing, a dialog needs a person, a check fails for a cause you cannot fix) or NEEDS_REPLAN (`--outcome failed`, subject starts `NEEDS_REPLAN:`; this spec does not fit the work). Never bypass a hook and never answer a trust dialog.
Report: one `worker_done` with `--outcome`, sent exactly once, also on failure; the body in three sentences (what you did, what you found, what is left); the handoff block in .benchkeeper/handoff.md of your worktree, passed with `--report-path` (in the body when `git check-ignore -q .benchkeeper/handoff.md` fails):
  Outcome: <DONE|BLOCKED|NEEDS_REPLAN>
  What changed: <pull request, commits, files>
  Checks and results: <each command and its result>
  Open risks: <what you did not check, what could break>
  Next step: <what the coordinator or owner does next>
```

The five fields from `Target` to `Observable acceptance` are the task-spec contract of the `orchestration` guide (`ORCA skills get orchestration`, Orca 1.4.237). The lines around them are BenchKeeper's: they carry what a new worktree does not carry on its own (tier, branch, commit and check conventions, the run marker) and the worker's authority, outcomes and handoff.

## New worktrees

`ORCA orchestration worker-start --worktree new-child --name <name> --setup run` makes a worktree for the worker. Skills and setup files that the project keeps out of Git are not in it unless `.worktreeinclude` lists them; see `orca.yaml.sample` and `worktreeinclude.sample` in this folder. Neither is added to a project for you.
