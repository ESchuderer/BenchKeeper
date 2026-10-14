#!/bin/sh
# Validates the hidden tests: the reference passes all features, and each mutant fails exactly its feature.
# Usage: bench/briefs/winery/validate.sh <scratch-dir>
set -eu
here=$(dirname "$(realpath "$0")"); tmp=$(realpath -m "$1"); mkdir -p "$tmp"
result() { jq -r '[.. | objects | select(has("specs")) | .specs[] | select(.ok | not) | .title | split(" ")[0]] | join(",")' "$1/acceptance.json"; }
run() { # <name> <expected failing features> <sed script or empty>
  rm -rf "$tmp/$1" "$tmp/$1-out"; cp -r "$here/reference" "$tmp/$1"
  [ -z "$3" ] || sed -i "$3" "$tmp/$1/server.mjs"
  [ -z "$3" ] || ! cmp -s "$here/reference/server.mjs" "$tmp/$1/server.mjs" || { echo "$1: mutation not applied"; exit 1; }
  "$here/../../scorer/score.sh" "$here" "$tmp/$1" "$tmp/$1-out" > /dev/null 2>&1 || true
  got=$(result "$tmp/$1-out"); [ "$got" = "$2" ] && echo "$1: ok (failing: ${got:-none})" || { echo "$1: expected '$2', got '$got'"; exit 1; }
}
run reference "" ""
run capacity F3 's/ : guests > left(t) ? `Only ${left(t)} seats left.` : '"''"'/ : '"''"'/'
run staff-open F5 's/const staff = sid && sessions.has(sid);/const staff = true;/'
run cancel-noop F6 's/if (i >= 0) bookings.splice(i, 1);//'
run email-unchecked F4 's#!/^\[^\\s@\]+@\[^\\s@\]+\\.\[^\\s@\]+$/.test(v.email || '"''"')#false#'
