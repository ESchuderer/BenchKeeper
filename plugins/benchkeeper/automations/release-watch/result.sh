#!/bin/sh
# Usage: result.sh <mode> <owner/name> <tag> <pass|fail> <report file>
# Records the result with its time. In mode act it keeps one issue of this account per failing tag: a failure opens it
# or replaces its body with the report, a later pass replaces the body and closes it.
set -e
mode=$1 repo=$2 tag=$3 result=$4 body=$5
case "$result" in pass|fail) ;; *) echo "result must be pass or fail" >&2; exit 2 ;; esac
"$(dirname "$0")/valid.sh" tag "$tag" >/dev/null
printf '%s\n' "$repo" | grep -qxE '[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+' || { echo "not a repository: $repo" >&2; exit 2; }
[ -f "$body" ] || { echo "report file $body is missing" >&2; exit 2; }
dir=${XDG_STATE_HOME:-$HOME/.local/state}/benchkeeper/release-watch
mkdir -p "$dir"
echo "$tag $result $(date +%s)" >> "$dir/$(echo "$repo" | tr / _)"
[ "$mode" = act ] || exit 0
title="Release watch: $tag failed"
# A failing list stops here: an empty answer would open a second issue.
list=$(gh issue list --repo "$repo" --author @me --state open --search "\"$title\" in:title" --json number,title --jq '.[] | "\(.number)\t\(.title)"')
n=$(printf '%s\n' "$list" | awk -F '\t' -v t="$title" '$2 == t { print $1; exit }')
if [ "$result" = pass ]; then
  [ -z "$n" ] || { gh issue edit "$n" --repo "$repo" --body-file "$body"; gh issue close "$n" --repo "$repo"; }
elif [ -n "$n" ]; then gh issue edit "$n" --repo "$repo" --body-file "$body"
else gh issue create --repo "$repo" --title "$title" --body-file "$body"
fi
