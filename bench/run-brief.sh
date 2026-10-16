#!/bin/sh
# Runs one brief through the arms, k rounds, arm order shuffled per round; scores and summarizes each trial.
# Usage: bench/run-brief.sh <brief> <model> <effort> <k> <seed> [arms]   e.g. bench/run-brief.sh winery claude-opus-5-5 high 3 19
# Credentials, never printed: Claude Code arms use the subscription token (CLAUDE_CODE_OAUTH_TOKEN or the file
# ~/.config/benchkeeper/oauth-token, from `claude setup-token`); OpenCode arms (Q to U) use an Anthropic API key
# (ANTHROPIC_API_KEY or ~/.config/benchkeeper/anthropic-api-key). Each container gets only its own runtime's credential.
# Resumable: trials with a trial.json are skipped; delete a trial directory to rerun it. Runners for different arm groups
# can share one run: an arm another live runner has claimed is skipped (`claim`).
set -eu
brief=$1 model=$2 effort=$3 k=$4 seed=$5 arms=${6:-"A B C D E F G H I J K L M N O P V W X Y"}
bench=$(dirname "$(realpath "$0")"); repo=$(dirname "$bench")
NODE=docker.io/library/node:22.23.3-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562
TIMEOUT=${TIMEOUT:-5400}
PW=mcr.microsoft.com/playwright:v1.64.0-noble@sha256:bc72a8df40831ded821e3cbc79c318c21b44d6e51dff9fd89ace7a8249c5b462
# Per-brief settings (bench/briefs/<brief>/brief.json, optional): follow-up message and how the app is served.
conf=$bench/briefs/$brief/brief.json
FOLLOWUP=$(jq -r '.followup // empty' "$conf" 2>/dev/null || true)
: "${FOLLOWUP:=Continue until the brief is fully implemented and npm start runs the app. Do not wait for approval.}"
serve=$(jq -r '.serve // "npm"' "$conf" 2>/dev/null || echo npm)
# Final-message phrases that wait for the user (follow-up rule, protocol v1.8); `bench/scripts/waits.test.sh` checks them.
WAITS='once you (confirm|approve)|after you (confirm|approve)|ready for your (approval|confirmation|review)|(shall|should) i (continue|proceed|start|go on|implement|build)|do you want me to (continue|proceed|start|implement|build)|would you like me to (continue|proceed|start|implement|build)|waiting for (your|approval|confirmation)|ready to (continue|proceed|implement|build) when'
# Reads a final message on stdin; true when its last non-empty line ends with "?" or its last 5 lines match WAITS.
waiting() { awk 'NF { l[++n] = $0 } END { for (i = (n > 5 ? n - 4 : 1); i <= n; i++) print l[i]; if (n && l[n] ~ /\?[[:space:]]*$/) print "LAST-LINE-QUESTION" }' \
  | grep -Eiq "LAST-LINE-QUESTION|$WAITS"; }
runtime() { case $1 in Q|R|S|T|U|Z|AA) echo opencode ;; *) echo claude ;; esac; }
needs() { for a in $arms; do [ "$(runtime "$a")" = "$1" ] && return 0; done; return 1; }
if needs claude; then
  : "${CLAUDE_CODE_OAUTH_TOKEN:=$(cat "$HOME/.config/benchkeeper/oauth-token" 2>/dev/null)}"
  [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] || { echo "no token: set CLAUDE_CODE_OAUTH_TOKEN or write ~/.config/benchkeeper/oauth-token" >&2; exit 1; }
fi
if needs opencode; then
  : "${ANTHROPIC_API_KEY:=$(cat "$HOME/.config/benchkeeper/anthropic-api-key" 2>/dev/null)}"
  [ -n "$ANTHROPIC_API_KEY" ] || { echo "no API key: set ANTHROPIC_API_KEY or write ~/.config/benchkeeper/anthropic-api-key" >&2; exit 1; }
