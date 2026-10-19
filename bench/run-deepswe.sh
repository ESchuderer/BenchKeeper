#!/bin/sh
# DeepSWE pilot (datacurve-ai/deep-swe, pinned): each task in each arm, k = 1, arm order shuffled per task.
# Usage: bench/run-deepswe.sh <model> <effort> <seed> "<arms>" "<task ids>"
# Agent: Claude Code 2.1.299 and the arm's ~/.claude from benchkeeper-arm-<arm>, copied into the task's own image (the
# repository at /app on the base commit, its toolchain installed), with the network (the model API) and the subscription
# token; root in the container with IS_SANDBOX=1, as the task images run. Prompt: the task's instruction.md, then the
# follow-up rule of bench/run-brief.sh (at most 2). Grading as upstream: `git diff --binary <base> HEAD` (the task's
# collect command) applied in the verifier image (tests/Dockerfile), /tests/test.sh without network, reward.json.
# Resumable: trials with a reward.json are skipped. Upstream harness (Pier) not used: it needs Docker and copies only
# ~/.claude/skills, not an arm's plugins, rules and settings.
set -eu
model=$1 effort=$2 seed=$3 arms=$4 tasks=$5
bench=$(dirname "$(realpath "$0")")
DEEPSWE=0b9fabbb63b9104d678fe965e1632f2dd9eaa2ea
TIMEOUT=${TIMEOUT:-10800}
FOLLOWUP="Continue until the task is complete in the repository. Do not wait for approval."
: "${CLAUDE_CODE_OAUTH_TOKEN:=$(cat "$HOME/.config/benchkeeper/oauth-token" 2>/dev/null)}"
[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] || { echo "no token: set CLAUDE_CODE_OAUTH_TOKEN or write ~/.config/benchkeeper/oauth-token" >&2; exit 1; }
export CLAUDE_CODE_OAUTH_TOKEN
src=$bench/deepswe/.cache/deep-swe-$DEEPSWE
if [ ! -d "$src" ]; then
  rm -rf "$src.tmp" && git init -q "$src.tmp" && git -C "$src.tmp" fetch -q --depth 1 https://github.com/datacurve-ai/deep-swe "$DEEPSWE"
  git -C "$src.tmp" checkout -q FETCH_HEAD && mv "$src.tmp" "$src"
fi
runs=$bench/runs/deepswe-$model-$effort-seed$seed
mkdir -p "$runs"
{
  echo "deepswe=$DEEPSWE model=$model effort=$effort seed=$seed timeout=${TIMEOUT}s arms=$arms tasks=$tasks"
  echo "benchkeeper=$(git -C "$bench/.." rev-parse HEAD) dirty=$(git -C "$bench/.." status --porcelain | wc -l)"
} >> "$runs/manifest.txt"

# Same final-message test as bench/run-brief.sh (protocol v1.21: WAITS on any line of the final message).
WAITS='once you (confirm|approve)|after you (confirm|approve)|ready for your (approval|confirmation|review)|(shall|should) i (continue|proceed|start|go on|implement|build)|do you want me to (continue|proceed|start|implement|build)|would you like me to (continue|proceed|start|implement|build)|waiting for (your|approval|confirmation)|ready to (continue|proceed|implement|build) when|answer the questions|once you answer|after you answer|i can.t (start|begin|continue|proceed) (yet|until)|which of these is (true|right|correct)|please run [^ ]*setting-up-projects|(i.ll|i will) wait for|not done yet|what i need from you|run [^ ]*setting-up-projects'
waiting() { awk 'NF { l = $0 } NF && !/for the full setup/ { print } END { if (l ~ /\?[[:space:]]*$/) print "LAST-LINE-QUESTION" }' | grep -Eiq "LAST-LINE-QUESTION|$WAITS"; }
waits() { jq -Rrn '[inputs | fromjson? | select(.type == "result") | .result] | last // ""' < "$t/transcript.jsonl" 2> /dev/null | waiting; }
# Subscription gate as in bench/run-brief.sh: wait for the 5-hour reset at USAGE_MAX or bench/usage-max (default 0.70).
usage() {
  podman run --rm -e HOME=/home/node -e CLAUDE_CODE_OAUTH_TOKEN -e ANTHROPIC_LOG=debug benchkeeper-arm-a \
    claude -p "Reply OK" --model claude-haiku-5-5 --max-turns 1 2>&1 \
    | awk -F'"' '/ratelimit-unified-5h-utilization/ {u=$4} /ratelimit-unified-5h-reset/ {r=$4} END {print u+0, r+0}'
}
gate() {
  while :; do
    set -- $(usage)
    echo "$(date -Is) usage 5h $1" >> "$runs/manifest.txt"
    awk -v u="$1" -v m="${USAGE_MAX:-$(cat "$bench/usage-max" 2>/dev/null || echo 0.70)}" 'BEGIN { exit !(u >= m) }' || return 0
    echo "$(date -Is) waiting for the 5h reset at $(date -d "@$2" -Is)" >> "$runs/manifest.txt"
    sleep $(( $2 - $(date +%s) + 60 > 60 ? $2 - $(date +%s) + 60 : 300 ))
  done
}

for arm in $arms; do
  podman build -q -f "$bench/image/Containerfile" --build-arg ARM="$arm" -t "benchkeeper-arm-$(echo "$arm" | tr A-Z a-z)" "$bench/.." > /dev/null
