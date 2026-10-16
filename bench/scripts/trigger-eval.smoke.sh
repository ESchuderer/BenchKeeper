#!/bin/sh
# Smoke test of bench/scripts/trigger-eval.sh end to end with a fake claude (bench/scripts/fixtures/fake-claude.sh):
# no network in the eval containers, no credentials, no subscription use. Needs podman and the arm images A, B, F, G, H, V,
# AB, AC (bench/run-brief.sh builds them). Every collection's skill folder layout: plugin (Ponytail, all skills;
# agent-skills, Superpowers), nested plugin (Matt Pocock), ~/.claude/skills (ECC), project template (OpenSpec, Spec Kit),
# repository skills copied in (BenchKeeper). The fake triggers only when the harness hid the installed skill, injected one
# command and passed model, effort and token, and never on a query with "?", so the expected counts follow from the
# prompt sets. Then the fail-closed paths: a gate reading without headers, a token the sanity query rejects, a resume with
# other settings.
# Usage: sh bench/scripts/trigger-eval.smoke.sh
set -eu
bench=$(dirname "$(dirname "$(realpath "$0")")"); repo=$(dirname "$bench")
NODE=docker.io/library/node:22.23.3-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
fail=0
fake() { FAKE_CLAUDE=$bench/scripts/fixtures/fake-claude.sh RUNS=1 TIMEOUT=30 "$bench/scripts/trigger-eval.sh" "$@"; }
for c in "Ponytail" "agent-skills code-review-and-quality" "Superpowers brainstorming" "ECC council" "Matt-Pocock tdd" \
  "OpenSpec openspec-propose" "Spec-Kit speckit-plan" "BenchKeeper following-dev-workflow"; do
  set -- $c; col=$1; shift
  OUT=$tmp/$col CLAUDE_CODE_OAUTH_TOKEN=fake-smoke-token fake "$col" claude-fake-1 low "$@"
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
    case $row in *"| $tp/$pos ("*"| $fp/$neg ("*"| ok |") ;; *) echo "$col/$s: expected recall $tp/$pos, false triggers $fp/$neg, ok; got: $row"; fail=1 ;; esac
  done
done

# Gate: a reading without rate-limit headers fails instead of counting as 0.
eval "$(sed -n '/^ratelimits() {/,/^}$/p' "$bench/scripts/trigger-eval.sh")"
if echo "Invalid bearer token" | ratelimits > /dev/null; then echo "gate: a reading without headers passed"; fail=1; fi
[ "$(printf '"anthropic-ratelimit-unified-5h-utilization": "0.5"\n"anthropic-ratelimit-unified-5h-reset": "9"\n"anthropic-ratelimit-unified-7d-utilization": "0.1"\n"anthropic-ratelimit-unified-7d-reset": "8"\n' | ratelimits)" = "0.5 9 0.1 8" ] \
  || { echo "gate: headers not parsed"; fail=1; }
# Sanity query: a rejected token stops the run before the skill's result is written.
if OUT=$tmp/bad CLAUDE_CODE_OAUTH_TOKEN=rejected-token fake Matt-Pocock claude-fake-1 low tdd 2> "$tmp/bad.err"; then
  echo "sanity: a rejected token did not stop the run"; fail=1
fi
[ ! -e "$tmp/bad/tdd.json" ] || { echo "sanity: a result was written with a rejected token"; fail=1; }
grep -q "sanity query failed" "$tmp/bad/tdd.log" || { echo "sanity: no reason in the log"; fail=1; }
# Resume with other settings is refused.
if OUT=$tmp/Matt-Pocock CLAUDE_CODE_OAUTH_TOKEN=fake-smoke-token RUNS=2 FAKE_CLAUDE=$bench/scripts/fixtures/fake-claude.sh TIMEOUT=30 \
  "$bench/scripts/trigger-eval.sh" Matt-Pocock claude-fake-1 low tdd 2> /dev/null; then
  echo "resume: other settings were accepted"; fail=1
fi
[ "$fail" = 0 ] && echo "trigger-eval smoke test passed"
exit "$fail"
