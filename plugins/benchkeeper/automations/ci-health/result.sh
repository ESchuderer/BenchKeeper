#!/bin/sh
# Usage: result.sh <mode> <report file> <owner/name> <workflow id> <run id> <attempt> <pass|fail> <workflow path>
# The last six arguments are a line of due.sh. Records the result of the run attempt. In mode act it keeps one issue of
# this account per workflow: the second failure in a row opens it, a later one replaces its body with the report, a pass
# comments the report and closes it.
set -e
mode=$1 body=$2 repo=$3 wf=$4 run=$5 attempt=$6 result=$7 path=$8
case "$result" in pass|fail) ;; *) echo "result must be pass or fail" >&2; exit 2 ;; esac
printf '%s\n' "$repo" | grep -qxE '[A-Za-z0-9_][A-Za-z0-9_.-]*/[A-Za-z0-9_.][A-Za-z0-9_.-]*' || { echo "not a repository: $repo" >&2; exit 2; }
printf '%s %s %s\n' "$wf" "$run" "$attempt" | grep -qxE '[0-9]+ [0-9]+ [0-9]+' || { echo "not a workflow, run and attempt: $wf $run $attempt" >&2; exit 2; }
printf '%s\n' "$path" | grep -qxE '[A-Za-z0-9_.][A-Za-z0-9_./-]*' || { echo "not a workflow path: $path" >&2; exit 2; }
[ -f "$body" ] || { echo "report file $body is missing" >&2; exit 2; }
dir=${XDG_STATE_HOME:-$HOME/.local/state}/benchkeeper/ci-health
file="$dir/$(echo "$repo" | tr / _)"
mkdir -p "$dir"
echo "$wf $run/$attempt $result $(date +%s)" >> "$file"
[ "$mode" = act ] || exit 0
# Failures of this workflow since its last pass.
fails=$(awk -v w="$wf" '$1 == w { n = $3 == "fail" ? n + 1 : 0 } END { print n + 0 }' "$file")
title="CI health: $path fails"
# A failing list stops here: an empty answer would open a second issue.
list=$(gh issue list --repo "$repo" --author @me --state open --search "\"$title\" in:title" --json number,title --jq '.[] | "\(.number)\t\(.title)"')
n=$(printf '%s\n' "$list" | awk -F '\t' -v t="$title" '$2 == t { print $1; exit }')
if [ "$result" = pass ]; then
  [ -z "$n" ] || { gh issue comment "$n" --repo "$repo" --body-file "$body"; gh issue close "$n" --repo "$repo"; }
elif [ -n "$n" ]; then gh issue edit "$n" --repo "$repo" --body-file "$body"
elif [ "$fails" -ge 2 ]; then gh issue create --repo "$repo" --title "$title" --body-file "$body"
fi