done
i=0
for task in $tasks; do
  i=$((i + 1))
  d=$src/tasks/$task
  image=$(awk -F'"' '/^docker_image/ {print $2}' "$d/task.toml")
  base=$(awk -F'"' '/^base_commit_hash/ {print $2}' "$d/task.toml")
  podman pull -q "$image" > /dev/null
  podman build -q -t "bk-deepswe-verify-$task" "$d/tests" > /dev/null
  order=$(printf '%s\n' $arms | awk -v s="$((seed * 100 + i))" 'BEGIN{srand(s)}{print rand()"\t"$0}' | sort | cut -f2 | tr '\n' ' ')
  echo "task $task image $image order $order" >> "$runs/manifest.txt"
  for arm in $order; do
    t=$runs/$task/$arm
    [ -f "$t/reward.json" ] && continue
    a=benchkeeper-arm-$(echo "$arm" | tr A-Z a-z)
    img=bk-deepswe-$(echo "$arm" | tr A-Z a-z)-$task
    # The task image plus the arm: Claude Code and node under /opt/bk (after the task's own PATH), the arm's home.
    printf 'FROM %s AS arm\nFROM %s\nCOPY --from=arm /usr/local/lib/node_modules/@anthropic-ai/claude-code /opt/bk/claude-code\nCOPY --from=arm /usr/local/bin/node /opt/bk/bin/node\nCOPY --from=arm /home/node /home/node\nRUN ln -s /opt/bk/claude-code/bin/claude.exe /opt/bk/bin/claude\nENV PATH=$PATH:/opt/bk/bin:/home/node/.local/bin DISABLE_AUTOUPDATER=1 IS_SANDBOX=1 HOME=/home/node\n' "$a" "$image" \
      | podman build -q -t "$img" -f - "$bench" > /dev/null
    echo "image $task $arm $(podman image inspect "$img" --format '{{.Id}}')" >> "$runs/manifest.txt"
    gate
    rm -rf "$t" && mkdir -p "$t/logs" && touch "$t/transcript.jsonl"
    echo "$(date -Is) task $task arm $arm start" >> "$runs/manifest.txt"
    start=$(date +%s) && echo "$start" > "$t/start"
    c=bk-deepswe-$$-$arm
    trap 'podman rm -f "$c" > /dev/null 2>&1' EXIT
    trap 'exit 130' INT TERM HUP
    podman run -d --rm --name "$c" --timeout "$((TIMEOUT + 600))" --cpus 2 --memory 8g -e CLAUDE_CODE_OAUTH_TOKEN \
      -v "$t/logs":/bench-log:Z -w /app "$img" sleep infinity > /dev/null
    # Arms with a project template (BenchKeeper layer): its files the repository lacks, git-excluded so the patch keeps
    # only the agent's work.
    podman exec "$c" sh -c '[ ! -d ~/project-template ] || { cd ~/project-template && find . -type f | while read -r f; do
      [ -e "/app/$f" ] || { mkdir -p "/app/${f%/*}" && cp "$f" "/app/$f" && echo "/${f#./}" >> /app/.git/info/exclude; }; done; }'
    turn() { # [--continue]
      rem=$((TIMEOUT - ($(date +%s) - start)))
      [ "$rem" -gt 0 ] || return 124
      p=$( [ -n "${1:-}" ] && echo "$FOLLOWUP" || cat "$d/instruction.md")
      podman exec "$c" timeout -k 30 "$rem" claude -p "$p" ${1:-} --model "$model" --effort "$effort" \
        --output-format stream-json --verbose --include-hook-events --dangerously-skip-permissions \
        --debug-file /bench-log/debug.log >> "$t/transcript.jsonl" 2>> "$t/logs/stderr.log" &
      wait $!
    }
    set +e
    turn; rc=$?
    n=0
    while [ "$n" -lt 2 ] && [ $((TIMEOUT - ($(date +%s) - start))) -gt 0 ] && waits; do n=$((n + 1)); turn --continue; rc=$?; done
    podman exec "$c" sh -c "cd /app && git config --global --add safe.directory /app && git diff --binary $base HEAD" > "$t/model.patch"
    podman exec "$c" sh -c 'cd /app && git status --porcelain' > "$t/uncommitted.txt"
    podman rm -f "$c" > /dev/null; trap - EXIT INT TERM HUP
    echo "$n" > "$t/followups" && date +%s > "$t/end" && echo "$rc" > "$t/agent.exit"
    grep -rqF -- "$CLAUDE_CODE_OAUTH_TOKEN" "$t" && { echo "token found in $t: remove it before publishing" >&2; exit 1; }
    mkdir -p "$t/verifier/artifacts" "$t/verifier/verifier" && cp "$t/model.patch" "$t/verifier/artifacts/model.patch"
    podman run --rm --network none --timeout 1800 --cpus 2 --memory 8g -v "$t/verifier":/logs:Z "bk-deepswe-verify-$task" \
      /tests/test.sh > "$t/verify.log" 2>&1
    set -e
    if [ -f "$t/verifier/verifier/reward.json" ]; then cp "$t/verifier/verifier/reward.json" "$t/reward.json"
    else echo '{"reward":0,"error":"no reward.json"}' > "$t/reward.json"; fi
    echo "$(date -Is) task $task arm $arm done: $(jq -c '{reward, f2p, p2p, partial}' "$t/reward.json") skills $(jq -rc 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and .name=="Skill") | .input.skill' "$t/transcript.jsonl" | sort | uniq -c | tr -s ' \n' ' ')" >> "$runs/manifest.txt"
  done
done
