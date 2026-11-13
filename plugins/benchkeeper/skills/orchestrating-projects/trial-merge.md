# Trial merge

Read this file only in `merge.mode` `disjoint`, when the verdict's `next` is `trial` at step 3 of [Merge](review-and-merge.md#merge). `<owner/repo>`, `<n>`, `<head>`, `<default branch>`, `<scratch path>` and `AGENTS.md` are the names of [review-and-merge.md](review-and-merge.md).

The trial is the one step that checks files out and runs the pull request's code, so it gets a fresh clone of its own: `<trial path>`, a new folder beside the scratch clone. It serves nothing after, and no session reads a file there or starts there. The trial merge is never pushed.

The trial passes when `merge` exits 0 and the project's changed-files check passes in the trial clone, run as `AGENTS.md` says. Anything else, a trial that cannot run included, takes the `strict` step (`update` in step 3 of [Merge](review-and-merge.md#merge)). Steps 5 and 6 follow every check that ran, whatever its result.

1. **Default-branch commit.** Run `git -C <scratch path> rev-parse refs/remotes/origin/<default branch>`. `<default-branch commit>` is what it printed, the commit the trial merges: write it into the handoff file before the check runs, and never read it from the trial clone.
2. **Whether the trial can run.** It cannot when one of these holds:
   - `AGENTS.md` runs no command in a dev container.
   - The check is more than one command and `AGENTS.md` names no compound form for it (step 4 runs the check as one command).
   - The check has a step that `AGENTS.md` runs on the host after one in the container.
   - A command of the container definition (a lifecycle command such as `postCreateCommand`, a compose `command`, an entrypoint) runs or loads a file of the repository in the container before the check's command, or you cannot tell: the pull request's code would then run before `devcontainer exec` reads the definition.
   - A file of the pull request can define that container ([Container files](#container-files)): the trial's container would then be the pull request's, and its `initializeCommand` runs on the host.
3. **Trial clone.** The clone must exit 0 and `rev-parse --git-dir` must print `.git`, as for a scratch clone ([Scratch clone](review-and-merge.md#scratch-clone)):

   ```text
   gh repo clone <owner/repo> <trial path> --no-upstream -- --filter=blob:none --no-checkout
   git -C <trial path> rev-parse --git-dir
   git -C <trial path> checkout --force --detach <head>
   git -C <trial path> merge --no-edit <default-branch commit>
   ```

4. **Check.** It runs the pull request's code, so it runs only in a dev container started for the trial clone, never on the host, where your session holds the owner's `gh` login, SSH keys and tokens. Where no container can be started for the trial clone, the trial cannot run.
   - The container mounts the trial clone, so that code can rewrite it, and a host command there would follow what it wrote: git runs a `core.fsmonitor` command from `.git/config`, `devcontainer exec` hands the container a variable of your environment that a `remoteEnv` names, `devcontainer up` runs an `initializeCommand`.
   - So start the container once and run the whole check in it as one command: the compound form of `AGENTS.md`, its parts joined by `&&`.
   - After the container starts, that command is all you run on the host in `<trial path>` or with it as the workspace folder: no git command, no second `devcontainer up`, no second `devcontainer exec`.
   - With shared files, the last parts of the one command are the commands that regenerate the generated files, then `git -c core.quotePath=false status --porcelain`: `status` must then list no file under a `merge.additivePaths` entry.
5. **Container.** Remove that container after the trial as [Clean up](SKILL.md#clean-up) removes a worktree's, with `<trial path>` as the folder.
6. **New scratch clone.** Code that ran in your session can have rewritten every clone, as a worker can the checkout: after the check, make a new scratch clone in a new folder ([Scratch clone](review-and-merge.md#scratch-clone)), which is `<scratch path>` from here on.
7. **Comment.** For a trial that passed, say that the pull request merges without an update, with both commits and the check, in a comment (`gh pr comment <n> -R <owner/repo> --body-file <file>`). Then go on with step 4 of [Merge](review-and-merge.md#merge).

## Container files

A file of the pull request can define the trial's container when it passes one of three tests, and each compares without case:

- By path: a segment of its path is `.devcontainer` or `.devcontainer.json`.
- By name, in any folder: its name starts with `.env`, contains `dockerfile` or `containerfile`, or contains `compose` and ends in `.yml` or `.yaml`.
- By the list of what the default branch's container definition loads or runs: its path is on that list.

Make the list from `<default-branch commit>`, never from `<head>`, whose copy lacks what the default branch named since:

1. Start it with the paths of `git -c core.quotePath=false -C <scratch path> ls-tree -r --name-only <default-branch commit>` that pass the path test.
2. Add every file of the repository that a container command of `AGENTS.md` names or runs on the host: a configuration file (`--config`, `--override-config`), a path given to `--docker-path` or `--docker-compose-path`, a script that wraps the command.
3. Read each with `git -C <scratch path> show <default-branch commit>:<path>` and add every file of the repository that it loads or runs, as a path from the repository's root: the scripts an `initializeCommand` runs and what those source, import or start, a compose file's `extends`, `include` and `env_file` entries, the Dockerfile of a `build`.
4. Read each added file the same way until a pass adds none. A path the commit does not hold stays on the list unread.

- A build context and a mounted folder add nothing: their files reach the image or the container, not the host.
- That holds for a build context only while the listed files give the build nothing of yours. Where one of them hands the build a secret, an SSH agent, an argument filled from the environment, a cache mount, the host's network or `privileged` (`secrets`, `ssh`, `args`, `network`, `privileged` under `build`; `RUN --mount` of type `secret`, `ssh` or `cache`), every file under that context is on the list.
- Where a file, or a container command of `AGENTS.md`, loads or runs others without naming each path (a variable, a wildcard, a folder, a command such as `npm run` or `make` that reads files of its own), or you cannot tell for another reason whether a file of the pull request is on the list, the trial cannot run.
