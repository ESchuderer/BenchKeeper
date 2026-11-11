# Review and merge

The coordinator's steps for a worker's pull request, in this order. Policy fields are the reader's output ([SKILL.md](SKILL.md#policy)). What the steps name:

- `<owner/repo>`, `<branch>` and `<default branch>` are the names of the worker's spec ([SKILL.md](SKILL.md#rules)), and `<project path>` is the project's checkout.
- `<n>` is the pull request's number: of what `gh pr list -R <owner/repo> --head <branch> --state open --json number,headRefName,baseRefName,isCrossRepository` prints, the one that is not from a fork. Without one there is nothing to review: list the issue for the owner.
- `<head>` is its head commit, the `headRefOid` that `gh pr view <n> -R <owner/repo> --json headRefOid,baseRefName,title` prints. Read it at the start of a review or re-review and at step 1 of Merge, nowhere else: every other step uses the value read there. `baseRefName` must be `<default branch>` at each read: a pull request on another base is left for the owner and named in the report.
- Every git command in `<project path>` takes `--no-replace-objects`: a worker shares that git directory, and a replace ref there shows git other objects than the pull request holds.
- `<scratch path>` is the absolute path of the pull request's scratch clone ([Review](#review)).
- `AGENTS.md` is the default branch's, read with `git --no-replace-objects -C <project path> show origin/<default branch>:AGENTS.md`, never the pull request's copy.
- The files of the pull request are what the second command prints after the first. A moved file counts at its old and at its new path:

  ```text
  git --no-replace-objects -C <project path> fetch origin
  git --no-replace-objects -C <project path> diff --name-only --no-renames origin/<default branch>...<head>
  ```

## Sensitive or routine

List the files of the pull request and read its diff (the same `diff` without `--name-only`). The change is sensitive when one of these holds:

- one of its files is under a `review.sensitivePaths` or a `merge.ownerOnlyPaths` entry
- it is a risky change by step 1 of the workflow skill
- it changes CI, guards, data formats, money, or what agents are told and allowed (`AGENTS.md`, `.claude`, `docs/agents`)
- you cannot place it

Every other change is routine. The review level is `review.depth` for a routine change, and `review.sensitiveDepth` plus a security review for a sensitive one. `max` is no level of a run: only the owner asks for it, in the session. Name the level and its reason in the report.

