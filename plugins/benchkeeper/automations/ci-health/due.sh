#!/bin/sh
# Usage: due.sh <repos> <workflows>
# Prints "owner/name <workflow id> <run id> <attempt> fail|pass <workflow path>" per workflow of the repositories (repos,
# comma separated; empty: the one of the checkout) whose newest completed run of the default branch or of a schedule is
# not recorded yet and either failed (in the last day, or after a recorded failure) or passed after a recorded failure.
# workflows: file names such as ci.yml, comma separated; empty: all. Exit 0 when it printed a line.
dir=${XDG_STATE_HOME:-$HOME/.local/state}/benchkeeper/ci-health
repos=$(echo "$1" | tr , ' ')
[ -n "$repos" ] || repos=$(gh repo view --json nameWithOwner --jq .nameWithOwner) || exit 1
due=1
for r in $repos; do
  case "$r/" in */./*|*/../*) echo "not a repository: $r" >&2; continue ;; esac
  printf '%s\n' "$r" | grep -qxE '[A-Za-z0-9_][A-Za-z0-9_.-]*/[A-Za-z0-9_.][A-Za-z0-9_.-]*' || { echo "not a repository: $r" >&2; continue; }
  b=$(gh api "repos/$r" --jq .default_branch) || continue
  printf '%s\n' "$b" | grep -qxE '[A-Za-z0-9._/-]+' || continue
  # Newest first: workflow id, run id, attempt, pass or fail, new (created in the last day) or old, workflow path.
  # Only pushes and schedules of workflow files: a pull request from a fork's branch of the same name is external code.
  runs=$(gh api "repos/$r/actions/runs?branch=$b&status=completed&per_page=100" --jq '.workflow_runs[]
    | select((.event == "push" or .event == "schedule") and (.path | startswith(".github/workflows/")))
    | select(.conclusion == "success" or .conclusion == "failure" or .conclusion == "timed_out" or .conclusion == "startup_failure")
    | "\(.workflow_id) \(.id) \(.run_attempt) \(if .conclusion == "success" then "pass" else "fail" end) \(if (.created_at | fromdateiso8601) > now - 86400 then "new" else "old" end) \(.path)"') || continue
  out=$(printf '%s\n' "$runs" | awk -v r="$r" -v w=",$2," -v st="$(cat "$dir/$(echo "$r" | tr / _)" 2>/dev/null)" '
    BEGIN { n = split(st, l, "\n"); for (i = 1; i <= n; i++) { split(l[i], f, " "); key[f[1]] = f[2]; res[f[1]] = f[3] } }
    $1 !~ /^[0-9]+$/ || $2 !~ /^[0-9]+$/ || $3 !~ /^[0-9]+$/ || $6 !~ /^[A-Za-z0-9_.\/-]+$/ || seen[$1]++ { next }
    { base = $6; sub(/.*\//, "", base) }
    w != ",," && index(w, "," base ",") == 0 { next }
    key[$1] == $2 "/" $3 { next }
    $4 == "pass" && res[$1] == "fail" || $4 == "fail" && (res[$1] == "fail" || $5 == "new") { print r, $1, $2, $3, $4, $6 }')
  [ -z "$out" ] || { printf '%s\n' "$out"; due=0; }
done
exit $due
