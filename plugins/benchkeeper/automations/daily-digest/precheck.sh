#!/bin/sh
# Exit 0 to start the run: no session of this automation is alive, and there is no digest yet or a pull request or an
# issue of the repositories ($2, comma separated; empty: the one of the checkout) changed since the digest ($1) was written.
if pgrep -f "automation-[d]aily-digest" >/dev/null; then exit 1; fi
[ -f "$1" ] || exit 0
since=$(date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ) || exit 0
for r in $(echo "${2:-.}" | tr , ' '); do
  if [ "$r" = . ]; then set --; else set -- --repo "$r"; fi
  for kind in pr issue; do
    [ "$(gh "$kind" list "$@" --state all --search "updated:>=$since" --json number --jq length)" -gt 0 ] 2>/dev/null && exit 0
  done
done
exit 1