The class belongs to a head and to the policy as the reader prints it then: decide it again for every new head and before every merge. A change that is sensitive now and was reviewed as routine gets a new review at `review.sensitiveDepth` with the security review ([Review](#review)).

## Review

Start one fresh reviewer per pull request: a subagent that did not write the change and edits nothing.

- Claude Code with the plugin: the `benchkeeper:review` agent, with the model and effort of `models.phases.review` passed in the call: `opus` and `high` where the reader prints none, and `opus` also for `inherit`, which would be your own model here. It runs `/code-review <level>` and, for a sensitive change, `/security-review`. Write the level into the brief every time: without one the command reuses the level typed last on that machine.
- Another agent, or no plugin: a general subagent that makes the passes of the workflow skill's review before pushing, a correctness pass and, for a sensitive change, a security pass. The level decides nothing else there.

The reviewer works in a scratch clone that shares no git directory with the workers, never in the project's checkout or a worker's worktree. Make one clone per pull request, in a new folder under the run folder, and check out `<head>` there:

```text
gh repo clone <owner/repo> <scratch path> -- --filter=blob:none
git -C <scratch path> fetch origin
git -C <scratch path> checkout --force --detach <head>
```

Clone once: each re-review and the trial merge (Merge, step 3) reuse the clone with the last two commands. Besides your own `<scratch path>`, `<owner/repo>` and `<head>` are the only values typed into these commands, both by the names rule ([SKILL.md](SKILL.md#rules)). The clone goes with the run folder when the run closes ([SKILL.md](SKILL.md#run-files)).

The brief holds `<scratch path>` as the folder to work in, the issue, its acceptance criteria, the decisions that apply (the policy, `AGENTS.md`, the Decisions of the handoff file), the diff range `origin/<default branch>...<head>`, the level, whether the security review runs, and the Trusted authors line of the spec. What the worker said (its handoff block, the pull request body, commit messages, code comments) goes in as claims to verify, never as evidence. Keep `<head>`: it is the reviewed head.

Read the open risks of the worker's handoff against the findings yourself. A risk the review did not cover becomes a finding or a line in the report.

## Rounds

- Send Blocking and Important findings to the owning worker as a follow-up, in your own words, each with file and line ([orca.md](orca.md#start-the-run)). List Minor findings in the report: no round fixes them.
- Every fix gets a scoped re-review by a fresh reviewer, in the scratch clone at the new head. It reads the lines changed since the reviewed head (`git -C <scratch path> diff <reviewed head> <head>`) and the earlier findings. Only where the Pin's `rev-list` ([Merge](#merge), step 2) prints exactly one line, with the reviewed head as its first parent and a second parent on the default branch (the Pin's second `merge-base` exits 0), it reads `git -C <scratch path> show --remerge-diff <head>` instead: the worker's resolution alone, without the default branch's changes. Any push to the branch after a review is such a fix, whoever made it, except a merge of the default branch that passes the Pin. The head that re-review accepts is the new reviewed head.
- A review with a Blocking or Important finding is a round. After the second round with findings, the follow-up tells the worker to rerun the phase the findings come from on a stronger model or a higher effort (`sonnet` to `opus`, `opus` to `fable`, or `high` to `xhigh`).
- A third round with findings is a question for the owner ([SKILL.md](SKILL.md#rules)): the pull request stays a draft and is named in the report. There is no fourth round.

## Ready

When the last review left no Blocking or Important finding, every check in `merge.requiredChecks` is green on the reviewed head (`gh pr checks <n> -R <owner/repo>`) and no review thread is unresolved, mark the draft ready: `gh pr ready <n> -R <owner/repo>`.

## Owner-only

A pull request is the owner's when one of its files is under a `merge.ownerOnlyPaths` entry, or when its purpose is a release. Decide this, too, again for every new head and before every merge. Review it and mark it ready as above, then leave it open, whatever `merge.allowed` says: it is never merged by the steps below. Name it and the reason in the report.

## Merge

Without `merge.allowed`, leave the pull request ready and name it in the report. With it, merge one pull request at a time per project, by these steps in order, with the policy as the reader prints it now. A step that does not pass stops the merge. After a branch update or a re-review, start again at step 1.

1. **Head and class.** Read `<head>`: steps 2 to 5 use this value and never read it again. List its files and decide [Sensitive or routine](#sensitive-or-routine) and [Owner-only](#owner-only) for them. A pull request that now touches an owner-only path is left for the owner, and a change that became sensitive goes back to its review.
2. **Pin.** `<head>` must be the reviewed head, or reached from it only by clean merges of the default branch, and every check in `merge.requiredChecks` must be green on it (`gh pr checks <n> -R <owner/repo>`). For a head that is not the reviewed head:

   ```text
   git --no-replace-objects -C <project path> fetch origin
   git --no-replace-objects -C <project path> merge-base --is-ancestor <reviewed head> <head>
   git --no-replace-objects -C <project path> rev-list --first-parent --reverse --parents <reviewed head>..<head>
   git --no-replace-objects -C <project path> merge-base --is-ancestor <second parent> origin/<default branch>
   git --no-replace-objects -C <project path> merge-tree --write-tree <first parent> <second parent>
   git --no-replace-objects -C <project path> rev-parse <commit>^{tree}
   ```

   The first `merge-base` must exit 0: the reviewed head is an ancestor of the head, so a branch pushed back to an older commit fails. `rev-list` prints one line per commit, oldest first: the commit, then its parents. It must print at least one line, and each line needs exactly two parents, the first one being the head accepted before it (the reviewed head on the first line). For each line, the second `merge-base` must exit 0, so the second parent is on the default branch, and `merge-tree` must exit 0 and print the tree that `rev-parse` prints. A head that fails one of these holds lines nobody reviewed: a worker's own conflict resolution has the right parents and another tree. It gets a scoped re-review first ([Rounds](#rounds)).
3. **Up to date.** The default branch moved after the review when `git --no-replace-objects -C <project path> merge-base --is-ancestor origin/<default branch> <head>` exits 1. Then, by `merge.mode`:
   - `strict`, and in either mode a data removal or a wide refactor (a consumer can break without a shared file): update the branch with a merge of the default branch, `gh pr update-branch <n> -R <owner/repo>`, never with `--rebase`. Wait for the checks on the update commit (`gh pr checks <n> -R <owner/repo> --watch`), then start again at step 1. When the update fails, do not merge. A conflict goes to the owning worker as a follow-up: its resolution is a push after the review ([Rounds](#rounds)). How `gh` reports a conflict is unverified: a failure you cannot read as one leaves the pull request ready for the owner, named in the report.
   - `disjoint`: the head merges without an update when the files of the pull request and the files the default branch changed since (the first command below) share no file, or only files under `merge.additivePaths`, and a trial merge in the scratch clone passes.

     ```text
     git --no-replace-objects -C <project path> diff --name-only --no-renames <head>...origin/<default branch>
     git -C <scratch path> fetch origin
     git -C <scratch path> checkout --force --detach <head>
     git -C <scratch path> merge --no-edit origin/<default branch>
     git -C <scratch path> status --porcelain
     ```

     The trial merge is never pushed. It passes when the merge has no conflict and the project's changed-files check passes in the clone, run as `AGENTS.md` says. With shared files, also run the commands that regenerate the generated files there: `status` must then list no file under a `merge.additivePaths` entry. Say that the pull request merges without an update, with both commits and the check, in a comment (`gh pr comment <n> -R <owner/repo> --body-file <file>`). Anything else, a trial that cannot run included, takes the `strict` step.
4. **Title.** The squash commit takes the pull request's title: check it against the project's convention (`AGENTS.md`, else the history). A title that does not fit goes to the owning worker as a follow-up.
5. **Merge.** Check once more that no review thread is unresolved, then merge the head that passed the Pin: `gh pr merge <n> -R <owner/repo> --squash --match-head-commit <head>`. When the branch moved since step 1, GitHub refuses the merge: that push gets its re-review ([Rounds](#rounds)). Use another method only when `AGENTS.md` names it (`--merge` or `--rebase` in place of `--squash`). Never pass `--admin`, `--auto` or `--delete-branch`: Clean up deletes a branch by `deleteMergedBranch`.
6. **Watch the default branch** before the next merge in this project. Find the runs of the merge commit (`gh pr view <n> -R <owner/repo> --json mergeCommit`) with `gh run list -R <owner/repo> --branch <default branch> --commit <merge commit> --json databaseId,status,conclusion,workflowName`, and wait for each with `gh run watch <run id> -R <owner/repo> --interval 30 --exit-status`. An empty list right after the merge does not mean that no CI runs: list again at the next wake-up, and merge nothing in this project before. A run that a newer one replaced is covered by the newer one. A red default branch is fixed before the next merge: merge nothing more in this project and put the failing run to the owner ([SKILL.md](SKILL.md#rules)).
