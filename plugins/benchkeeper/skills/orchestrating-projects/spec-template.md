# Worker spec template

Copy this file's block, replace each `<...>`, and send it as the worker's task. Change nothing else. The repository's rules stay in its `AGENTS.md`; this spec only points to them.

```text
Issue: <owner/repo>#<number>. Read the issue with all its comments before anything else.
Project: <path of the checkout the worker starts in>
Base: <default branch>. Work on a new branch <type>/<number>-<slug> from origin/<default branch>, in the worktree you start in.
Tier: <tier named in the issue, else the Default tier line of AGENTS.md, else the workflow skill decides>

Repository rules: read AGENTS.md and the files it points to before the first edit. They decide checks, commit format, branch and pull request conventions. Where they differ from this spec, they win, except for the two blocks below.

Flow: implement, run the checks AGENTS.md names, commit, push, open a ready pull request that refers to the issue and states the safest reversible options you chose and what you did not check, address review comments, wait for the checks once. Do not merge. Do not close the issue.

Decisions: you decide every open question yourself, taking the safest reversible option, and write it in the pull request. Never ask the coordinator and wait.

Blocked: if a hook refuses a commit or push, a credential is missing, or a check fails and you cannot fix its cause, comment the state on the issue (paths and counts only, no flagged text), send the blocked report (its subject starts with `Blocked:`), and end. Never bypass, edit or disable a hook, never use an option that skips one, and never end with a question in your terminal.

No change needed: if the issue does not apply, comment why with the evidence on the issue, report done with "no change needed", and end.

Report: once, with the pull request number, what you did, and what you did not check. Then stop.
```
