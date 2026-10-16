#!/bin/sh
# Validates the hidden tests of every checkpoint against the reference with all change requests: it passes all tests,
# and each mutant fails exactly its checkpoint's test.
# Usage: bench/briefs/winery-iterative/validate.sh <scratch-dir>
set -eu
here=$(dirname "$(realpath "$0")"); tmp=$(realpath -m "$1"); mkdir -p "$tmp"
result() { jq -r '[.. | objects | select(has("specs")) | .specs[] | select([.tests[].results[-1].status] | all(. == "passed") | not) | .title | split(" ")[0]] | join(",")' "$1/acceptance.json"; }
run() { # <name> <expected failing tests> <sed script or empty> [files, default server.mjs; each must change]
  rm -rf "$tmp/$1" "$tmp/$1-out"; cp -r "$here/reference" "$tmp/$1"
  for f in ${4:-server.mjs}; do
    [ -z "$3" ] || sed -i "$3" "$tmp/$1/$f"
    [ -z "$3" ] || ! cmp -s "$here/reference/$f" "$tmp/$1/$f" || { echo "$1: mutation not applied to $f"; exit 1; }
  done
  "$here/../../scorer/score.sh" "$here" "$tmp/$1" "$tmp/$1-out" > /dev/null 2>&1 || true
  got=$(result "$tmp/$1-out"); [ "$got" = "$2" ] && echo "$1: ok (failing: ${got:-none})" || { echo "$1: expected '$2', got '$got'"; exit 1; }
}
run reference "" ""
run discount-off C1 's/(guests >= 6 ? 0.9 : 1)/1/' "server.mjs src/main.jsx"
run tasting-not-added C2 's/^  tastings.push(t);$//'
run cancel-email-unchecked C3 's/b.ref === ref \&\& b.email.toLowerCase() === email/b.ref === ref/'
run export-open C4 "s/^  if (!staff(req)) return res.status(401).send('Sign in first.');$//"
