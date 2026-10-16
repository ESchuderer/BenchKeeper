#!/bin/sh
# Step 2 checks (the compare view, steps/2.md) on a copy of <workspace>; writes <out-dir>/checks.json.
# S2-build: the site builds (npm ci, npm run build). S2-route, S2-delta, S2-overlay, S2-units, S2-link: hidden/step2.spec.mjs
# against the built site, expected values from the baseline commit's lib/ and data/. S2-reuse: step2-reuse.mjs on the
# diff against the baseline, with the size of the change in its detail and in diff.json (not part of the result).
# Exit 0 when the checks ran, whatever their result.
# Usage: bench/briefs/openballistics/checks/step2.sh <workspace> <out-dir>
set -u
ws=$(realpath "$1"); out=$(realpath -m "$2")
. "$(dirname "$(realpath "$0")")/site.sh"
IDS="S2-route S2-delta S2-overlay S2-units S2-link"

podman run --rm --timeout 300 --userns=keep-id -e HOME=/tmp -v "$app":/app:ro,Z -v "$scorer":/s:ro,Z -v "$tmp":/t:Z -v "$here":/checks:ro,Z \
  -w /s "$NODE" sh -c 'node node_modules/jscpd/run-jscpd.js --silent --absolute --reporters json --output /t/jscpd --min-tokens 50 \
    --format typescript,javascript,svelte --ignore "**/node_modules/**,**/dist/**,**/*.test.*,**/*.spec.*,**/*.generated.*" \
    /app/site/src /app/lib > /t/jscpd.log 2>&1
    node /checks/step2-reuse.mjs /app /t/added.diff /t/jscpd/jscpd-report.json /t/numstat' > "$tmp/reuse.json" 2> "$out/reuse.log"
jq -e .id "$tmp/reuse.json" > /dev/null 2>&1 || echo '{"id":"S2-reuse","ok":false,"detail":"reuse check did not run"}' > "$tmp/reuse.json"
jq '.diff // {}' "$tmp/reuse.json" > "$out/diff.json"

build
if [ "$built" = 0 ]; then
  tests step2.spec.mjs
  # shellcheck disable=SC2086 # IDS is a list
  results $IDS > "$tmp/pw.json"
else
  # shellcheck disable=SC2086
  unbuilt $IDS > "$tmp/pw.json"
fi
jq -n --argjson b "$built" --slurpfile pw "$tmp/pw.json" --slurpfile r "$tmp/reuse.json" \
  '{checks: ([{id: "S2-build", ok: ($b == 0), detail: (if $b == 0 then "npm ci and npm run build in site/" else "build failed: see build.log" end)}]
    + $pw[0] + [$r[0] | del(.diff)])}' > "$out/checks.json"
exit 0
