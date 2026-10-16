#!/bin/sh
# Trigger evals (#36 step 3): runs the vendored skill-creator `run_eval.py` for the model-invocable skills of one
# collection, one container per skill, in the collection's arm image plus Python (bench/image/triggers.Containerfile).
# In the container the installed copy of the skill gets `disable-model-invocation: true`, so the copy that run_eval
# injects as a uniquely named command competes only with the sibling skills; one worker, so no other injected copy exists.
# Usage: bench/scripts/trigger-eval.sh <collection> <model> <effort> [runs-per-query] [skill...]
#   e.g. bench/scripts/trigger-eval.sh Ponytail claude-haiku-5-5 high
# Queries: bench/triggers/<collection>.json (one run_eval eval set per skill). Results: bench/runs/triggers-<collection>-
# <model>-<effort>/<skill>.json (run_eval output), <skill>.log, manifest.txt; resumable: skills with a result are skipped.
# Summary: node bench/scripts/trigger-summary.mjs <results dir>. TIMEOUT: seconds per query (default 90).
# Credentials as in bench/run-brief.sh: the subscription token only (CLAUDE_CODE_OAUTH_TOKEN or the file
# ~/.config/benchkeeper/oauth-token), passed as an environment variable, never the API key.
# FAKE_CLAUDE=<script>: smoke test; the script replaces claude in every container (eval and usage gate), no network,
# the token file is not read (bench/scripts/trigger-eval.smoke.sh).
set -eu
col=$1 model=$2 effort=$3 runs=${4:-3}
shift 3; [ $# -eq 0 ] || shift
bench=$(dirname "$(dirname "$(realpath "$0")")"); repo=$(dirname "$bench")
set_file=$bench/triggers/$col.json
[ -f "$set_file" ] || { echo "no prompt set $set_file" >&2; exit 1; }
# Arm image and skills folder (under the image's home) per collection; BenchKeeper's skills/ is copied into ~/.claude/skills
# of the agent-skills arm, as /global-setup installs them beside agent-skills.
case $col in
  agent-skills) arm=f root=.claude/plugins/cache/addy-agent-skills/agent-skills/0.6.13/skills ;;
  Superpowers) arm=g root=.claude/plugins/cache/superpowers-dev/superpowers/7.0.0/skills ;;
  ECC) arm=h root=.claude/skills ;;
  Matt-Pocock) arm=v root=.claude/plugins/cache/mattpocock/mattpocock-skills/1.3.1/skills ;;
  Ponytail) arm=b root=.claude/plugins/cache/ponytail/ponytail/5.2.0/skills ;;
  OpenSpec) arm=ab root=project-template/.claude/skills ;;
  Spec-Kit) arm=ac root=project-template/.claude/skills ;;
  BenchKeeper) arm=f root=.claude/skills ;;
  *) echo "unknown collection $col" >&2; exit 1 ;;
esac
bk=; [ "$col" != BenchKeeper ] || bk="-v $repo/skills:/bk:ro,z"
if [ -n "${FAKE_CLAUDE:-}" ]; then
  fake="--network none -v $(realpath "$FAKE_CLAUDE"):/usr/local/bin/claude:ro,z"
else
  fake=
  : "${CLAUDE_CODE_OAUTH_TOKEN:=$(cat "$HOME/.config/benchkeeper/oauth-token" 2>/dev/null)}"
