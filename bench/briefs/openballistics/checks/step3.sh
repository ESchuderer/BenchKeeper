#!/bin/sh
# Step 3 checks (the review round, steps/3.md) on a copy of <workspace>; writes <out-dir>/checks.json.
# S3-bug and S3-style: hidden/step3.spec.mjs. S3-regressions: every browser test of step 2 still passes.
# The reviewer comment, and why:
# - Bug: dimensions that only one of the two cartridges publishes are missing from the table. steps/2.md asks for one
#   row per symbol both publish, so a correct step 2 has the gap, and every trial has to change the table: the check
#   cannot pass without a fix. It is testable from the data alone (308 Win.: delta L; 300 Win. Mag.: R3; 9 mm Luger:
#   E, E1, e min), and the fix touches the code S2-delta and S2-units cover, so regressions are likely to show.
# - Style: the number columns right-aligned, headers included, like the tables of the detail page. Computed style, so
#   it does not depend on the agent's markup.
# Exit 0 when the checks ran, whatever their result.
# Usage: bench/briefs/openballistics/checks/step3.sh <workspace> <out-dir>
set -u
ws=$(realpath "$1"); out=$(realpath -m "$2")
. "$(dirname "$(realpath "$0")")/site.sh"
S2="S2-route S2-delta S2-overlay S2-units S2-link"

build
if [ "$built" = 0 ]; then
  tests step2.spec.mjs step3.spec.mjs
  # shellcheck disable=SC2086 # S2 is a list
  results S3-bug S3-style $S2 > "$tmp/pw.json"
else
  # shellcheck disable=SC2086
  unbuilt S3-bug S3-style $S2 > "$tmp/pw.json"
fi
jq '{checks: ([.[] | select(.id | startswith("S3-"))] + [[.[] | select(.id | startswith("S2-"))] as $s2 |
  {id: "S3-regressions", ok: ($s2 | all(.ok)),
   detail: (if ($s2 | all(.ok)) then "step 2 browser tests pass" else "failing: " + ([$s2[] | select(.ok | not) | .id + ": " + .detail[0:150]] | join("; ")) end)}])}' \
  "$tmp/pw.json" > "$out/checks.json"
exit 0
