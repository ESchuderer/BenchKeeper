# Project

The agent and all project commands run inside this project's development container (Node.js 22, `.devcontainer/devcontainer.json`); run project commands directly, without a `devcontainer exec` prefix.

## Commands
- Package manager: npm. Install, build, test and run commands are the `package.json` scripts once it exists.
- Browser checks: Playwright MCP (`.mcp.json`) runs in this container with Chromium; use it against the running app.

## Conventions
- Specs use OpenSpec (`openspec/`).
