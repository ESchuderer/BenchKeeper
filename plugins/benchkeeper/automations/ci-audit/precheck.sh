#!/bin/sh
# Usage: precheck.sh <report file>
# Exit 0 to start the run: no session of this automation is alive, and there is no report yet, its first line names no
# commit this checkout has, or a workflow or dependency file changed between that commit and HEAD.
if pgrep -f "automation-[c]i-audit" >/dev/null; then exit 1; fi
[ -f "$1" ] || exit 0
sha=$(head -n 1 "$1" | sed -n 's/^Commit: \([0-9a-f]\{40\}\)$/\1/p')
{ [ -n "$sha" ] && git cat-file -e "$sha^{commit}" 2>/dev/null; } || exit 0
git diff --name-only "$sha" HEAD | grep -qE '^\.github/workflows/|(^|/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|uv\.lock|Pipfile(\.lock)?|go\.(mod|sum)|Cargo\.(toml|lock)|Gemfile(\.lock)?|composer\.(json|lock))$'
