#!/bin/sh
# Usage: list.sh <owners> <repos> [record]
# Prints one line per item of the repositories: repos (owner/name, comma separated), every repository of owners (accounts,
# comma separated) that is neither archived nor a fork, or with both empty the repository of the checkout.
#   pr <owner/name> <number> own        a pull request of a dependency bot whose commits are all by the bot or this account
#   pr <owner/name> <number> foreign    one with a commit by someone else: list it, never touch it
#   alert <owner/name> <number>         an open Dependabot alert
#   noaccess <owner/name>               the token cannot read the alerts; with record printed once per repository
# Exit 0 when it printed a pr or an alert line. Only names that pass the patterns below reach a gh command line.
dir=${XDG_STATE_HOME:-$HOME/.local/state}/benchkeeper/dependency-triage
repo() { case "$1/" in */./*|*/../*) return 1 ;; esac; printf '%s\n' "$1" | grep -qxE '[A-Za-z0-9_][A-Za-z0-9_.-]*/[A-Za-z0-9_.][A-Za-z0-9_.-]*'; }
repos=$(echo "$2" | tr , ' ')
for o in $(echo "$1" | tr , ' '); do
  printf '%s\n' "$o" | grep -qxE '[A-Za-z0-9][A-Za-z0-9-]*' || { echo "not an account: $o" >&2; continue; }
  repos="$repos $(gh repo list "$o" --no-archived --source --limit 1000 --json nameWithOwner --jq '.[].nameWithOwner')"
done
[ -n "$(echo "$repos" | tr -d ' ')" ] || repos=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
me=$(gh api user --jq .login) && [ -n "$me" ] || exit 1
found=1
for r in $repos; do
  repo "$r" || { echo "not a repository: $r" >&2; continue; }
  # One line per pull request: number, author and the login of each commit author ("-" for one without an account).
  prs=$(gh pr list --repo "$r" --state open --limit 100 --json number,author,commits \
    --jq '.[] | "\(.number) \(.author.login) \([.commits[].authors[] | if (.login // "") == "" then "-" else .login end] | join(" "))"') || continue
  prs=$(printf '%s\n' "$prs" | awk -v r="$r" -v me="$me" '$1 ~ /^[0-9]+$/ && ($2 == "app/dependabot" || $2 == "app/renovate") {
    bot = substr($2, 5) "[bot]"; k = "own"
    for (i = 3; i <= NF; i++) if ($i != bot && $i != me) k = "foreign"
    print "pr", r, $1, k }')
  [ -z "$prs" ] || { printf '%s\n' "$prs"; found=0; }
  file="$dir/noaccess-$(echo "$r" | tr / _)"
  if alerts=$(gh api "repos/$r/dependabot/alerts?state=open&per_page=100" --jq '.[].number' 2>/dev/null); then
    [ "$3" != record ] || rm -f "$file"
    [ -z "$alerts" ] || { printf '%s\n' "$alerts" | sed "s|^|alert $r |"; found=0; }
  elif [ "$3" = record ] && [ ! -e "$file" ]; then
    mkdir -p "$dir" && : > "$file"
    echo "noaccess $r"
  fi
done
exit $found
