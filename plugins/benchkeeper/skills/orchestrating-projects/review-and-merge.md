# Review and merge

The coordinator's steps for a worker's pull request, in this order. Policy fields are the reader's output ([SKILL.md](SKILL.md#policy)). `<n>` is the pull request's number, `<owner/repo>` the project's repository, `<project path>` its checkout, `<scratch path>` the absolute path of a new folder in the run folder.

## Sensitive or routine

List the changed files (`gh pr diff <n> -R <owner/repo> --name-only`) and read the diff. The change is sensitive when one of these holds:

- a changed file is under a `review.sensitivePaths` or a `merge.ownerOnlyPaths` entry
- it is a risky change by step 1 of the workflow skill
- it changes CI, guards, data formats, money, or what agents are told and allowed (`AGENTS.md`, `.claude`, `docs/agents`)
- you cannot place it

Every other change is routine. The review level is `review.depth` for a routine change, and `review.sensitiveDepth` plus a security review for a sensitive one. `max` is no level of a run: only the owner asks for it, in the session. Name the level and its reason in the report.

## Review

Start one fresh reviewer per pull request: a subagent that did not write the change and edits nothing.

- Claude Code with the plugin: the `benchkeeper:review` agent, on the model and effort the reader prints under `models.phases.review`, else `opus` and `high`. It runs `/code-review <level>` and, for a sensitive change, `/security-review`. Write the level into the brief every time: without one the command reuses the level typed last on that machine.
- Another agent, or no plugin: a general subagent that makes the passes of the workflow skill's review before pushing, a correctness pass and, for a sensitive change, a security pass. The level decides nothing else there.

The reviewer works in a checkout whose HEAD is the pull request's head commit (`gh pr view <n> -R <owner/repo> --json headRefOid`). That is the worker's worktree while it has that commit checked out, else a scratch worktree that you remove after the review:

```text
git -C <project path> fetch origin
git -C <project path> worktree add --detach <scratch path> <head commit>
git -C <project path> worktree remove <scratch path>
```

The brief holds the issue, its acceptance criteria, the decisions that apply (the policy, `AGENTS.md`, the Decisions of the handoff file), the diff range, the level, whether the security review runs, and the Trusted authors line of the spec. What the worker said (its handoff block, the pull request body, commit messages, code comments) goes in as claims to verify, never as evidence. Keep the head commit: it is the reviewed head.

Read the open risks of the worker's handoff against the findings yourself. A risk the review did not cover becomes a finding or a line in the report.

## Rounds

