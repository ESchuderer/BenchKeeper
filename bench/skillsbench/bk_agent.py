"""Harbor's Claude Code agent with one arm installed (bench/skillsbench/arm-tar.sh packs it).

Harbor 0.24.0 gives each trial its own CLAUDE_CONFIG_DIR and copies only skills into it, so the arm's ~/.claude
(plugins, rules, user skills, settings) is unpacked there, with the image's /home/node paths rewritten. Node 22 lives
in /opt/bk and is used only by the plugin hooks and the OpenSpec CLI: the task's own PATH stays as the image has it.
The arm tarball comes from the BK_ARM_TAR environment variable of the Harbor process.
"""

import os
from pathlib import Path

from harbor.agents.installed.claude_code import ClaudeCode

SETUP = r"""set -eu
S={sessions}
mkdir -p "$S" && cp -a /opt/bk/claude/. "$S"/
find "$S" -maxdepth 2 -name '*.json' -exec sed -i "s#/home/node/.claude#$S#g; s#/home/node/.bench-src#/opt/bk/bench-src#g" {{}} +
[ ! -d "$S/plugins/cache" ] || find "$S/plugins/cache" -path '*/hooks/*hooks.json' -exec sed -i 's#"command": "node #"command": "/opt/bk/node #' {{}} +
for d in ponytail openspec; do [ ! -d /opt/bk/$d ] || {{ mkdir -p ~/.config && cp -a /opt/bk/$d ~/.config/; }}; done
if [ -d /opt/bk/npm/@fission-ai ]; then
  mkdir -p ~/.local/bin
  printf '#!/bin/sh\nexec /opt/bk/node /opt/bk/npm/@fission-ai/openspec/bin/openspec.js "$@"\n' > ~/.local/bin/openspec
  chmod +x ~/.local/bin/openspec
fi
# no-clobber: files the task already has stay as they are
[ ! -d /opt/bk/project ] || cp -rn /opt/bk/project/. . 2>/dev/null || true
"""


class ArmClaudeCode(ClaudeCode):
    async def install(self, environment) -> None:
        await super().install(environment)
        await environment.upload_file(Path(os.environ["BK_ARM_TAR"]), "/tmp/bk-arm.tgz")
        await self.exec_as_root(
            environment,
            command="mkdir -p /opt/bk && tar xzf /tmp/bk-arm.tgz -C /opt/bk && rm /tmp/bk-arm.tgz && chmod -R a+rX /opt/bk",
        )

    async def run(self, instruction, environment, context) -> None:
        sessions = (self.environment_logs_dir / "sessions").as_posix()
        await self.exec_as_agent(environment, command=SETUP.format(sessions=sessions))
        await super().run(instruction, environment, context)
