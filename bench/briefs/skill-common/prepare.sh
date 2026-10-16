#!/bin/sh
# Builds a targeted task's baseline in <out-dir>, offline: the fixture <brief>/repo/ as commit "chore: baseline", then
# each overlay <brief>/commits/<n>/ (in order) as a commit with the message of <brief>/commits/<n>.msg; fixed author and
# dates, branch main, no remote. Stops when the head is not <brief>/baseline.sha (the checks rely on that commit).
# Usage: bench/briefs/skill-common/prepare.sh <brief-dir> <out-dir>
set -eu
brief=$(realpath "$1"); out=$(realpath -m "$2"); mkdir -p "$out"
[ -z "$(ls -A "$out")" ] || { echo "prepare: $out is not empty" >&2; exit 1; }
NODE=docker.io/library/node:22.23.3-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8
cp -a "$brief/repo/." "$out/"
head=$(podman run --rm --network none --userns=keep-id -e HOME=/tmp -v "$out":/w:Z -v "$brief":/brief:ro,z -w /w "$NODE" sh -euc '
  export GIT_AUTHOR_NAME=BenchKeeper GIT_AUTHOR_EMAIL=baseline@benchkeeper.invalid
  export GIT_COMMITTER_NAME=$GIT_AUTHOR_NAME GIT_COMMITTER_EMAIL=$GIT_AUTHOR_EMAIL
  commit() { export GIT_AUTHOR_DATE="2026-10-0${1}T10:00:00Z" GIT_COMMITTER_DATE="2026-10-0${1}T10:00:00Z"; git add -A && git -c commit.gpgsign=false commit -q --no-verify -F "$2"; }
  git init -q -b main .
  echo "chore: baseline" > /tmp/msg && commit 1 /tmp/msg
  n=1
  for c in $(ls /brief/commits 2>/dev/null | grep -E "^[0-9]+$" | sort -n); do
    n=$((n + 1)); cp -a "/brief/commits/$c/." . && commit "$n" "/brief/commits/$c.msg"
  done
  git rev-parse HEAD')
[ "$head" = "$(cat "$brief/baseline.sha" 2>/dev/null)" ] || { echo "prepare: baseline commit $head is not $brief/baseline.sha" >&2; exit 1; }
