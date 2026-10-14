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
img=$(podman image inspect benchkeeper-arm-a --format '{{.Id}}')
# Blind by allowlist, inside a container (no host tar on an agent-made archive): copy regular files only, without
# dotfiles and dot directories (except .gitignore), Markdown other than README.md, OpenSpec and skills lock files.
podman run --rm --userns=keep-id -v "$t/score/app.tar.gz":/in.tar.gz:ro,Z -v "$w/app":/app:Z "$img" sh -c '
  mkdir /tmp/x && tar -xzf /in.tar.gz -C /tmp/x && cd /tmp/x &&
  find . -type f \( -name .gitignore -o \( ! -path "*/.*" ! -path "*/openspec/*" ! -name skills-lock.json \( ! -name "*.md" -o -name README.md \) \) \) \
    -exec cp --parents {} /app/ \;'
cp "$brief/brief.md" "$w/"
cp "$t/score/screenshots/"*.jpg "$w/screenshots/" 2>/dev/null || true
podman run --rm --userns=keep-id -e HOME=/home/node -e CLAUDE_CODE_OAUTH_TOKEN -v "$w":/review:ro,Z -w /review "$img" \
  claude -p "$(cat "$here/app-review.md")" --model "$model" --effort "$effort" --output-format json \
  --json-schema "$(cat "$here/schema.json")" --allowed-tools Read Glob Grep --disallowed-tools Bash Edit Write WebFetch WebSearch \
  > "$w/out.json"
jq --arg m "$model" --arg e "$effort" --arg i "$img" '{model: $m, effort: $e, image: $i, cost_usd_api_equivalent: .total_cost_usd, review: .structured_output}' "$w/out.json" > "$w/review.json"
jq -e '.review.scores' "$w/review.json" > /dev/null || { echo "no structured review in $t" >&2; exit 1; }
mv "$w/review.json" "$t/review.json"
