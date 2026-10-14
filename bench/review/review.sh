#!/bin/sh
# Blind review of one built app by a pinned model with a fixed prompt (bench/review/app-review.md) and schema.
# Runs headless in the stock arm-A image (no rules or plugins), read-only, tools limited to reading.
# Usage: bench/review/review.sh <brief-dir> <trial-dir> [model] [effort]   writes <trial-dir>/review.json
set -eu
here=$(dirname "$(realpath "$0")"); brief=$(realpath "$1"); t=$(realpath "$2")
model=${3:-claude-opus-5-5}; effort=${4:-high}
: "${CLAUDE_CODE_OAUTH_TOKEN:=$(cat "$HOME/.config/benchkeeper/oauth-token" 2>/dev/null)}"
[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] || { echo "no token" >&2; exit 1; }
export CLAUDE_CODE_OAUTH_TOKEN
w=$(mktemp -d) && trap 'rm -rf "$w"' EXIT
mkdir -p "$w/app" "$w/screenshots"
tar -xzf "$t/score/app.tar.gz" -C "$w/app"
# Blind the review: remove agent tooling and process files that would reveal the arm.
rm -rf "$w/app/.git" "$w/app/.claude" "$w/app/.mcp.json" "$w/app/.devcontainer" "$w/app/AGENTS.md" "$w/app/CLAUDE.md" \
  "$w/app/skills-lock.json" "$w/app/openspec" "$w/app/docs/superpowers"
cp "$brief/brief.md" "$w/"
cp "$t/score/screenshots/"*.jpg "$w/screenshots/" 2>/dev/null || true
podman run --rm --userns=keep-id -e HOME=/home/node -e CLAUDE_CODE_OAUTH_TOKEN -v "$w":/review:ro,Z -w /review benchkeeper-arm-a \
  claude -p "$(cat "$here/app-review.md")" --model "$model" --effort "$effort" --output-format json \
  --json-schema "$(cat "$here/schema.json")" --allowed-tools Read Glob Grep --disallowed-tools Bash Edit Write WebFetch WebSearch \
  > "$w/out.json"
jq --arg m "$model" --arg e "$effort" '{model: $m, effort: $e, cost_usd_api_equivalent: .total_cost_usd, review: .structured_output}' "$w/out.json" > "$t/review.json"
jq -e '.review.scores' "$t/review.json" > /dev/null || { echo "no structured review in $t" >&2; exit 1; }