fi
[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || { echo "no token: set CLAUDE_CODE_OAUTH_TOKEN or write ~/.config/benchkeeper/oauth-token" >&2; exit 1; }
export CLAUDE_CODE_OAUTH_TOKEN
img=benchkeeper-trig-$arm
podman build -q -f "$bench/image/triggers.Containerfile" --build-arg ARM="$arm" -t "$img" "$repo" > /dev/null
out=${OUT:-$bench/runs/triggers-$col-$model-$effort}
mkdir -p "$out"
{
  echo "collection=$col model=$model effort=$effort runs=$runs timeout=${TIMEOUT:-90}s fake=${FAKE_CLAUDE:+yes}"
  echo "benchkeeper=$(git -C "$repo" rev-parse HEAD) dirty=$(git -C "$repo" status --porcelain | wc -l)"
  echo "image arm-$arm $(podman image inspect "benchkeeper-arm-$arm" --format '{{.Id}}') trig-$arm $(podman image inspect "$img" --format '{{.Id}}')"
} >> "$out/manifest.txt"

# Usage gate of bench/run-brief.sh (one-word Haiku request in arm A) before each skill (one batch: its queries times runs).
# shortcut: a copy of run-brief.sh's usage() and gate(); move both into one sourced file when a third runner needs them.
threshold() { [ -n "${USAGE_MAX:-}" ] && echo "$USAGE_MAX" || cat "$bench/usage-max" 2>/dev/null || echo 0.70; }
usage() { # prints "<5h utilization> <5h reset epoch> <7d utilization> <7d reset epoch>"
  # shellcheck disable=SC2086 # $fake holds several flags
  podman run --rm $fake -e HOME=/home/node -e CLAUDE_CODE_OAUTH_TOKEN -e ANTHROPIC_LOG=debug benchkeeper-arm-a \
    claude -p "Reply OK" --model claude-haiku-5-5 --max-turns 1 2>&1 \
    | awk -F'"' '/ratelimit-unified-5h-utilization/ {u=$4} /ratelimit-unified-5h-reset/ {r=$4} /ratelimit-unified-7d-utilization/ {w=$4} /ratelimit-unified-7d-reset/ {wr=$4} END {print u+0, r+0, w+0, wr+0}'
}
gate() {
  while :; do
    set -- $(usage)
    echo "$(date -Is) usage 5h $1 weekly $3" >> "$out/manifest.txt"
    if awk -v w="$3" -v m="${WEEKLY_MAX:-0.98}" 'BEGIN { exit !(w >= m) }'; then
      set -- "$1" "$4"
      echo "$(date -Is) waiting for the weekly reset at $(date -d "@$2" -Is)" | tee -a "$out/manifest.txt"
    else
      awk -v u="$1" -v m="$(threshold)" 'BEGIN { exit !(u >= m) }' || return 0
      echo "$(date -Is) waiting for the 5h reset at $(date -d "@$2" -Is)" | tee -a "$out/manifest.txt"
    fi
    sleep $(( $2 - $(date +%s) + 60 > 60 ? $2 - $(date +%s) + 60 : 300 ))
  done
}

# In the container: the project (the arm's ~/project-template, else an empty folder with .claude/; a git repository with
# one commit, as in the trials), the skill copied for run_eval, the installed copy hidden from the model, a claude wrapper
# on PATH that adds the effort, then run_eval.
run='set -eu
mkdir -p /tmp/w/.claude /tmp/bin /tmp/target
[ ! -d ~/project-template ] || cp -a ~/project-template/. /tmp/w/
[ ! -d /bk ] || cp -r /bk/. ~/.claude/skills/
cd /tmp/w && git init -q && git add -A && git commit -qm "chore: project setup" --allow-empty && cd /
case $ROOT in project-template/*) d=/tmp/w/${ROOT#project-template/} ;; *) d=$HOME/$ROOT ;; esac
f=$(find "$d" -path "*/$SKILL/SKILL.md")
[ -n "$f" ] && [ "$(printf "%s\n" "$f" | wc -l)" = 1 ] || { echo "skill $SKILL: expected one SKILL.md under $d, found: $f" >&2; exit 1; }
cp -r "${f%/SKILL.md}" /tmp/target/
sed -i "/^disable-model-invocation:/d; 1a disable-model-invocation: true" "$f"
printf "#!/bin/sh\nexec /usr/local/bin/claude \"\$@\" --effort \"\$EFFORT\"\n" > /tmp/bin/claude && chmod +x /tmp/bin/claude
jq --arg s "$SKILL" ".[\$s]" /triggers.json > /tmp/set.json
cd /tmp/w && PATH=/tmp/bin:$PATH PYTHONPATH=/sc python3 -m scripts.run_eval --eval-set /tmp/set.json --skill-path "/tmp/target/$SKILL" \
  --num-workers 1 --timeout "$TIMEOUT" --runs-per-query "$RUNS" --model "$MODEL" --verbose'
[ $# -gt 0 ] || set -- $(jq -r 'keys_unsorted[]' "$set_file")
for s in "$@"; do
  [ ! -s "$out/$s.json" ] || continue
  jq -e --arg s "$s" 'has($s)' "$set_file" > /dev/null || { echo "no queries for $s in $set_file" >&2; exit 1; }
  gate
  echo "$(date -Is) $s start" >> "$out/manifest.txt"
  # shellcheck disable=SC2086 # $fake and $bk hold several flags
  podman run --rm $fake $bk -e HOME=/home/node -e CLAUDE_CODE_OAUTH_TOKEN -e SKILL="$s" -e ROOT="$root" -e MODEL="$model" \
    -e EFFORT="$effort" -e RUNS="$runs" -e TIMEOUT="${TIMEOUT:-90}" -v "$repo/.agents/skills/skill-creator":/sc:ro,z \
    -v "$set_file":/triggers.json:ro,z "$img" sh -c "$run" > "$out/$s.json.tmp" 2> "$out/$s.log" \
    || { echo "$s failed, see $out/$s.log" >&2; exit 1; }
  ! grep -rqF -- "$CLAUDE_CODE_OAUTH_TOKEN" "$out" || { echo "token found in $out: remove it" >&2; rm -f "$out/$s.json.tmp"; exit 1; }
  mv "$out/$s.json.tmp" "$out/$s.json"
  echo "$(date -Is) $s done: $(jq -c .summary "$out/$s.json")" >> "$out/manifest.txt"
done