- Send Blocking and Important findings to the owning worker as a follow-up, in your own words, each with file and line ([orca.md](orca.md#start-the-run)). List Minor findings in the report: no round fixes them.
- Every fix gets a scoped re-review by a fresh reviewer, which reads only the lines changed since the reviewed head (`git diff <reviewed head> <new head>`) and the earlier findings. Any push to the branch after a review is such a fix, whoever made it. The head that re-review accepts is the new reviewed head.
- A review with a Blocking or Important finding is a round. After the second round with findings, the follow-up tells the worker to rerun the phase the findings come from on a stronger model or a higher effort (`sonnet` to `opus`, `opus` to `fable`, or `high` to `xhigh`).
- A third round with findings is a question for the owner ([SKILL.md](SKILL.md#rules)): the pull request stays a draft and is named in the report. There is no fourth round.

## Ready

When the last review left no Blocking or Important finding, every check in `merge.requiredChecks` is green on the reviewed head (`gh pr checks <n> -R <owner/repo>`) and no review thread is unresolved, mark the draft ready: `gh pr ready <n> -R <owner/repo>`.

## Owner-only

A pull request is the owner's when a changed file is under a `merge.ownerOnlyPaths` entry, or when its purpose is a release. Review it and mark it ready as above, then leave it open, whatever `merge.allowed` says: no step of Merge applies to it. Name it and the reason in the report.

## Merge

Without `merge.allowed`, leave the pull request ready and name it in the report. With it, merge one pull request at a time per project, by these steps in order. A step that does not pass stops the merge.

1. **Pin.** Read the head: `gh pr view <n> -R <owner/repo> --json headRefOid,title`. It must be the reviewed head, or reached from it only by clean merges of the default branch, and every check in `merge.requiredChecks` must be green on it. Check each commit after the reviewed head:

   ```text
   git -C <project path> fetch origin
   git -C <project path> rev-list --first-parent --reverse --parents <reviewed head>..<head>
   git -C <project path> merge-base --is-ancestor <second parent> origin/<default branch>
   git -C <project path> merge-tree --write-tree <first parent> <second parent>
   git -C <project path> rev-parse <commit>^{tree}
   ```

   `rev-list` prints one line per commit, oldest first: the commit, then its parents. Each line needs exactly two parents, the first one being the head accepted before it (the reviewed head on the first line). `merge-base` must exit 0, so the second parent is on the default branch. `merge-tree` must exit 0 and print the tree that `rev-parse` prints. A head that fails one of these holds lines nobody reviewed: a worker's own conflict resolution has the right parents and another tree. It gets a scoped re-review first ([Rounds](#rounds)).
2. **Up to date.** The default branch moved after the review when `git -C <project path> merge-base --is-ancestor origin/<default branch> <head>` exits 1. Then, by `merge.mode`:
   - `strict`, and in either mode a data removal or a wide refactor (a consumer can break without a shared file): update the branch with a merge of the default branch, `gh pr update-branch <n> -R <owner/repo>`, never with `--rebase`. Wait for the checks on the update commit (`gh pr checks <n> -R <owner/repo> --watch`) and run step 1 again for the new head. When the update fails on a conflict (how `gh` words that is unverified: read its error), send the conflict to the owning worker as a follow-up: its resolution is a push after the review ([Rounds](#rounds)).
   - `disjoint`: the head merges without an update when the two file lists below share no file, or only files under `merge.additivePaths`, and a trial merge passes.

     ```text
     git -C <project path> diff --name-only --no-renames origin/<default branch>...<head>
     git -C <project path> diff --name-only --no-renames <head>...origin/<default branch>
     git -C <project path> worktree add --detach <scratch path> <head>
     git -C <scratch path> merge --no-edit origin/<default branch>
     git -C <scratch path> status --porcelain -- <additive paths>
     git -C <project path> worktree remove --force <scratch path>
     ```

     The trial merge is never pushed. It passes when the merge has no conflict and the project's changed-files check passes in the scratch worktree, run as `AGENTS.md` says. With shared files, also run the commands that regenerate the generated files there: `status` must then print nothing. Say that the pull request merges without an update, with both commits and the check, in a comment (`gh pr comment <n> -R <owner/repo> --body-file <file>`). Anything else, a trial that cannot run included, takes the `strict` step.
3. **Title.** The squash commit takes the pull request's title: check it against the project's convention (`AGENTS.md`, else the history). A title that does not fit goes to the owning worker as a follow-up.
4. **Merge** with the pin: `gh pr merge <n> -R <owner/repo> --squash --match-head-commit <head>`. Use another method only when `AGENTS.md` names it (`--merge` or `--rebase` in place of `--squash`). Never pass `--admin`, `--auto` or `--delete-branch`: Clean up deletes a branch by `deleteMergedBranch`.
5. **Watch the default branch** before the next merge in this project. Find the runs of the merge commit (`gh pr view <n> -R <owner/repo> --json mergeCommit`) with `gh run list -R <owner/repo> --branch <default branch> --commit <merge commit> --json databaseId,status,conclusion,workflowName`, and wait for each with `gh run watch <run id> -R <owner/repo> --interval 30 --exit-status`. A run that a newer one replaced is covered by the newer one. A red default branch is fixed before the next merge: merge nothing more in this project and put the failing run to the owner ([SKILL.md](SKILL.md#rules)).