fi
export CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY
# OpenCode isolation, every turn: no Claude Code or .agents files, no autoupdate, the model catalog fetched at build.
OC_ENV="-e OPENCODE_DISABLE_CLAUDE_CODE=1 -e OPENCODE_DISABLE_EXTERNAL_SKILLS=1 -e OPENCODE_DISABLE_AUTOUPDATE=1 -e OPENCODE_DISABLE_LSP_DOWNLOAD=1 -e OPENCODE_DISABLE_MODELS_FETCH=1"
# SCAFFOLD=1: the trial starts from the brief's skeleton workspace (bench/briefs/<brief>/scaffold/), a run of its own.
runs=$bench/runs/$brief-$model-$effort-seed$seed$([ "${SCAFFOLD:-}" != 1 ] || echo -scaffold)
mkdir -p "$runs"

# SKIP_BUILD=1 uses the existing images (for parallel runners after one build).
[ "${SKIP_BUILD:-}" = 1 ] || for arm in $arms; do
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

# Subscription gate (Claude Code arms): before each trial, read the 5-hour window's utilization from the rate-limit
# headers of a one-word request; at the threshold or above, wait until the window resets. Threshold: USAGE_MAX, else
# the file bench/usage-max (read before every trial, so running runners follow a change), else 0.70. The 7-day window
# waits for its reset at WEEKLY_MAX (default 0.98), so a trial does not start right before the weekly limit stops it.
threshold() { [ -n "${USAGE_MAX:-}" ] && echo "$USAGE_MAX" || cat "$bench/usage-max" 2>/dev/null || echo 0.70; }
usage() { # prints "<5h utilization> <5h reset epoch> <7d utilization> <7d reset epoch>"
  podman run --rm -e HOME=/home/node -e CLAUDE_CODE_OAUTH_TOKEN -e ANTHROPIC_LOG=debug benchkeeper-arm-a \
    claude -p "Reply OK" --model claude-haiku-5-5 --max-turns 1 2>&1 \
    | awk -F'"' '/ratelimit-unified-5h-utilization/ {u=$4} /ratelimit-unified-5h-reset/ {r=$4} /ratelimit-unified-7d-utilization/ {w=$4} /ratelimit-unified-7d-reset/ {wr=$4} END {print u+0, r+0, w+0, wr+0}'
}
gate() {
  [ "$(runtime "$1")" = claude ] || return 0
  while :; do
    set -- $(usage)
    echo "$(date -Is) usage 5h $1 weekly $3" >> "$runs/manifest.txt"
    if awk -v w="$3" -v m="${WEEKLY_MAX:-0.98}" 'BEGIN { exit !(w >= m) }'; then
      set -- "$1" "$4"
      echo "$(date -Is) waiting for the weekly reset at $(date -d "@$2" -Is)" | tee -a "$runs/manifest.txt"
    else
      awk -v u="$1" -v m="$(threshold)" 'BEGIN { exit !(u >= m) }' || return 0
      echo "$(date -Is) waiting for the 5h reset at $(date -d "@$2" -Is)" | tee -a "$runs/manifest.txt"
    fi
    sleep $(( $2 - $(date +%s) + 60 > 60 ? $2 - $(date +%s) + 60 : 300 ))
  done
}

# Several runners on one run (one per arm group) claim each arm with a symlink to their PID (`ln -s` is atomic), so a
# runner never deletes a trial another live runner is running; a dead runner's claim is taken over.
# shortcut: two runners taking over the same dead claim at once can both hold it; run one runner per arm group.
claim() { # <claim path>; true when this runner holds it
  mkdir -p "${1%/*}"
  ln -s "$$" "$1" 2> /dev/null && return
  owner=$(readlink "$1") || return 1
  [ "$owner" = "$$" ] && return
  ! kill -0 "$owner" 2> /dev/null || return 1
  rm -f "$1" && ln -s "$$" "$1" 2> /dev/null
}

