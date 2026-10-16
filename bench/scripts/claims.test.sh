#!/bin/sh
# Checks the arm claims of concurrent runners on one run (`claim` in bench/run-brief.sh).
# Usage: sh bench/scripts/claims.test.sh
set -eu
eval "$(sed -n '/^claim() {/,/^}$/p' "$(dirname "$0")/../run-brief.sh")"
d=$(mktemp -d); trap 'rm -rf "$d"' EXIT
fail=0
check() { # <description> <expected yes|no> <claim path>
  if claim "$3"; then got=yes; else got=no; fi
  [ "$got" = "$2" ] || { echo "$1: expected $2, got $got"; fail=1; }
}
check "free arm" yes "$d/claims/round-1-A"
[ "$(readlink "$d/claims/round-1-A")" = "$$" ] || { echo "free arm: claim does not name this runner"; fail=1; }
check "own claim" yes "$d/claims/round-1-A"
sleep 30 & live=$!
ln -s "$live" "$d/claims/round-1-B"
check "arm of a live runner" no "$d/claims/round-1-B"
[ "$(readlink "$d/claims/round-1-B")" = "$live" ] || { echo "arm of a live runner: claim changed"; fail=1; }
kill "$live"; wait "$live" 2> /dev/null || true
check "arm of a dead runner" yes "$d/claims/round-1-B"
[ "$(readlink "$d/claims/round-1-B")" = "$$" ] || { echo "arm of a dead runner: claim not taken over"; fail=1; }
[ "$fail" = 0 ] && echo "claims: all checks pass"
exit "$fail"
