#!/bin/sh
# Builds the step 0 baseline in <out-dir>: nikkorn/mistreevous at the pinned commit (v4.3.1 plus later commits), unchanged,
# as a fresh repository with one commit "chore: baseline" (fixed author and date, branch master as upstream, no remote).
# The repository commits its build output (dist/); the build rewrites it, so agents may commit it again.
# Usage: bench/briefs/mistreevous/prepare.sh <out-dir>
set -eu
out=$(realpath -m "$1"); mkdir -p "$out"
[ -z "$(ls -A "$out")" ] || { echo "prepare: $out is not empty" >&2; exit 1; }
head=$(podman run --rm --userns=keep-id -e HOME=/tmp -v "$out":/w:Z -w /w \
  docker.io/library/node:22.23.3-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8 sh -euc '
  git init -q /tmp/src
  git -C /tmp/src fetch -q --depth 1 https://github.com/nikkorn/mistreevous 026f1ffe062309decda6059bb15430a73fc89f67
  git -C /tmp/src archive FETCH_HEAD | tar -x -C /w
  git init -q -b master .
  git add -A
  export GIT_AUTHOR_NAME=BenchKeeper GIT_AUTHOR_EMAIL=baseline@benchkeeper.invalid GIT_AUTHOR_DATE=2026-10-18T09:00:00+02:00
  export GIT_COMMITTER_NAME=$GIT_AUTHOR_NAME GIT_COMMITTER_EMAIL=$GIT_AUTHOR_EMAIL GIT_COMMITTER_DATE=$GIT_AUTHOR_DATE
  git -c commit.gpgsign=false commit -q --no-verify -m "chore: baseline"
  git rev-parse HEAD')
# The checks take their expected values from this commit (baseline.sha): stop when the baseline differs.
[ "$head" = "$(cat "$(dirname "$(realpath "$0")")/baseline.sha")" ] || { echo "prepare: baseline commit $head is not baseline.sha" >&2; exit 1; }
