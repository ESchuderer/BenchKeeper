#!/bin/sh
# Exit 0 to start the run: no session of this automation is alive, and there is no digest yet or a pull request or an
# issue of the repositories ($2, comma separated; empty: the one of the checkout) changed since the digest ($1) was written.
if pgrep -f "automation-[d]aily-digest" >/dev/null; then exit 1; fi
[ -f "$1" ] || exit 0
# A checkout gives a committed file a fresh mtime: a digest committed and unchanged since starts at its commit's author time.
d=$(dirname "$1") b=$(basename "$1")
since=$(git -C "$d" -c core.fsmonitor=false diff --quiet HEAD -- "$b" 2>/dev/null && TZ=UTC git -C "$d" log -1 --no-show-signature --format=%ad --date=format-local:%Y-%m-%dT%H:%M:%SZ -- "$b" 2>/dev/null)
[ -n "$since" ] || since=$(date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ) || exit 0
# The digest's own comment on issue $3 would start the next run every day.
skip=$3
for r in $(echo "${2:-.}" | tr , ' '); do
  if [ "$r" = . ]; then set --; else set -- --repo "$r"; fi
  for kind in pr issue; do
    [ "$(gh "$kind" list "$@" --state all --search "updated:>=$since" --json number --jq "map(select(.number | tostring != \"$skip\")) | length")" -gt 0 ] 2>/dev/null && exit 0
  done
done
exit 1
