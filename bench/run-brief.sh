#!/bin/sh
# Runs one brief through the arms, k rounds, arm order shuffled per round; scores and summarizes each trial.
# Usage: bench/run-brief.sh <brief> <model> <effort> <k> <seed> [arms]   e.g. bench/run-brief.sh winery claude-opus-5-5 high 3 19
# Token: CLAUDE_CODE_OAUTH_TOKEN, or the file ~/.config/benchkeeper/oauth-token (from `claude setup-token`); never printed.
# Resumable: trials with a trial.json are skipped; delete a trial directory to rerun it.
set -eu
brief=$1 model=$2 effort=$3 k=$4 seed=$5 arms=${6:-"A B C D E F G H"}
bench=$(dirname "$(realpath "$0")"); repo=$(dirname "$bench")
NODE=docker.io/library/node:22.23.3-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562
TIMEOUT=${TIMEOUT:-5400}
FOLLOWUP="Continue until the brief is fully implemented and npm start runs the app. Do not wait for approval."
: "${CLAUDE_CODE_OAUTH_TOKEN:=$(cat "$HOME/.config/benchkeeper/oauth-token" 2>/dev/null)}"
[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] || { echo "no token: set CLAUDE_CODE_OAUTH_TOKEN or write ~/.config/benchkeeper/oauth-token" >&2; exit 1; }
export CLAUDE_CODE_OAUTH_TOKEN
runs=$bench/runs/$brief-$model-$effort-seed$seed
mkdir -p "$runs"

for arm in $arms; do
  podman build -q -f "$bench/image/Containerfile" --build-arg ARM="$arm" -t "benchkeeper-arm-$(echo "$arm" | tr A-Z a-z)" "$repo" > /dev/null
done
{
  echo "brief=$brief model=$model effort=$effort k=$k seed=$seed timeout=${TIMEOUT}s"
  echo "benchkeeper=$(git -C "$repo" rev-parse HEAD) dirty=$(git -C "$repo" status --porcelain | wc -l)"
  echo "host=$(uname -srm) cpu=$(nproc) mem=$(free -g | awk '/Mem/{print $2}')G $(podman --version)"
} >> "$runs/manifest.txt"
# A resumed run must use the same images as its first trials.
for arm in $arms; do
  id=$(podman image inspect "benchkeeper-arm-$(echo "$arm" | tr A-Z a-z)" --format '{{.Id}}')
  first=$(awk -v a="$arm" '$1 == "image" && $2 == a {print $3; exit}' "$runs/manifest.txt")
  [ -z "$first" ] || [ "$first" = "$id" ] || { echo "image for arm $arm changed since the first trials of this run" >&2; exit 1; }
  echo "image $arm $id" >> "$runs/manifest.txt"
done

for r in $(seq "$k"); do
  order=$(printf '%s\n' $arms | awk -v s="$((seed * 100 + r))" 'BEGIN{srand(s)}{print rand()"\t"$0}' | sort | cut -f2 | tr '\n' ' ')
  echo "round $r order $order" >> "$runs/manifest.txt"
  for arm in $order; do
    t=$runs/round-$r/$arm
    [ -f "$t/trial.json" ] && continue
    set +e
    # A finished agent run is never repeated: on resume only scoring and parsing run again.
    if [ ! -f "$t/agent.exit" ]; then
    rm -rf "$t" && mkdir -p "$t/workspace" "$t/log"
    echo "$(date -Is) round $r arm $arm start" | tee -a "$runs/manifest.txt"
    # BenchKeeper arms start from the project state /project-setup leaves, committed as the first commit.
    case $arm in C|D|E) podman run --rm --userns=keep-id -e HOME=/home/node -v "$t/workspace":/work:Z -w /work "benchkeeper-arm-$(echo "$arm" | tr A-Z a-z)" \
      sh -c 'cp -a ~/project-template/. . && git init -q && git add -A -- . ":!.claude/settings.local.json" && git commit -qm "chore: project setup"' \
      || { echo "project setup for arm $arm failed" >&2; exit 1; } ;;
    esac
    start=$(date +%s) && echo "$start" > "$t/start"
    # The container lives for the whole trial, so follow-up turns continue the same session; removed on any exit.
    c=bk-$brief-r$r-$arm
    podman rm -f "$c" > /dev/null 2>&1
    trap 'podman rm -f "$c" > /dev/null 2>&1' EXIT INT TERM
    podman run -d --rm --name "$c" --timeout "$((TIMEOUT + 300))" --userns=keep-id -e HOME=/home/node -e CLAUDE_CODE_OAUTH_TOKEN \
      -v "$t/workspace":/work:Z -v "$t/log":/bench-log:Z -w /work "benchkeeper-arm-$(echo "$arm" | tr A-Z a-z)" sleep infinity > /dev/null
    turn() { # <prompt> [--continue]; runs one agent turn within the trial's remaining time
      rem=$((TIMEOUT - ($(date +%s) - start)))
      [ "$rem" -gt 0 ] || return 124
      podman exec "$c" timeout -k 30 "$rem" claude -p "$1" ${2:-} --model "$model" --effort "$effort" \
        --output-format stream-json --verbose --include-hook-events --dangerously-skip-permissions \
        --debug-file /bench-log/debug.log >> "$t/transcript.jsonl" 2>> "$t/log/stderr.log"
    }
    turn "$(cat "$bench/briefs/$brief/brief.md")"; rc=$?
    # Follow-up rule: while the agent stops without a runnable app (no start script), the same fixed message, at most twice.
    n=0
    while [ "$n" -lt 2 ] && [ $((TIMEOUT - ($(date +%s) - start))) -gt 0 ] && ! jq -e '.scripts.start' "$t/workspace/package.json" > /dev/null 2>&1; do
      n=$((n + 1))
      turn "$FOLLOWUP" --continue; rc=$?
    done
    podman rm -f "$c" > /dev/null; trap - EXIT INT TERM
    # Written last: a trial interrupted before this point is rerun from scratch on resume.
    echo "$n" > "$t/followups" && date +%s > "$t/end" && echo "$rc" > "$t/agent.exit"
    fi
    { grep -rqF -- "$CLAUDE_CODE_OAUTH_TOKEN" "$t" || git -C "$t/workspace" log -p --all 2>/dev/null | grep -qF -- "$CLAUDE_CODE_OAUTH_TOKEN"; } \
      && { echo "token found in $t: remove it before publishing" >&2; exit 1; }
    rm -rf "$t/score"
    "$bench/scorer/score.sh" "$bench/briefs/$brief" "$t/workspace" "$t/score" > "$t/log/score.log" 2>&1
    set -e
    podman run --rm --userns=keep-id -e HOME=/tmp -v "$repo":/repo:ro,Z -v "$t":/t:Z -w /repo "$NODE" node bench/scripts/trial.mjs /t "$arm"
    echo "$(date -Is) round $r arm $arm done: $(jq -c '{audit: .audit.ok, features: .score.features_passed, cost: .outcome.cost_usd_api_equivalent}' "$t/trial.json")" | tee -a "$runs/manifest.txt"
  done
done
