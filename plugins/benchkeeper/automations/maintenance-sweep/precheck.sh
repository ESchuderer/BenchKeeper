#!/bin/sh
# Usage: precheck.sh <min merged> <knowledge show --json document>
# Exit 0 to start the run: the knowledge base holds no pass yet, or at least <min merged> pull requests were merged since
# the newest date of its entries. Only a date of the form YYYY-MM-DD reaches the gh command line.
case "$1" in ''|*[!0-9]*) echo "min_merged must be a whole number: $1" >&2; exit 2 ;; esac
[ "$1" -gt 0 ] || exit 0
since=$(printf '%s\n' "$2" | grep -oE '"date": "[0-9]{4}-[0-9]{2}-[0-9]{2}' | cut -c10- | sort | tail -n 1)
[ -n "$since" ] || exit 0
[ "$(gh pr list --state merged --search "merged:>=$since" --limit "$1" --json number --jq length)" -ge "$1" ] 2>/dev/null || exit 1
