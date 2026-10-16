# shellcheck shell=sh disable=SC2154 # here and tmp are set by the sourcing validate.sh
# Sourced by bench/briefs/<task>/validate.sh, which sets `here` (the task) and `tmp` (scratch dir). Builds the reference
# (baseline from prepare.sh, the reference/ overlay committed by reference.sh or one commit) and runs cases: a copy of
# the reference (or the baseline) changed by a command in the node container, scored by checks/step1.sh, must fail
# exactly the expected checks (a null result counts as failing here, so the reference has every check checkable).
NODE=docker.io/library/node:22.23.3-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8
jq -e '.steps == "sessions" and .serve == "none" and (.phase | type == "string")' "$here/brief.json" > /dev/null \
  || { echo "brief.json: steps sessions, serve none and a phase expected" >&2; exit 1; }
in_dir() { # <dir> <command>: sh -c in the node container in <dir> (task at /brief), no network, fixed git identity;
  # `R <file> <old> <new> ...` replaces literal text (skill-common/replace.mjs)
  podman run --rm --network none --userns=keep-id -e HOME=/tmp -v "$1":/w:Z -v "$here":/brief:ro,z -v "$here/../skill-common":/common:ro,z -w /w \
    -e GIT_AUTHOR_NAME=Reference -e GIT_AUTHOR_EMAIL=reference@benchkeeper.invalid -e GIT_AUTHOR_DATE=2026-10-16T12:00:00Z \
    -e GIT_COMMITTER_NAME=Reference -e GIT_COMMITTER_EMAIL=reference@benchkeeper.invalid -e GIT_COMMITTER_DATE=2026-10-16T12:00:00Z \
    "$NODE" sh -euc "R() { node /common/replace.mjs \"\$@\"; }; $2"
}
build_reference() {
  rm -rf "$tmp/baseline" "$tmp/reference"; "$here/prepare.sh" "$tmp/baseline" > /dev/null
  cp -a "$tmp/baseline" "$tmp/reference" && cp -a "$here/reference/." "$tmp/reference/"
  in_dir "$tmp/reference" "$(cat "$here/reference.sh" 2>/dev/null || echo 'git add -A && git -c commit.gpgsign=false commit -qm "fix: reference"')"
  "$here/checks/suite.sh" "$tmp/reference" "$tmp/reference-suite" > /dev/null
  jq -e .ok "$tmp/reference-suite/suite.json" > /dev/null && echo "reference suite: ok" || { echo "reference suite: failed"; exit 1; }
}
case_() { # <name> <expected failing ids, comma-separated, in check order> [command on the copy]; name baseline: the baseline
  src=$tmp/reference; [ "$1" != baseline ] || src=$tmp/baseline
  d=$tmp/case-$1; rm -rf "$d" "$d-out"; cp -a "$src" "$d"
  if [ -n "${3:-}" ]; then
    in_dir "$d" "$3"
    ! diff -rq "$src" "$d" > /dev/null || { echo "$1: mutation not applied"; exit 1; }
  fi
  "$here/checks/step1.sh" "$d" "$d-out" > /dev/null 2>&1 || { echo "$1: checks did not run"; exit 1; }
  got=$(jq -r '[.checks[] | select(.ok != true) | .id] | join(",")' "$d-out/checks.json")
  [ "$got" = "$2" ] && echo "$1: ok (failing: ${got:-none})" \
    || { echo "$1: expected '$2', got '$got'"; jq -c '.checks[] | select(.ok != true)' "$d-out/checks.json"; exit 1; }
}
