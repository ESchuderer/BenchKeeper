#!/usr/bin/env bash
# Runs the prompt of the reviewing-rules skill over each fixture with a real agent and compares kind and lines with expected.json.
# Usage: bash live.sh claude|codex [model] [--record]   (--record: write the answers to recorded.json for the unit test)
# Each run spends a few cents of the signed-in account; it is run by hand when the prompt changes, never in CI.
set -u
here=$(cd "$(dirname "$0")" && pwd)
agent=$1 model=${2:-} record=${3:-}
[[ "$model" = --record ]] && model= record=--record
prompt=$(sed -n '/^```text$/,/^```$/{//!p}' "$here/../../../../plugins/benchkeeper/skills/reviewing-rules/SKILL.md")
answers='{}' pass=0 total=0
for f in "$here"/*.md; do
  name=$(basename "$f")
  q="$prompt"$'\n'"$(nl -ba -w1 -s': ' "$f")"
  dir=$(mktemp -d)
  if [[ "$agent" = claude ]]; then
    answer=$(cd "$dir" && timeout 120 claude -p "$q" --restricted --tools "" --strict-mcp-config --no-session-persistence --output-format json --max-turns 2 --max-budget-usd 0.25 ${model:+--model "$model"} </dev/null | jq -r .result)
  else
    (cd "$dir" && timeout 120 codex exec --sandbox read-only --skip-git-repo-check --ephemeral -o "$dir/answer.txt" ${model:+-m "$model"} "$q" </dev/null >/dev/null)
    answer=$(cat "$dir/answer.txt")
  fi
  rm -rf "$dir"
  answers=$(jq -c --arg n "$name" --arg a "$answer" '.[$n] = $a' <<<"$answers")
  got=$(printf '%s' "$answer" | sed -n '/{/,$p' | jq -c '[.findings[] | "\(.kind):\(.lines | sort)"] | sort' 2>/dev/null || echo '"unparsed"')
  want=$(jq -c --arg n "$name" '[.[$n][] | "\(.kind):\(.lines | sort)"] | sort' "$here/expected.json")
  total=$((total + 1)); [[ "$got" = "$want" ]] && pass=$((pass + 1)) && ok=PASS || ok=FAIL
  echo "$ok $name want=$want got=$got"
done
echo "$pass/$total fixtures match"
if [[ "$record" = --record ]]; then
  [[ "$pass" = "$total" ]] || { echo "not recorded: a fixture failed"; exit 1; }
  jq . <<<"$answers" > "$here/recorded.json"
fi
[[ "$pass" = "$total" ]]
