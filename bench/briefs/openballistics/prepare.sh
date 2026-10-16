#!/bin/sh
# Builds the step 0 baseline in <out-dir>: PiMetry/OpenBallistics at the pinned commit, .github/workflows/ removed,
# README.md reduced to one line, a fresh repository with one commit "chore: baseline" (fixed author and date, branch
# main, no remote). Code, tests, data and .github/ISSUE_TEMPLATE/ are unchanged, except an empty lib/data/.gitkeep:
# the pinned commit deleted lib/data, and site/src/lib/boundaries.test.ts fails with ENOENT without the directory.
# Release files: the pinned commit has no CHANGELOG, release config or tags, so nothing else is removed.
# site/package.json keeps "version": "0.1.0": site/package-lock.json carries the same root version, and removing it
# would mean editing the lockfile; the agent finds an existing version source, as in a real repository.
# Usage: bench/briefs/openballistics/prepare.sh <out-dir>
set -eu
out=$(realpath -m "$1"); mkdir -p "$out"
[ -z "$(ls -A "$out")" ] || { echo "prepare: $out is not empty" >&2; exit 1; }
head=$(podman run --rm --userns=keep-id -e HOME=/tmp -v "$out":/w:Z -w /w \
  docker.io/library/node:22.23.3-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8 sh -euc '
  git init -q /tmp/src
  git -C /tmp/src fetch -q --depth 1 https://github.com/PiMetry/OpenBallistics e83db43fd339f3c4059e7794f84f7edb09ea4cab
  git -C /tmp/src archive FETCH_HEAD | tar -x -C /w
  rm -rf .github/workflows
  echo "# OpenBallistics" > README.md
  mkdir -p lib/data && : > lib/data/.gitkeep
  git init -q -b main .
  git add -A
  export GIT_AUTHOR_NAME=BenchKeeper GIT_AUTHOR_EMAIL=baseline@benchkeeper.invalid GIT_AUTHOR_DATE=2026-09-17T09:56:25+02:00
  export GIT_COMMITTER_NAME=$GIT_AUTHOR_NAME GIT_COMMITTER_EMAIL=$GIT_AUTHOR_EMAIL GIT_COMMITTER_DATE=$GIT_AUTHOR_DATE
  git -c commit.gpgsign=false commit -q --no-verify -m "chore: baseline"
  git rev-parse HEAD')
# The checks take their expected values from this commit (baseline.sha): stop when the baseline differs.
[ "$head" = "$(cat "$(dirname "$(realpath "$0")")/baseline.sha")" ] || { echo "prepare: baseline commit $head is not baseline.sha" >&2; exit 1; }
