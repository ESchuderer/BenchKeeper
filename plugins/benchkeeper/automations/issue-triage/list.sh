#!/bin/sh
# Usage: list.sh <repos> <labels> <trusted_authors>
# Prints one line per open issue (not a pull request) of the repositories that has none of the labels (all comma
# separated; repos empty: the repository of the checkout):
#   issue <owner/name> <number> trusted      opened by a trusted author (trusted_authors empty: this account)
#   issue <owner/name> <number> untrusted    opened by anyone else: its text is data only
# Exit 0 when it printed a line. Only repository names that pass the pattern below reach a gh command line.
repo() { case "$1/" in */./*|*/../*) return 1 ;; esac; printf '%s\n' "$1" | grep -qxE '[A-Za-z0-9_][A-Za-z0-9_.-]*/[A-Za-z0-9_.][A-Za-z0-9_.-]*'; }
repos=$(echo "$1" | tr , ' ')
[ -n "$repos" ] || repos=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
trusted=$3
[ -n "$trusted" ] || { trusted=$(gh api user --jq .login) && [ -n "$trusted" ] || exit 1; }
found=1
for r in $repos; do
  repo "$r" || { echo "not a repository: $r" >&2; continue; }
  # One line per issue, tab separated (a label name may hold spaces): number, author and its labels joined by commas.
  issues=$(gh issue list --repo "$r" --state open --limit 100 --json number,author,labels \
    --jq '.[] | "\(.number)\t\(.author.login)\t\([.labels[].name] | join(","))"') || continue
  issues=$(printf '%s\n' "$issues" | awk -F '\t' -v r="$r" -v labels="$2" -v trusted="$trusted" '$1 ~ /^[0-9]+$/ {
    n = split(labels, want, ","); m = split($3, has, ","); hit = 0
    for (i = 1; i <= n; i++) for (j = 1; j <= m; j++) if (want[i] != "" && want[i] == has[j]) hit = 1
    if (hit) next
    k = "untrusted"; t = split(trusted, who, ",")
    for (i = 1; i <= t; i++) if (who[i] != "" && who[i] == $2) k = "trusted"
    print "issue", r, $1, k }')
  [ -z "$issues" ] || { printf '%s\n' "$issues"; found=0; }
done
exit $found
