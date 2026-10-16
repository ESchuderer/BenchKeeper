#!/bin/sh
# Smoke test of bench/scripts/trigger-eval.sh end to end with a fake claude (bench/scripts/fixtures/fake-claude.sh):
# no network in the eval containers, no credentials, no subscription use. Needs podman and the arm images B, V, AB, F
# (bench/run-brief.sh builds them). One skill folder layout each: plugin (Ponytail, all skills), nested plugin
# (Matt Pocock), project template (OpenSpec), repository skills copied in (BenchKeeper). The fake triggers only when the
# harness hid the installed skill, injected one command and passed model, effort and token, and never on a query with
# "?", so the expected counts follow from the prompt sets.
# Usage: sh bench/scripts/trigger-eval.smoke.sh
set -eu
bench=$(dirname "$(dirname "$(realpath "$0")")"); repo=$(dirname "$bench")
NODE=docker.io/library/node:22.23.3-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
fail=0
for c in "Ponytail" "Matt-Pocock tdd" "OpenSpec openspec-propose" "BenchKeeper following-dev-workflow"; do
  set -- $c; col=$1; shift
  OUT=$tmp/$col FAKE_CLAUDE=$bench/scripts/fixtures/fake-claude.sh CLAUDE_CODE_OAUTH_TOKEN=fake-smoke-token TIMEOUT=30 \
    "$bench/scripts/trigger-eval.sh" "$col" claude-fake-1 low 1 "$@"
  grep -q "usage 5h 0.1 weekly 0.2" "$tmp/$col/manifest.txt" || { echo "$col: usage gate reading missing"; fail=1; }
  podman run --rm --userns=keep-id -e HOME=/tmp -v "$repo":/repo:ro,Z -v "$tmp/$col":/r:ro,Z -w /repo "$NODE" \
    node bench/scripts/trigger-summary.mjs /r > "$tmp/$col.md"
  cat "$tmp/$col.md"
  [ $# -gt 0 ] || set -- $(jq -r 'keys_unsorted[]' "$bench/triggers/$col.json")
  for s in "$@"; do
    e() { jq --arg s "$s" "[.[\$s][] | select(.should_trigger == $1)] | [length, (map(select(.query | contains(\"?\") | not)) | length)] | @tsv" \
      -r "$bench/triggers/$col.json"; }
    set -- $(e true) $(e false); pos=$1 tp=$2 neg=$3 fp=$4
    row=$(grep -F "| \`$s\` |" "$tmp/$col.md") || { echo "$col/$s: no summary row"; fail=1; continue; }
    case $row in *"| $tp/$pos ("*"| $fp/$neg ("*) ;; *) echo "$col/$s: expected recall $tp/$pos and false triggers $fp/$neg, got: $row"; fail=1 ;; esac
  done
done
[ "$fail" = 0 ] && echo "trigger-eval smoke test passed"
exit "$fail"