for r in $(seq "$k"); do
  order=$(printf '%s\n' $arms | awk -v s="$((seed * 100 + r))" 'BEGIN{srand(s)}{print rand()"\t"$0}' | sort | cut -f2 | tr '\n' ' ')
  echo "round $r order $order" >> "$runs/manifest.txt"
  for arm in $order; do
    t=$runs/round-$r/$arm
    rt=$(runtime "$arm")
    c=$runs/.claims/round-$r-$arm
    claim "$c" || { echo "$(date -Is) round $r arm $arm skipped: runner $(readlink "$c") runs it" >> "$runs/manifest.txt"; continue; }
    [ -f "$t/trial.json" ] && { rm -f "$c"; continue; }
    set +e
    # A finished agent run is never repeated: on resume only scoring and parsing run again.
    if [ ! -f "$t/agent.exit" ]; then
    gate "$arm"
    rm -rf "$t" && mkdir -p "$t/workspace" "$t/log"
    # PHASES=1: per-phase and per-subagent measurements for this trial (bench/scripts/phases.mjs).
    [ "${PHASES:-}" != 1 ] || touch "$t/log/phases"
    echo "${BK:-v1}" > "$t/bk"
    echo "$(date -Is) round $r arm $arm start" | tee -a "$runs/manifest.txt"
    # Arms with a project (BenchKeeper layer or a spec tool) start from the image's ~/project-template, committed first.
    podman run --rm --userns=keep-id -e HOME=/home/node -v "$t/workspace":/work:Z -w /work "benchkeeper-arm-$(echo "$arm" | tr A-Z a-z)" \
      sh -c '[ ! -d ~/project-template ] || [ -z "$(ls -A ~/project-template)" ] || { cp -a ~/project-template/. . && git init -q && git add -A -- . ":!.claude/settings.local.json" && { git diff --cached --quiet || git commit -qm "chore: project setup"; }; }' \
      || { echo "project setup for arm $arm failed" >&2; exit 1; }
    if [ "${SCAFFOLD:-}" = 1 ]; then
      cp -a "$bench/briefs/$brief/scaffold/." "$t/workspace/" && echo scaffold > "$t/condition"
      podman run --rm --userns=keep-id -e HOME=/home/node -v "$t/workspace":/work:Z -w /work "benchkeeper-arm-$(echo "$arm" | tr A-Z a-z)" \
        sh -c '[ ! -d .git ] || { git add -A && git commit -qm "chore: scaffold"; }' || { echo "scaffold for arm $arm failed" >&2; exit 1; }
    fi
    start=$(date +%s) && echo "$start" > "$t/start"
    # The container lives for the whole trial, so follow-up turns continue the same session; removed on any exit.
    c=bk-$$-r$r-$arm
    trap 'podman rm -f "$c" > /dev/null 2>&1' EXIT
    trap 'exit 130' INT TERM HUP
    if [ "$rt" = opencode ]; then cred="-e ANTHROPIC_API_KEY $OC_ENV"; else cred="-e CLAUDE_CODE_OAUTH_TOKEN"; fi
    # shellcheck disable=SC2086 # $cred holds several flags
    podman run -d --rm --name "$c" --timeout "$((TIMEOUT + 300))" --userns=keep-id -e HOME=/home/node $cred \
      -v "$t/workspace":/work:Z -v "$t/log":/bench-log:Z -w /work "benchkeeper-arm-$(echo "$arm" | tr A-Z a-z)" sleep infinity > /dev/null
    # OpenCode has no init event: record the skills and configuration it resolves, for the delivery audit.
    [ "$rt" != opencode ] || podman exec "$c" sh -c 'opencode debug skill > /bench-log/opencode-skills.json && opencode debug config > /bench-log/opencode-config.json'
    turn() { # <prompt> [--continue]; runs one agent turn within the trial's remaining time
      rem=$((TIMEOUT - ($(date +%s) - start)))
      [ "$rem" -gt 0 ] || return 124
      # In the background so INT or TERM interrupts the wait at once (the trap exits; the EXIT trap removes the container).
      if [ "$rt" = opencode ]; then
        podman exec "$c" timeout -k 30 "$rem" opencode run ${2:-} --model "anthropic/$model" --variant "$effort" --format json --auto \
          "$1" >> "$t/transcript.jsonl" 2>> "$t/log/stderr.log" &
      else
        podman exec "$c" timeout -k 30 "$rem" claude -p "$1" ${2:-} --model "$model" --effort "$effort" \
          --output-format stream-json --verbose --include-hook-events --dangerously-skip-permissions \
          --debug-file /bench-log/debug.log >> "$t/transcript.jsonl" 2>> "$t/log/stderr.log" &
      fi
      wait $!
    }
    turn "$(cat "$bench/briefs/$brief/brief.md")"; rc=$?
    # Follow-up rule: while the agent stops without a running app, or with a final message that waits for confirmation,
    # the same fixed message, at most twice. Running means: a start script, and `npm install`, `npm run build --if-present`
    # and `npm start` serve the start page within 20 s, checked on a copy so the workspace keeps only what the agent wrote;
    # for a static brief, index.html loads from file:// without page errors (Chromium in the Playwright image, on a copy).
    runs_app() {
      if [ "$serve" = static ]; then
        cpy=$(mktemp -d) && tar -C "$t/workspace" --exclude=./node_modules --exclude=./.git -cf - . | tar -C "$cpy" -xf -
        # Shared label (z) on the scorer files: parallel runners mount them at the same time.
        podman run --rm --timeout 120 --userns=keep-id -e HOME=/tmp -v "$cpy":/w:ro,Z \
          -v "$bench/scorer/node_modules":/s/node_modules:ro,z -v "$bench/scorer/opens.mjs":/s/opens.mjs:ro,z -w /s "$PW" \
          node opens.mjs /w > /dev/null 2>&1; ok=$?
        rm -rf "$cpy"; return $ok
      fi
      podman exec "$c" sh -c 'rm -rf /tmp/check && cp -a /work /tmp/check && cd /tmp/check && jq -e .scripts.start package.json > /dev/null 2>&1 \
        && npm install --no-audit --no-fund > /dev/null 2>&1 && npm run build --if-present > /dev/null 2>&1 || exit 1
        PORT=3999 STAFF_PASSWORD=bench-check setsid npm start > /dev/null 2>&1 & p=$!
        ok=1; for i in $(seq 20); do node -e "fetch(\"http://localhost:3999/\").then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" && { ok=0; break; }; sleep 1; done
        kill -TERM -- -$p 2> /dev/null; sleep 1; kill -KILL -- -$p 2> /dev/null; exit $ok'
    }
    # The agent's final message waits for the user: its last line is a question, or its last lines ask for confirmation.
    waits() {
      jq -Rrn '[inputs | fromjson? | if .type == "result" then .result elif .type == "text" then .part.text else empty end] | last // ""' \
        "$t/transcript.jsonl" 2> /dev/null | waiting
    }
    n=0
    while [ "$n" -lt 2 ] && [ $((TIMEOUT - ($(date +%s) - start))) -gt 0 ] && { ! runs_app || waits; }; do
      n=$((n + 1))
      turn "$FOLLOWUP" --continue; rc=$?
    done
    # Iterative briefs (bench/briefs/<brief>/changes/<k>.md): score the step just finished with the hidden tests of all
    # steps so far (checkpoints/<k>/), then send the next change request in the same session, with the same follow-up
    # rule. The last step is scored like any trial (score/, every hidden test).
    upto() { (cd "$bench/briefs/$brief/hidden" && i=1 && f=acceptance.spec.mjs && while [ "$i" -le "$1" ]; do f="$f $(ls s$i-*.spec.mjs)"; i=$((i + 1)); done && echo "$f"); }
    k=0
    for ch in $(ls "$bench/briefs/$brief/changes/" 2>/dev/null | grep -E '^[0-9]+\.md$' | sort -n); do
      MUTATION=0 HIDDEN_FILES=$(upto "$k") "$bench/scorer/score.sh" "$bench/briefs/$brief" "$t/workspace" "$t/checkpoints/$k" > "$t/log/score-$k.log" 2>&1
      k=$((k + 1))
      [ $((TIMEOUT - ($(date +%s) - start))) -gt 0 ] || break
      turn "$(cat "$bench/briefs/$brief/changes/$ch")" --continue; rc=$?
      m=0
      while [ "$m" -lt 2 ] && [ $((TIMEOUT - ($(date +%s) - start))) -gt 0 ] && { ! runs_app || waits; }; do
        m=$((m + 1)); n=$((n + 1))
        turn "$FOLLOWUP" --continue; rc=$?
      done
    done
    [ ! -d "$bench/briefs/$brief/changes" ] || echo "$k" > "$t/steps"
    # OpenCode streams only the main session: export every session for tokens and cost. `session list` shows only
    # root sessions, so subagent sessions are found through the task calls that started them.
    [ "$rt" != opencode ] || podman exec "$c" sh -c 'opencode session list --format json | jq -r ".[].id" > /tmp/todo
      while [ -s /tmp/todo ]; do
        : > /tmp/next
        for s in $(cat /tmp/todo); do
          [ ! -f "/bench-log/session-$s.json" ] || continue
          opencode export "$s" > "/bench-log/session-$s.json"
          jq -r ".messages[].parts[] | select(.type == \"tool\" and .tool == \"task\") | .state.metadata.sessionId // empty" "/bench-log/session-$s.json" >> /tmp/next
        done
        mv /tmp/next /tmp/todo
      done' 2>> "$t/log/stderr.log"
    podman rm -f "$c" > /dev/null; trap - EXIT INT TERM HUP
    # Written last: a trial interrupted before this point is rerun from scratch on resume.
    echo "$n" > "$t/followups" && date +%s > "$t/end" && echo "$rc" > "$t/agent.exit"
    fi
    # Every git object of every repository in the workspace, read in a container (the host never runs git on
    # agent-written config); fails closed when the dump fails.
    objs=$(mktemp)
    podman run --rm --userns=keep-id -v "$t/workspace":/w:ro,Z benchkeeper-arm-a sh -c \
      'find /w -name .git -type d -prune | while read -r g; do git -c safe.directory="*" --git-dir="$g" cat-file --batch-all-objects --batch || exit 1; done' > "$objs" \
      || { echo "git object scan failed for $t" >&2; rm -f "$objs"; exit 1; }
    secret=${CLAUDE_CODE_OAUTH_TOKEN:-}; [ "$rt" != opencode ] || secret=$ANTHROPIC_API_KEY
    { grep -rqF -- "$secret" "$t" || grep -aqF -- "$secret" "$objs"; } \
      && { echo "token found in $t: remove it before publishing" >&2; rm -f "$objs"; exit 1; }
    rm -f "$objs"
    rm -rf "$t/score"
    "$bench/scorer/score.sh" "$bench/briefs/$brief" "$t/workspace" "$t/score" > "$t/log/score.log" 2>&1
    set -e
    podman run --rm --userns=keep-id -e HOME=/tmp -v "$repo":/repo:ro,Z -v "$t":/t:Z -w /repo "$NODE" node bench/scripts/trial.mjs /t "$arm"
    echo "$(date -Is) round $r arm $arm done: $(jq -c '{audit: .audit.ok, features: .score.features_passed, cost: .outcome.cost_usd_api_equivalent}' "$t/trial.json")" | tee -a "$runs/manifest.txt"
    rm -f "$c"
  done
done
