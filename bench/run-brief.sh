#!/bin/sh
# Runs one brief through the arms, k rounds, arm order shuffled per round; scores and summarizes each trial.
# Usage: bench/run-brief.sh <brief> <model> <effort> <k> <seed> [arms]   e.g. bench/run-brief.sh winery claude-opus-5-5 high 3 19
# Token: CLAUDE_CODE_OAUTH_TOKEN, or the file ~/.config/benchkeeper/oauth-token (from `claude setup-token`); never printed.
# Resumable: trials with a trial.json are skipped; delete a trial directory to rerun it.
set -eu
brief=$1 model=$2 effort=$3 k=$4 seed=$5 arms=${6:-"A B C D E"}
bench=$(dirname "$(realpath "$0")"); repo=$(dirname "$bench")
NODE=docker.io/library/node:22.23.3-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562
TIMEOUT=${TIMEOUT:-90m}
: "${CLAUDE_CODE_OAUTH_TOKEN:=$(cat "$HOME/.config/benchkeeper/oauth-token")}"
export CLAUDE_CODE_OAUTH_TOKEN
runs=$bench/runs/$brief-$model-$effort-seed$seed
mkdir -p "$runs"

for arm in $arms; do
  podman build -q -f "$bench/image/Containerfile" --build-arg ARM="$arm" -t "benchkeeper-arm-$(echo "$arm" | tr A-Z a-z)" "$repo" > /dev/null
done
{
  echo "brief=$brief model=$model effort=$effort k=$k seed=$seed timeout=$TIMEOUT"
  echo "benchkeeper=$(git -C "$repo" rev-parse HEAD) dirty=$(git -C "$repo" status --porcelain | wc -l)"
  echo "host=$(uname -srm) cpu=$(nproc) mem=$(free -g | awk '/Mem/{print $2}')G $(podman --version)"
  for arm in $arms; do echo "image $arm $(podman image inspect "benchkeeper-arm-$(echo "$arm" | tr A-Z a-z)" --format '{{.Id}}')"; done
} >> "$runs/manifest.txt"

for r in $(seq "$k"); do
  order=$(printf '%s\n' $arms | awk -v s="$((seed * 100 + r))" 'BEGIN{srand(s)}{print rand()"\t"$0}' | sort | cut -f2 | tr '\n' ' ')
  echo "round $r order $order" >> "$runs/manifest.txt"
  for arm in $order; do
    t=$runs/round-$r/$arm
    [ -f "$t/trial.json" ] && continue
    rm -rf "$t" && mkdir -p "$t/workspace" "$t/log"
    echo "$(date -Is) round $r arm $arm start" | tee -a "$runs/manifest.txt"
    set +e
    timeout "$TIMEOUT" podman run --rm --userns=keep-id -e HOME=/home/node -e CLAUDE_CODE_OAUTH_TOKEN \
      -v "$t/workspace":/work:Z -v "$t/log":/bench-log:Z -w /work "benchkeeper-arm-$(echo "$arm" | tr A-Z a-z)" \
      claude -p "$(cat "$bench/briefs/$brief/brief.md")" --model "$model" --effort "$effort" \
      --output-format stream-json --verbose --include-hook-events --dangerously-skip-permissions \
      --debug-file /bench-log/debug.log > "$t/transcript.jsonl" 2> "$t/log/stderr.log"
    echo $? > "$t/agent.exit"
    "$bench/scorer/score.sh" "$bench/briefs/$brief" "$t/workspace" "$t/score" > "$t/log/score.log" 2>&1
    set -e
    podman run --rm --userns=keep-id -e HOME=/tmp -v "$repo":/repo:ro,Z -v "$t":/t:Z -w /repo "$NODE" node bench/scripts/trial.mjs /t "$arm"
    echo "$(date -Is) round $r arm $arm done: $(jq -c '{audit: .audit.ok, features: .score.features_passed, cost: .outcome.cost_usd_api_equivalent}' "$t/trial.json")" | tee -a "$runs/manifest.txt"
  done
done
