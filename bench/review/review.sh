#!/bin/sh
# Blind review of one built app by a pinned model with a fixed prompt (bench/review/app-review.md) and schema.
# Runs headless in the stock arm-A image (no rules or plugins), read-only, tools limited to reading.
# Usage: bench/review/review.sh <brief-dir> <trial-dir> [model] [effort]   writes <trial-dir>/review.json
# A brief may bring its own prompt (<brief-dir>/review.md), schema (<brief-dir>/schema.json), reference images
# (<brief-dir>/review-refs/, as reference/) and a number of reviews (brief.json "reviews"; review.json, review-2.json, ...).
# Step briefs (<brief-dir>/steps/): the step texts as steps/, and diff/ built from the runner's snapshots.
set -eu
here=$(dirname "$(realpath "$0")"); brief=$(realpath "$1"); t=$(realpath "$2")
model=${3:-claude-opus-5-5}; effort=${4:-high}
prompt=$brief/review.md; [ -f "$prompt" ] || prompt=$here/app-review.md
schema=$brief/schema.json; [ -f "$schema" ] || schema=$here/schema.json
reviews=$(jq -r '.reviews // 1' "$brief/brief.json" 2>/dev/null || echo 1)
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
# Outputs stay outside the reviewer's directory, so a second review cannot read the first.
w=$(mktemp -d) && o=$(mktemp -d) && trap 'rm -rf "$w" "$o"' EXIT
mkdir -p "$w/app" "$w/screenshots"
img=$(podman image inspect benchkeeper-arm-a --format '{{.Id}}')
# Filter inside a container (no host tar on an agent-made archive), regular files only. Kept: code, tests, build and CI
# config (.github/, .gitignore, version files), README, docs, ADRs and specs (`openspec/specs`, `specs/`): they are what a
# later maintainer reads. Removed: dependencies, agent tooling and process files (.claude, .opencode, .specify, .mcp.json,
# .devcontainer from the project setup, AGENTS.md, CLAUDE.md, skills locks, `openspec/changes`, `.scratch`,
# `docs/superpowers`, `docs/agents`, `.git`).
# Step briefs: diff/step<k>.patch against the previous state (the baseline for step 1) and diff/all.patch against the
# baseline, over the files git tracks or would track (.gitignore honored, git config unused), filtered as above; and
# diff/commits.txt, the commits since the baseline. No network: git reads agent-made repositories here.
snaps=; [ ! -f "$t/base.tar.gz" ] || { snaps="-v $t/base.tar.gz:/in/base.tar.gz:ro,Z -v $t/steps:/in/steps:ro,Z"; mkdir "$w/diff"; }
# shellcheck disable=SC2086 # $snaps holds several flags
podman run --rm --network none --userns=keep-id -v "$t/score/app.tar.gz":/in.tar.gz:ro,Z $snaps -v "$w":/out:Z "$img" sh -c '
  keep() { # <dir> <target>
    (cd "$1" && find . -type f ! -path "*/node_modules/*" ! -path "./.git/*" ! -path "./.claude/*" ! -path "./.opencode/*" ! -path "./.specify/*" \
      ! -path "./.devcontainer/*" ! -path "./.scratch/*" ! -path "./openspec/changes/*" ! -path "./docs/superpowers/*" ! -path "./docs/agents/*" \
      ! -name .mcp.json ! -name AGENTS.md ! -name CLAUDE.md ! -name skills-lock.json ! -name skills.lock.json \
      ! -path "./openspec/config.yaml" ! -path "./openspec/schemas/*" ! -name "oso-change-registry.json" \
      -exec cp --parents {} "$2/" \;); }
  mkdir /tmp/x && tar -xzf /in.tar.gz -C /tmp/x && keep /tmp/x /out/app || exit 1
  [ -f /in/base.tar.gz ] || exit 0
  snap() { # <archive> <name>: /tmp/d/<name>
    mkdir -p "/tmp/s/$2" "/tmp/g/$2" "/tmp/d/$2" && tar -xzf "$1" -C "/tmp/s/$2" && cd "/tmp/s/$2" &&
    git -c safe.directory="*" -c core.fsmonitor=false ls-files -co --exclude-standard > /tmp/files &&
    while IFS= read -r f; do [ ! -f "$f" ] || cp -P --parents "$f" "/tmp/g/$2/"; done < /tmp/files && keep "/tmp/g/$2" "/tmp/d/$2"; }
  delta() { cd /tmp/d && git diff --no-index --no-color "$1" "$2" > "$3"; [ $? -le 1 ]; }
  snap /in/base.tar.gz base || exit 1; prev=base
  for k in $(ls /in/steps | grep -E "^[0-9]+\$" | sort -n); do
    [ -f "/in/steps/$k/repo.tar.gz" ] || continue
    snap "/in/steps/$k/repo.tar.gz" "$k" && delta "$prev" "$k" "/out/diff/step$k.patch" || exit 1; prev=$k
  done
  delta base "$prev" /out/diff/all.patch || exit 1
  git -c safe.directory="*" -C /tmp/x log --format="%h %s" "$(git -c safe.directory="*" -C /tmp/s/base rev-parse HEAD)..HEAD" > /out/diff/commits.txt'
if [ -d "$brief/steps" ]; then cp -r "$brief/steps" "$w/"; else cp "$brief/brief.md" "$w/"; fi
[ ! -d "$brief/review-refs" ] || cp -r "$brief/review-refs" "$w/reference"
cp "$t/score/screenshots/"*.jpg "$w/screenshots/" 2>/dev/null || true
for i in $(seq "$reviews"); do
  podman run --rm --userns=keep-id -e HOME=/home/node -e "$cred" -v "$w":/review:ro,Z -w /review "$img" \
    claude -p "$(cat "$prompt")" --model "$model" --effort "$effort" --output-format json \
    --json-schema "$(cat "$schema")" --allowed-tools Read Glob Grep --disallowed-tools Bash Edit Write WebFetch WebSearch \
    > "$o/out.json"
  jq --arg m "$model" --arg e "$effort" --arg i "$img" '{model: $m, effort: $e, image: $i, cost_usd_api_equivalent: .total_cost_usd, review: .structured_output}' "$o/out.json" > "$o/review.json"
  jq -e '.review.scores' "$o/review.json" > /dev/null || { echo "no structured review in $t" >&2; exit 1; }
  mv "$o/review.json" "$t/review$([ "$i" = 1 ] || echo "-$i").json"
done
