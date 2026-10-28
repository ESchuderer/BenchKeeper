#!/bin/sh
# Prints "owner/name tag version" for each repository ($1, comma separated; empty: the one of the checkout) whose newest
# release has a valid tag and no recorded pass, nor a recorded failure younger than a day. Exit 0 when it printed a line.
dir=${XDG_STATE_HOME:-$HOME/.local/state}/benchkeeper/release-watch
now=$(date +%s) due=1
for r in $(echo "${1:-.}" | tr , ' '); do
  [ "$r" != . ] || r=$(gh repo view --json nameWithOwner --jq .nameWithOwner) || continue
  tag=$(gh release list --repo "$r" --exclude-drafts --limit 1 --json tagName --jq '.[0].tagName // empty') || continue
  v=$("$(dirname "$0")/valid.sh" tag "$tag" 2>/dev/null) || continue
  awk -v t="$tag" -v now="$now" '$1 == t { r = $2; at = $3 } END { exit !(r == "pass" || (r == "fail" && now - at < 86400)) }' "$dir/$(echo "$r" | tr / _)" 2>/dev/null && continue
  echo "$r $tag $v"
  due=0
done
exit $due
