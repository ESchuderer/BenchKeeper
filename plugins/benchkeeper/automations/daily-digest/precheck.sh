#!/bin/sh
# Exit 0 to start the run: no session of this automation is alive, and there is no digest yet or a pull request or an
# issue of the repositories ($2, comma separated; empty: the origin's repository of the checkout, not gh's default, which
# in a fork is the parent; an origin off github.com: none; no readable origin: gh's default) changed since the digest ($1)
# was written, apart from the digest's own issue ($3) in the checkout's repository. When the origin does not name the
# checkout's repository (another host, an SSH host alias), that issue number is left out of every listed repository.
if pgrep -f "automation-[d]aily-digest" >/dev/null; then exit 1; fi
[ -f "$1" ] || exit 0
# A checkout gives a committed file a fresh mtime: a digest committed and unchanged since starts at its commit's author time.
d=$(dirname "$1") b=$(basename "$1")
since=$(git -C "$d" -c core.fsmonitor=false ls-files --error-unmatch -- "$b" >/dev/null 2>&1 && git -C "$d" -c core.fsmonitor=false diff --quiet HEAD -- "$b" 2>/dev/null && TZ=UTC git -C "$d" log -1 --no-show-signature --format=%ad --date=format-local:%Y-%m-%dT%H:%M:%SZ -- "$b" 2>/dev/null)
[ -n "$since" ] || since=$(date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ) || exit 0
# The digest's own comment on issue $3 would start the next run every day.
skip=$3
url=$(git remote get-url origin 2>/dev/null)
# owner/name only of a github.com origin (a subdomain such as www. or the port 443 host too, any case, host:owner/name
# or scheme://host[:port]/owner/name): another host's team/proj would name an unrelated GitHub repository.
own=$(printf '%s\n' "$url" | tr A-Z a-z | sed -n -E -e 's#/*$##' -e 's#\.git$##' -e 's#^([a-z+]+://)?([^@/]+@)?([a-z0-9-]+\.)?github\.com(:[0-9]+)?[:/]([^/]+/[^/]+)$#\5#p')
for r in $(echo "${2:-.}" | tr , ' '); do
  set --
  if [ "$r" != . ]; then set -- --repo "$r"; elif [ -n "$own" ]; then set -- --repo "$own"; elif [ -n "$url" ]; then continue; fi
  jq=length
  if [ -n "$skip" ] && { [ "$r" = . ] || [ "$(echo "$r" | tr A-Z a-z)" = "$own" ] || { [ -n "$url" ] && [ -z "$own" ]; }; }; then jq="map(select(.number | tostring != \"$skip\")) | length"; fi
  for kind in pr issue; do
    [ "$(gh "$kind" list "$@" --state all --search "updated:>=$since" --json number --jq "$jq")" -gt 0 ] 2>/dev/null && exit 0
  done
done
exit 1
