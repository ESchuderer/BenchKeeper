#!/bin/sh
# Skill files of each framework arm image, for the skills inventory (#36): name, description and size of every SKILL.md
# under ~/.claude and the project template (not the source clones). Usage: bench/scripts/skills-inventory.sh > <out.json>
set -eu
printf '{'
sep=
for arm in A B F G H V AB AC L; do
  printf '%s"%s":' "$sep" "$arm"; sep=,
  podman run --rm "benchkeeper-arm-$(echo "$arm" | tr A-Z a-z)" node -e '
    const { execSync } = require("node:child_process"); const fs = require("node:fs");
    const files = execSync("find $HOME/.claude $HOME/project-template/.claude -name SKILL.md 2>/dev/null || true", { encoding: "utf8" }).split("\n").filter(Boolean);
    const out = files.map((f) => {
      const text = fs.readFileSync(f, "utf8"); const fm = (/^---\n([\s\S]*?)\n---/.exec(text) || [])[1] || "";
      const field = (k) => (new RegExp(`^${k}:\\s*(.*)$`, "m").exec(fm) || [])[1]?.replace(/^["\x27]|["\x27]$/g, "") || "";
      return { dir: f.split("/").slice(-2, -1)[0], name: field("name"), description: field("description"), bytes: Buffer.byteLength(text) };
    });
    // ASCII-only JSON (non-ASCII as \u escapes): the recorded descriptions may contain characters the repository forbids.
    process.stdout.write(JSON.stringify(out).replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")));'
done
printf '}\n'
