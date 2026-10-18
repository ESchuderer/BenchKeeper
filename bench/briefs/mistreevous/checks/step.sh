#!/bin/sh
# Step <k> checks on a copy of <workspace>; writes <out-dir>/checks.json. Sourced by step<k>.sh with K set.
# Hidden tests (hidden/step<j>.spec.ts, j <= k) against the repository's own src/, transpiled by its ts-node: one check per
# top-level describe of step k (S<k>-*), and from step 2 on S<k>-regressions (every test of the earlier steps passes).
# Static checks (static.mjs, Q<k>-*) against the snapshot before the step: <out-dir>/../<k-1>/repo.tar.gz, or the
# trial's base.tar.gz for step 1. Install with the network, tests and static checks without it.
# Exit 0 when the checks ran, whatever their result.
set -u
ws=$(realpath "$1"); out=$(realpath -m "$2"); mkdir -p "$out"
here=$(dirname "$(realpath "$0")"); brief=$(dirname "$here")
NODE=docker.io/library/node:22.23.3-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8
if [ "$K" = 1 ]; then prevtar=$out/../../base.tar.gz; else prevtar=$out/../$((K - 1))/repo.tar.gz; fi
copy=$(mktemp -d) && prev=$(mktemp -d); trap 'rm -rf "$copy" "$prev"' EXIT
trap 'exit 130' INT TERM HUP
tar -C "$ws" --exclude=node_modules -cf - . | tar -C "$copy" -xf -
rm -rf "$copy/hidden-tests" && cp -r "$brief/hidden" "$copy/hidden-tests"
[ -f "$prevtar" ] && tar -xzf "$prevtar" -C "$prev"
podman run --rm --timeout 900 --userns=keep-id -e HOME=/tmp -e CI=1 -v "$copy":/w:Z -w /w "$NODE" \
  sh -c 'npm ci --no-audit --no-fund --ignore-scripts' > "$out/install.log" 2>&1
podman run --rm --timeout 900 --network none --userns=keep-id -e HOME=/tmp -e CI=1 -e K="$K" -e TS_NODE_TRANSPILE_ONLY=1 \
  -v "$copy":/w:Z -v "$prev":/prev:ro,z -v "$here":/checks:ro,z -w /w "$NODE" sh -c '
  for j in $(seq "$K"); do
    timeout 300 node_modules/.bin/mocha --require ts-node/register --reporter json --timeout 10000 "hidden-tests/step$j.spec.ts" > "/tmp/h$j.json" 2> "/tmp/h$j.err"
  done
  node /checks/hidden.mjs "$K" /tmp > /tmp/hidden.json
  if [ -d /prev/.git ]; then node /checks/static.mjs /prev /w "$K" > /tmp/static.json 2> /tmp/static.err || echo "{\"checks\":[]}" > /tmp/static.json
  else echo "{\"checks\":[]}" > /tmp/static.json; fi
  node -e "const r=(f)=>require(f).checks;console.log(JSON.stringify({checks:[...r(\"/tmp/hidden.json\"),...r(\"/tmp/static.json\")]}))"
' > "$out/checks.json" 2> "$out/checks.err"
jq -e .checks "$out/checks.json" > /dev/null 2>&1 || echo '{"checks":[]}' > "$out/checks.json"
exit 0
