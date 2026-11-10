# Dev container

Reuse `.devcontainer/devcontainer.json`, `.devcontainer.json`, or an existing named configuration. Otherwise create `.devcontainer/devcontainer.json` and only the Dockerfile or Compose services the confirmed stack needs. Preserve existing settings and services. Use an exact image version or digest and pin installed CLI/package versions. [Configuration reference](https://containers.dev/implementors/json_reference/)

- `container`: install the selected agent CLIs in the image at exact versions. Login: the subscription token from the host environment through `remoteEnv` (`"CLAUDE_CODE_OAUTH_TOKEN": "${localEnv:CLAUDE_CODE_OAUTH_TOKEN}"`), never written into the image or the repository, or a login inside the container kept in a named volume for the agent's config folder.
- Install the project toolchain and required local MCP/browser tools inside the image, resolving exact package versions before writing install commands.
- For a browser check, install the browser tool the project uses at an exact version and its matching browser inside the container, with a project-specific stdio launcher through `devcontainer exec`. Verify the connection and browser access to the application. Inspect effective client configuration and override or disable inherited host entries of the same tool for this project. If routing fails, keep the integration disabled.
- Run project-local MCP launchers inside the container: resolve the workspace and named configuration for every launcher and verify the execution location (an MCP server may start outside the agent's working directory).
- Run project commands as a non-root container user. Mount only the project and required project data. Do not mount the host home or Docker socket, enable privileged mode, or forward credentials by default. Review existing mounts, Features, and lifecycle commands before launch. `initializeCommand` runs on the host. [Lifecycle reference](https://github.com/devcontainers/spec/blob/main/docs/specs/devcontainer-reference.md)
- VS Code may attach to the same container for project terminals, builds, and debugging. Verify where native chat or agent extensions run. [VS Code](https://code.visualstudio.com/docs/devcontainers/containers)
- Before VS Code attachment, disable host Git credential integration and SSH-agent forwarding, then check the effective container environment and mounts. VS Code can forward these automatically. [Credential sharing](https://github.com/microsoft/vscode-docs/blob/main/remote/advancedcontainers/sharing-git-credentials.md)

Host launch and verification:
```sh
devcontainer up --workspace-folder .
devcontainer exec --workspace-folder . git status --short
devcontainer exec --workspace-folder . id -un
```
From an existing container terminal, run project commands directly.

For a named configuration, pass its `--config` path consistently. For linked Git worktrees, inspect the `.git` file and `git rev-parse --git-common-dir`. Preserve the referenced paths with narrowly scoped mounts for the required Git metadata, then verify `git status` inside the container. That metadata is shared with the repository's other worktrees. Do not mount a broad parent directory. [Git worktree layout](https://git-scm.com/docs/git-worktree#_details)

After changing the image, Dockerfile, or container creation settings, rebuild instead of reusing the old container: VS Code **Dev Containers: Rebuild Container**, or `devcontainer up --workspace-folder . --remove-existing-container`. First identify data in the old container's writable layer and ask before removing it. Preserve required data in project storage.
