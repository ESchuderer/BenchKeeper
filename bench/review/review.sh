#!/bin/sh
# Blind review of one built app by a pinned model with a fixed prompt (bench/review/app-review.md) and schema.
# Runs headless in the stock arm-A image (no rules or plugins), read-only, tools limited to reading.
# Usage: bench/review/review.sh <brief-dir> <trial-dir> [model] [effort]   writes <trial-dir>/review.json
# A brief may bring its own prompt (<brief-dir>/review.md) and reference images (<brief-dir>/review-refs/, as reference/).
set -eu
here=$(dirname "$(realpath "$0")"); brief=$(realpath "$1"); t=$(realpath "$2")
model=${3:-claude-opus-5-5}; effort=${4:-high}
prompt=$brief/review.md; [ -f "$prompt" ] || prompt=$here/app-review.md
# REVIEW_AUTH=api bills the review to the API key (ANTHROPIC_API_KEY or ~/.config/benchkeeper/anthropic-api-key);
# otherwise the subscription token.
if [ "${REVIEW_AUTH:-}" = api ]; then
  : "${ANTHROPIC_API_KEY:=$(cat "$HOME/.config/benchkeeper/anthropic-api-key" 2>/dev/null)}"
  [ -n "$ANTHROPIC_API_KEY" ] || { echo "no API key" >&2; exit 1; }
  export ANTHROPIC_API_KEY; cred=ANTHROPIC_API_KEY
else
  : "${CLAUDE_CODE_OAUTH_TOKEN:=$(cat "$HOME/.config/benchkeeper/oauth-token" 2>/dev/null)}"
  [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] || { echo "no token" >&2; exit 1; }
  export CLAUDE_CODE_OAUTH_TOKEN; cred=CLAUDE_CODE_OAUTH_TOKEN
fi
w=$(mktemp -d) && trap 'rm -rf "$w"' EXIT
mkdir -p "$w/app" "$w/screenshots"
img=$(podman image inspect benchkeeper-arm-a --format '{{.Id}}')
# Filter inside a container (no host tar on an agent-made archive), regular files only. Kept: code, tests, build and CI
# config (.github/, .gitignore, version files), README, docs, ADRs and specs (`openspec/specs`, `specs/`): they are what a
# later maintainer reads. Removed: dependencies, agent tooling and process files (.claude, .opencode, .specify, .mcp.json,
# .devcontainer from the project setup, AGENTS.md, CLAUDE.md, skills locks, `openspec/changes`, `.scratch`,
# `docs/superpowers`, `docs/agents`, `.git`).
podman run --rm --userns=keep-id -v "$t/score/app.tar.gz":/in.tar.gz:ro,Z -v "$w/app":/app:Z "$img" sh -c '
  mkdir /tmp/x && tar -xzf /in.tar.gz -C /tmp/x && cd /tmp/x &&
  find . -type f ! -path "*/node_modules/*" ! -path "./.git/*" ! -path "./.claude/*" ! -path "./.opencode/*" ! -path "./.specify/*" \
    ! -path "./.devcontainer/*" ! -path "./.scratch/*" ! -path "./openspec/changes/*" ! -path "./docs/superpowers/*" ! -path "./docs/agents/*" \
    ! -name .mcp.json ! -name AGENTS.md ! -name CLAUDE.md ! -name skills-lock.json ! -name skills.lock.json \
    ! -path "./openspec/config.yaml" ! -path "./openspec/schemas/*" ! -name "oso-change-registry.json" \
    -exec cp --parents {} /app/ \;'
cp "$brief/brief.md" "$w/"
[ ! -d "$brief/review-refs" ] || cp -r "$brief/review-refs" "$w/reference"
cp "$t/score/screenshots/"*.jpg "$w/screenshots/" 2>/dev/null || true
podman run --rm --userns=keep-id -e HOME=/home/node -e "$cred" -v "$w":/review:ro,Z -w /review "$img" \
  claude -p "$(cat "$prompt")" --model "$model" --effort "$effort" --output-format json \
  --json-schema "$(cat "$here/schema.json")" --allowed-tools Read Glob Grep --disallowed-tools Bash Edit Write WebFetch WebSearch \
  > "$w/out.json"
jq --arg m "$model" --arg e "$effort" --arg i "$img" '{model: $m, effort: $e, image: $i, cost_usd_api_equivalent: .total_cost_usd, review: .structured_output}' "$w/out.json" > "$w/review.json"
jq -e '.review.scores' "$w/review.json" > /dev/null || { echo "no structured review in $t" >&2; exit 1; }
mv "$w/review.json" "$t/review.json"
